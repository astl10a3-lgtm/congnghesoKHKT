import fs from 'fs';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { CraftProduct, MaterialItem, CraftStep } from './db.ts';
import {
  type ContourPoint,
  type DetailedMaterialType,
  type ExtendedShapeType,
  type GeometryReconstructionType,
  type MeasurementMethod,
  type NormalizedBoundingBox,
  type ProfilePoint,
  type ReconstructionResult,
  type ReferenceObjectType,
  type ViewAngleId,
  normalizeHexColor,
  validateContourPoints,
  validateReconstructionPayload,
} from '../src/types/reconstruction.ts';
import {
  PROHIBITED_METHODS_NOTICE,
  type MaterialReusabilityAnalysis,
  type SafetyComplianceReport,
} from '../src/types/recycling.ts';
import {
  analyzeMaterialReusability,
  buildSafeFallbackIdeas,
  filterAndSanitizeCraftList,
} from './recyclingAdvisor.ts';
import {
  clearModelCooldown,
  isModelInCooldown,
  markModelCooldown,
} from './geminiHealth.ts';

export class AiServiceError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 500, code = 'AI_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface StructuredViewMetadata {
  angle: string;
  boundingBox?: NormalizedBoundingBox | null;
  bboxCroppedUrl?: string | null;
  processedImageUrl?: string | null;
  maskUrl?: string | null;
}

export interface AnalysisInput {
  images: string[]; // base64 data URLs or safe local /assets/... paths
  angles?: ViewAngleId[] | string[];
  referenceObject?: {
    type: ReferenceObjectType;
    description?: string;
  };
  userNotes?: string;
  aiEngine?: 'gemini' | 'chatgpt' | 'dual';
  focusOnSelection?: boolean; // when true (default), strictly prefer cropped/segmented object images over raw uncropped frames
  boundingBox?: NormalizedBoundingBox | null;
  bboxCroppedImageUrl?: string | null;
  segmentedImageUrl?: string | null;
  maskUrl?: string | null;
  croppedObjectUrl?: string | null;
  silhouetteProfile?: ProfilePoint[];
  contourPoints?: ContourPoint[];
  calibratedDimensions?: {
    heightCm: number | null;
    widthCm: number | null;
    depthCm: number | null;
    measurementMethod: MeasurementMethod;
    confidence: number;
  } | null;
  qualityReport?: {
    status: string;
    overallScore: number;
    blurScore?: number;
    brightness?: number;
    contrast?: number;
    bboxAreaRatio?: number;
    reasons?: string[];
  } | null;
  viewsMetadata?: StructuredViewMetadata[];
  imageQualityScore?: number;
  multiViewConsistency?: number | null;
}

export interface AnalysisResult {
  isDemoMode: boolean;
  engineUsed: 'gemini' | 'chatgpt' | 'dual';
  engineLabel: string;
  material: MaterialItem;
  reconstruction: ReconstructionResult;
  geometryAnalysis: {
    shapeType: 'cylinder' | 'box' | 'sphere' | 'cone' | 'irregular';
    dimensionsFormula: string;
    volumeFormula: string;
    calculatedVolumeMl: number;
    calculatedSurfaceCm2: number;
    usableSurfaceCm2: number;
    wastedRatioPercent: number;
    referenceScaleNote: string;
  };
  recommendations: {
    group100Percent: CraftProduct[];
    groupWithAddedMaterials: CraftProduct[];
  };
  reusabilityAnalysis?: MaterialReusabilityAnalysis;
  safetyCompliance?: SafetyComplianceReport;
  aiInsight?: string;
}

export interface GenerateVisualInput {
  craftId?: string;
  craftTitle: string;
  category?: string;
  materialName?: string;
  aiEngine?: 'gemini' | 'chatgpt';
  userCustomPrompt?: string;
}

export interface GenerateVisualResult {
  success: boolean;
  craftId?: string;
  imageUrl: string;
  model3DType: CraftProduct['model3DType'];
  visualNotes: string;
  engineUsed: 'gemini' | 'chatgpt';
  enhancedSteps?: CraftStep[];
  dimensionsFinished?: { lengthCm: number; widthCm: number; heightCm: number };
}

const GEMINI_VISION_MODEL = 'gemini-4-hydrogen';
const GEMINI_VISION_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB limit per image
const PUBLIC_ROOT = path.resolve(process.cwd(), 'public');

const DETAILED_MATERIALS: DetailedMaterialType[] = [
  'PET',
  'HDPE',
  'PVC',
  'LDPE',
  'PP',
  'PS',
  'Other Plastics',
  'Paper',
  'Cardboard',
  'Aluminum',
  'Steel',
  'Glass',
  'Fabric',
  'Denim',
  'Rubber',
  'Wood',
  'Mixed Materials',
  'Unknown',
];

const EXTENDED_SHAPES: ExtendedShapeType[] = [
  'cylinder',
  'box',
  'sphere',
  'cone',
  'ellipsoid',
  'irregular_solid',
  'revolved_surface',
  'extruded_shape',
  'thin_surface',
  'tubular_shape',
  'composite_geometry',
];

const GEOMETRY_TYPES: GeometryReconstructionType[] = [
  'lathe',
  'box',
  'extruded',
  'tubular',
  'irregular',
  'composite',
];

const ALLOWED_MODEL_TYPES = [
  'bottle_pot',
  'pen_holder',
  'box_organizer',
  'lantern_lamp',
  'bird_feeder',
  'plastic_planter',
  'toy_car',
  'cardboard_house',
  'fabric_tote',
  'cap_mosaic',
] as const;

const SYSTEM_ANALYSIS_PROMPT = `Bạn là Chuyên gia Thị giác Máy tính & Tái chế Thủ công (Recycle Art Studio).
Nhiệm vụ của bạn là phân tích THẬT SỰ ảnh chụp vật liệu rác thải do người dùng cung cấp (có thể gồm ảnh gốc + ảnh đã tách nền + nhiều góc chụp) và trả về JSON chính xác theo schema.

NGUYÊN TẮC BẮT BUỘC:
1. PHÂN BIỆT VẬT LIỆU CHI TIẾT (18 NHÓM):
   - Chọn materialDetail trong: PET, HDPE, PVC, LDPE, PP, PS, Other Plastics, Paper, Cardboard, Aluminum, Steel, Glass, Fabric, Denim, Rubber, Wood, Mixed Materials, Unknown.
   - KHÔNG được khẳng định chắc chắn 100% mã polymer hóa học nếu ảnh không thấy ký hiệu tái chế hay đặc trưng rõ ràng; hãy đặt materialConfidence trung thực (0.35 - 0.95) và chọn nhóm khả dĩ nhất hoặc Unknown.
   - Xếp category tổng quan trong: plastic, paper, metal, glass, fabric, organic, electronic, other.
   - Đánh giá an toàn: status trong safe_to_use, needs_cleaning, needs_special_handling, not_recommended.

2. PHÂN TÍCH CẤU TRÚC ĐA BỘ PHẬN & HÌNH HỌC KHÔNG GIAN 3D:
   - Trả lời rõ vật thể là gì, có bao nhiêu bộ phận (partCount), cách kết nối (partConnections), có tay cầm (hasHandle), nắp (hasCap), nhãn (hasLabel), rãnh/lõm (hasIndentation), gân tăng cứng (hasRibs), có bị móp/nứt (deformations) không.
   - Chọn shapeType trong: cylinder, box, sphere, cone, ellipsoid, irregular_solid, revolved_surface, extruded_shape, thin_surface, tubular_shape, composite_geometry.
   - Chọn geometryType trong: lathe (vật tròn xoay: chai, lon, lọ, ly, nắp), box (hộp vuông/chữ nhật), extruded (tấm bìa, mảnh phẳng có độ dày), tubular (ống hút, dây, thanh trụ cong), irregular (chai móp méo, vải nhàu bất quy tắc), composite (vật nhiều bộ phận ghép nối).
   - Nếu vật thể tròn xoay hoặc có độ cong thay đổi theo chiều cao, BẮT BUỘC tạo profilePoints (từ yRatio=0 đáy tới yRatio=1 đỉnh, radiusRatio theo tỉ lệ bán kính thực của VẬT THỂ TRONG ẢNH, KHÔNG dùng 1 profile cố định cho mọi vật thể!).
   - Nếu vật thể có tiết diện không tròn (oval, chữ nhật bo góc, đa giác) hoặc hình khối phẳng/bất quy tắc, trả về crossSectionShape (circle, oval, rounded_rect, polygon, irregular) và contourPoints (danh sách điểm {x, y} chuẩn hóa [-0.5..0.5] mô tả đường bao khép kín).
   - Nếu có tay cầm/ống cong, cung cấp tubularPath ([{x,y,z}] trong [-0.5..0.5]).
   - Nếu vật thể bị móp/lõm, liệt kê dentRegions (yRatio, angleDeg, depthRatio, radiusRatio).
   - Trả về components (danh sách bộ phận 3D THỰC SỰ QUAN SÁT ĐƯỢC: body, base, top, neck, cap, handle, label, decorative, panel_front...). Mỗi bộ phận gồm id, name, role, parentId (nếu gắn lên bộ phận cha như cap gắn lên neck), shape/geometryMethod (box, cylinder, sphere, cone, lathe, extrude, tube, buffer), positionRatio {x,y,z}, sizeRatio {x,y,z}, confidence. TUYỆT ĐỐI KHÔNG bịa đặt bộ phận không thấy trong ảnh (ví dụ ly không nắp thì không tạo cap).
   - Trả về uncertainties (danh sách các điểm chưa chắc chắn về góc khuất, độ dày, vật liệu hoặc kích thước).
   - Trả về appearance gồm mã màu hex #RRGGBB quan sát từ ảnh (primaryColor, secondaryColor, capColor, labelColor) và ước lượng thị giác roughness, metalness, opacity, transparent, clearcoat.

3. ĐO KÍCH THƯỚC TRUNG THỰC:
   - Nếu người dùng đã cung cấp số đo hiệu chuẩn từ vật chuẩn (calibratedDimensions), hãy tôn trọng và đồng bộ với số đo đó.
   - Nếu không có vật chuẩn, ước tính hợp lý theo tiêu chuẩn vật thể thực và đánh dấu measurementMethod = "ai_estimation", KHÔNG khẳng định là phép đo chính xác tuyệt đối.
   - Đề xuất missingAnglesRecommended (front, side, three_quarter, back, top, bottom) nếu vẫn còn góc khuất chưa chụp.

4. ĐỀ XUẤT Ý TƯỞNG TÁI CHẾ THỦ CÔNG (2 NHÓM):
   - group100Percent (tận dụng 100% vật liệu sẵn có) và groupWithAddedMaterials (kết hợp phụ liệu an toàn, rẻ).
   - Mỗi sản phẩm chọn model3DType sát nhất trong: bottle_pot, pen_holder, box_organizer, lantern_lamp, bird_feeder, plastic_planter, toy_car, cardboard_house, fabric_tote, cap_mosaic.

5. NGÔN NGỮ ĐẦU RA BẮT BUỘC:
   - Toàn bộ văn bản mô tả hiển thị cho người dùng (materialName, categoryLabel, statusLabel, condition, partConnections, surfaceFeatures, deformations, uncertainties, cleaningInstructions, safetyWarnings, dimensionsFormula, referenceScaleNote, title, description, whySuitable, steps) PHẢI viết bằng TIẾNG VIỆT chuẩn xác, tự nhiên (trừ tên mã quốc tế như PET, HDPE, Aluminum).`;

const CRAFT_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    category: { type: Type.STRING },
    categoryLabel: { type: Type.STRING },
    model3DType: {
      type: Type.STRING,
      enum: [...ALLOWED_MODEL_TYPES],
    },
    difficulty: { type: Type.STRING, enum: ['Dễ', 'Trung bình', 'Khó'] },
    estimatedTime: { type: Type.STRING },
    recycledMaterialRatio: { type: Type.NUMBER },
    materialsUsed: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          fromCurrentInventory: { type: Type.BOOLEAN },
          role: { type: Type.STRING },
        },
        required: ['name', 'fromCurrentInventory', 'role'],
      },
    },
    materialsNeededExtra: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          purpose: { type: Type.STRING },
          estimatedCostVnd: { type: Type.NUMBER },
          isEcoFriendly: { type: Type.BOOLEAN },
        },
        required: ['name', 'purpose', 'estimatedCostVnd', 'isEcoFriendly'],
      },
    },
    toolsRequired: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    dimensionsFinished: {
      type: Type.OBJECT,
      properties: {
        lengthCm: { type: Type.NUMBER },
        widthCm: { type: Type.NUMBER },
        heightCm: { type: Type.NUMBER },
      },
      required: ['lengthCm', 'widthCm', 'heightCm'],
    },
    whySuitable: { type: Type.STRING },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stepNumber: { type: Type.INTEGER },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          materialsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
          toolsNeeded: { type: Type.ARRAY, items: { type: Type.STRING } },
          dimensionsNotice: { type: Type.STRING },
          safetyWarning: { type: Type.STRING },
          highlightPart: {
            type: Type.STRING,
            enum: ['cut_line', 'body', 'assembly', 'top', 'bottom'],
          },
        },
        required: ['stepNumber', 'title', 'description', 'materialsNeeded', 'toolsNeeded', 'highlightPart'],
      },
    },
  },
  required: ['title', 'description', 'model3DType', 'difficulty', 'estimatedTime', 'toolsRequired', 'steps'],
};

const RECYCLE_ANALYSIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    materialName: { type: Type.STRING },
    category: {
      type: Type.STRING,
      enum: ['plastic', 'paper', 'metal', 'glass', 'fabric', 'organic', 'electronic', 'other'],
    },
    categoryLabel: { type: Type.STRING },
    materialDetail: { type: Type.STRING, enum: DETAILED_MATERIALS },
    materialConfidence: { type: Type.NUMBER },
    objectConfidence: { type: Type.NUMBER },
    recycleCode: { type: Type.STRING },
    status: {
      type: Type.STRING,
      enum: ['safe_to_use', 'needs_cleaning', 'needs_special_handling', 'not_recommended'],
    },
    statusLabel: { type: Type.STRING },
    condition: { type: Type.STRING },
    color: { type: Type.STRING },
    quantity: { type: Type.NUMBER },
    unit: { type: Type.STRING },
    partCount: { type: Type.INTEGER },
    partConnections: { type: Type.STRING },
    surfaceFeatures: { type: Type.ARRAY, items: { type: Type.STRING } },
    deformations: { type: Type.ARRAY, items: { type: Type.STRING } },
    dimensions: {
      type: Type.OBJECT,
      properties: {
        shapeType: { type: Type.STRING, enum: EXTENDED_SHAPES },
        lengthCm: { type: Type.NUMBER },
        widthCm: { type: Type.NUMBER },
        depthCm: { type: Type.NUMBER },
        heightCm: { type: Type.NUMBER },
        diameterCm: { type: Type.NUMBER },
        minDiameterCm: { type: Type.NUMBER },
        thicknessCm: { type: Type.NUMBER },
        volumeMl: { type: Type.NUMBER },
        usableSurfaceCm2: { type: Type.NUMBER },
        totalSurfaceCm2: { type: Type.NUMBER },
        usableRatioPercent: { type: Type.NUMBER },
      },
      required: ['shapeType', 'lengthCm', 'widthCm', 'heightCm', 'usableSurfaceCm2', 'totalSurfaceCm2', 'usableRatioPercent'],
    },
    geometry: {
      type: Type.OBJECT,
      properties: {
        geometryType: { type: Type.STRING, enum: GEOMETRY_TYPES },
        crossSectionShape: {
          type: Type.STRING,
          enum: ['circle', 'oval', 'rounded_rect', 'polygon', 'irregular'],
        },
        profilePoints: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              yRatio: { type: Type.NUMBER },
              radiusRatio: { type: Type.NUMBER },
              isEstimated: { type: Type.BOOLEAN },
            },
            required: ['yRatio', 'radiusRatio'],
          },
        },
        contourPoints: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
            },
            required: ['x', 'y'],
          },
        },
        profileIsEstimated: { type: Type.BOOLEAN },
        wallThicknessCm: { type: Type.NUMBER },
        bevelCm: { type: Type.NUMBER },
        hasHandle: { type: Type.BOOLEAN },
        hasCap: { type: Type.BOOLEAN },
        hasLabel: { type: Type.BOOLEAN },
        hasIndentation: { type: Type.BOOLEAN },
        hasRibs: { type: Type.BOOLEAN },
        tubularPath: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              z: { type: Type.NUMBER },
            },
            required: ['x', 'y', 'z'],
          },
        },
        components: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              role: {
                type: Type.STRING,
                enum: [
                  'body',
                  'base',
                  'top',
                  'neck',
                  'cap',
                  'handle',
                  'label',
                  'bottom',
                  'decorative',
                  'panel_front',
                  'panel_back',
                  'panel_side_left',
                  'panel_side_right',
                  'flap_top',
                  'flap_bottom',
                  'detail',
                ],
              },
              parentId: { type: Type.STRING },
              shape: {
                type: Type.STRING,
                enum: ['lathe', 'cylinder', 'box', 'extruded', 'torus', 'sphere', 'tube', 'cone', 'buffer'],
              },
              geometryMethod: {
                type: Type.STRING,
                enum: ['box', 'cylinder', 'sphere', 'cone', 'lathe', 'extrude', 'tube', 'buffer'],
              },
              positionRatio: {
                type: Type.OBJECT,
                properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } },
                required: ['x', 'y', 'z'],
              },
              sizeRatio: {
                type: Type.OBJECT,
                properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, z: { type: Type.NUMBER } },
                required: ['x', 'y', 'z'],
              },
              colorHex: { type: Type.STRING },
              foldAngleDeg: { type: Type.NUMBER },
              confidence: { type: Type.NUMBER },
            },
            required: ['id', 'name', 'role', 'shape', 'positionRatio', 'sizeRatio'],
          },
        },
        dentRegions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              yRatio: { type: Type.NUMBER },
              angleDeg: { type: Type.NUMBER },
              depthRatio: { type: Type.NUMBER },
              radiusRatio: { type: Type.NUMBER },
            },
            required: ['yRatio', 'angleDeg', 'depthRatio', 'radiusRatio'],
          },
        },
      },
      required: ['geometryType', 'hasHandle', 'hasCap', 'hasLabel', 'hasIndentation', 'hasRibs'],
    },
    uncertainties: { type: Type.ARRAY, items: { type: Type.STRING } },
    appearance: {
      type: Type.OBJECT,
      properties: {
        primaryColor: { type: Type.STRING },
        secondaryColor: { type: Type.STRING },
        capColor: { type: Type.STRING },
        labelColor: { type: Type.STRING },
        roughness: { type: Type.NUMBER },
        metalness: { type: Type.NUMBER },
        opacity: { type: Type.NUMBER },
        transparent: { type: Type.BOOLEAN },
        clearcoat: { type: Type.NUMBER },
      },
      required: ['primaryColor', 'roughness', 'metalness', 'opacity', 'transparent'],
    },
    missingAnglesRecommended: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: ['front', 'side', 'three_quarter', 'back', 'top', 'bottom'],
      },
    },
    cleaningInstructions: { type: Type.ARRAY, items: { type: Type.STRING } },
    safetyWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    geometryAnalysis: {
      type: Type.OBJECT,
      properties: {
        shapeType: { type: Type.STRING },
        dimensionsFormula: { type: Type.STRING },
        volumeFormula: { type: Type.STRING },
        calculatedVolumeMl: { type: Type.NUMBER },
        calculatedSurfaceCm2: { type: Type.NUMBER },
        usableSurfaceCm2: { type: Type.NUMBER },
        wastedRatioPercent: { type: Type.NUMBER },
        referenceScaleNote: { type: Type.STRING },
      },
      required: ['shapeType', 'dimensionsFormula', 'calculatedVolumeMl', 'usableSurfaceCm2'],
    },
    recommendations: {
      type: Type.OBJECT,
      properties: {
        group100Percent: { type: Type.ARRAY, items: CRAFT_ITEM_SCHEMA },
        groupWithAddedMaterials: { type: Type.ARRAY, items: CRAFT_ITEM_SCHEMA },
      },
      required: ['group100Percent', 'groupWithAddedMaterials'],
    },
  },
  required: [
    'materialName',
    'category',
    'materialDetail',
    'status',
    'dimensions',
    'geometry',
    'appearance',
    'geometryAnalysis',
    'recommendations',
  ],
};

/**
 * Safely converts validated image inputs (Data URLs or whitelisted local /assets/ files)
 * into Gemini/OpenAI base64 image payloads. Strictly blocks arbitrary external URLs (SSRF guard).
 */
export function loadImagePartsFromInput(images: string[]): {
  inlineData: { mimeType: string; data: string };
}[] {
  const parts: { inlineData: { mimeType: string; data: string } }[] = [];
  const allowedMimes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

  for (const rawImg of images.slice(0, 6)) {
    if (!rawImg || typeof rawImg !== 'string') continue;

    if (rawImg.startsWith('data:')) {
      const match = rawImg.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
      if (!match) {
        throw new AiServiceError(
          'Định dạng ảnh Data URL không hợp lệ (chỉ hỗ trợ JPEG, PNG, WebP).',
          400,
          'INVALID_IMAGE_MIME'
        );
      }
      const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
      const b64 = match[2].replace(/\s+/g, '');
      const estimatedBytes = Math.floor((b64.length * 3) / 4);
      if (estimatedBytes > MAX_SINGLE_IMAGE_BYTES) {
        throw new AiServiceError('Kích thước ảnh vượt quá giới hạn 10MB.', 413, 'IMAGE_TOO_LARGE');
      }
      parts.push({ inlineData: { mimeType, data: b64 } });
      continue;
    }

    if (rawImg.startsWith('/assets/')) {
      const normalizedRel = rawImg.replace(/^\/+/, '');
      const resolved = path.resolve(PUBLIC_ROOT, normalizedRel);
      // Path traversal prevention
      if (!resolved.startsWith(PUBLIC_ROOT + path.sep) || !fs.existsSync(resolved)) {
        continue;
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size > MAX_SINGLE_IMAGE_BYTES) continue;
      const ext = path.extname(resolved).toLowerCase();
      const mimeType =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      if (!allowedMimes.has(mimeType)) continue;
      const data = fs.readFileSync(resolved).toString('base64');
      parts.push({ inlineData: { mimeType, data } });
      continue;
    }

    // Explicitly block remote arbitrary URLs to satisfy SSRF security policy
    if (rawImg.startsWith('http://') || rawImg.startsWith('https://')) {
      throw new AiServiceError(
        'Máy chủ không tự tải URL ảnh từ bên ngoài (chống SSRF). Vui lòng tải ảnh qua trình duyệt để chuẩn hóa Data URL hoặc dùng mẫu cục bộ.',
        400,
        'REMOTE_IMAGE_URL_REJECTED'
      );
    }

    // Raw base64 fallback check
    if (rawImg.length > 100 && /^[A-Za-z0-9+/=]+$/.test(rawImg.slice(0, 64))) {
      const estimatedBytes = Math.floor((rawImg.length * 3) / 4);
      if (estimatedBytes <= MAX_SINGLE_IMAGE_BYTES) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: rawImg } });
      }
    }
  }

  return parts;
}

function mapExtendedToLegacyShape(
  shape: ExtendedShapeType
): 'cylinder' | 'box' | 'sphere' | 'cone' | 'irregular' {
  if (shape === 'cylinder' || shape === 'revolved_surface' || shape === 'tubular_shape') {
    return 'cylinder';
  }
  if (shape === 'box' || shape === 'extruded_shape' || shape === 'thin_surface') return 'box';
  if (shape === 'sphere' || shape === 'ellipsoid') return 'sphere';
  if (shape === 'cone') return 'cone';
  return 'irregular';
}

function computeLegacyGeometryMetrics(params: {
  shapeType: 'cylinder' | 'box' | 'sphere' | 'cone' | 'irregular';
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  diameterCm?: number;
}) {
  const { shapeType, lengthCm, widthCm, heightCm } = params;
  const diameterCm = params.diameterCm || Math.min(lengthCm, widthCm);

  if (shapeType === 'cylinder') {
    const r = Math.max(0.2, diameterCm / 2);
    const vol = Math.round(Math.PI * r * r * heightCm);
    const totalS = Math.round(2 * Math.PI * r * (r + heightCm));
    const usableS = Math.round(2 * Math.PI * r * (heightCm * 0.8));
    return {
      volumeMl: vol,
      totalSurfaceCm2: totalS,
      usableSurfaceCm2: usableS,
      usableRatioPercent: totalS > 0 ? Math.round((usableS / totalS) * 100) : 82,
      dimensionsFormula: 'V = π × r² × h | S_tp = 2πr(r + h)',
      volumeFormula: `V = 3.1416 × (${r.toFixed(2)})² × ${heightCm.toFixed(1)} ≈ ${vol} cm³`,
    };
  }

  if (shapeType === 'sphere') {
    const r = Math.max(0.2, diameterCm / 2);
    const vol = Math.round((4 / 3) * Math.PI * r * r * r);
    const totalS = Math.round(4 * Math.PI * r * r);
    const usableS = Math.round(totalS * 0.8);
    return {
      volumeMl: vol,
      totalSurfaceCm2: totalS,
      usableSurfaceCm2: usableS,
      usableRatioPercent: 80,
      dimensionsFormula: 'V = (4/3)πr³ | S = 4πr²',
      volumeFormula: `V = (4/3) × 3.1416 × (${r.toFixed(2)})³ ≈ ${vol} cm³`,
    };
  }

  if (shapeType === 'cone') {
    const r = Math.max(0.2, diameterCm / 2);
    const vol = Math.round((1 / 3) * Math.PI * r * r * heightCm);
    const lSlant = Math.sqrt(r * r + heightCm * heightCm);
    const totalS = Math.round(Math.PI * r * (r + lSlant));
    const usableS = Math.round(totalS * 0.78);
    return {
      volumeMl: vol,
      totalSurfaceCm2: totalS,
      usableSurfaceCm2: usableS,
      usableRatioPercent: 78,
      dimensionsFormula: 'V = (1/3)πr²h | S_tp = πr(r + l)',
      volumeFormula: `V = (1/3) × 3.1416 × (${r.toFixed(2)})² × ${heightCm.toFixed(1)} ≈ ${vol} cm³`,
    };
  }

  // Box / irregular solid bounding volume
  const vol = Math.round(lengthCm * widthCm * heightCm);
  const totalS = Math.round(2 * (lengthCm * widthCm + widthCm * heightCm + heightCm * lengthCm));
  const usableS = Math.round(totalS * 0.82);
  return {
    volumeMl: vol,
    totalSurfaceCm2: totalS,
    usableSurfaceCm2: usableS,
    usableRatioPercent: 82,
    dimensionsFormula: 'V = a × b × c | S_tp = 2(ab + bc + ca)',
    volumeFormula: `V = ${lengthCm.toFixed(1)} × ${widthCm.toFixed(1)} × ${heightCm.toFixed(1)} ≈ ${vol} cm³`,
  };
}

/**
 * Fuses AI semantic/geometry JSON + client pixel silhouette + client reference calibration
 * into a strictly validated ReconstructionResult + AnalysisResult.
 */
function buildUnifiedAnalysisResult(params: {
  parsed: any;
  input: AnalysisInput;
  engineUsed: 'gemini' | 'chatgpt' | 'dual';
  engineLabel: string;
  aiInsight: string;
}): AnalysisResult {
  const { parsed, input, engineUsed, engineLabel, aiInsight } = params;

  const cal = input.calibratedDimensions;
  const useCalibrated = cal && cal.heightCm && cal.widthCm;

  const aiShape: ExtendedShapeType = EXTENDED_SHAPES.includes(parsed.dimensions?.shapeType)
    ? parsed.dimensions.shapeType
    : 'irregular_solid';
  const legacyShape = mapExtendedToLegacyShape(aiShape);

  const heightCm = Number(
    (useCalibrated ? cal!.heightCm : parsed.dimensions?.heightCm) || 18
  );
  const widthCm = Number(
    (useCalibrated ? cal!.widthCm : parsed.dimensions?.widthCm) || 7
  );
  const depthCm = Number(
    (useCalibrated && cal!.depthCm ? cal!.depthCm : parsed.dimensions?.depthCm || widthCm)
  );
  const lengthCm = Number(
    parsed.dimensions?.lengthCm || (legacyShape === 'box' ? Math.max(widthCm, depthCm) : heightCm)
  );
  const diameterCm = Number(
    parsed.dimensions?.diameterCm ||
      (legacyShape === 'cylinder' ? Math.min(widthCm, depthCm) : widthCm)
  );

  const mathMetrics = computeLegacyGeometryMetrics({
    shapeType: legacyShape,
    lengthCm: legacyShape === 'cylinder' ? heightCm : lengthCm,
    widthCm,
    heightCm,
    diameterCm,
  });

  // Fuse silhouette profile from client GrabCut segmentation if available & reliable
  const clientProfile =
    Array.isArray(input.silhouetteProfile) && input.silhouetteProfile.length >= 4
      ? input.silhouetteProfile
      : null;
  const aiProfile = Array.isArray(parsed.geometry?.profilePoints)
    ? parsed.geometry.profilePoints
    : [];

  let chosenProfile: ProfilePoint[] = [];
  let profileIsEstimated = true;
  if (clientProfile && aiProfile.length >= 4) {
    // Weighted fusion: 60% measured 2D segmented silhouette + 40% AI semantic symmetric refinement
    chosenProfile = clientProfile.map((cp) => {
      const closestAi = aiProfile.reduce((best: any, cur: any) =>
        Math.abs(Number(cur.yRatio) - cp.yRatio) < Math.abs(Number(best.yRatio) - cp.yRatio)
          ? cur
          : best
      );
      const fusedR = cp.radiusRatio * 0.6 + Number(closestAi.radiusRatio || cp.radiusRatio) * 0.4;
      return {
        yRatio: cp.yRatio,
        radiusRatio: Number(Math.max(0.05, Math.min(1.05, fusedR)).toFixed(3)),
        isEstimated: false,
      };
    });
    profileIsEstimated = false;
  } else if (clientProfile) {
    chosenProfile = clientProfile;
    profileIsEstimated = false;
  } else if (aiProfile.length >= 3) {
    chosenProfile = aiProfile;
    profileIsEstimated = Boolean(parsed.geometry?.profileIsEstimated);
  }

  const measurementMethod: MeasurementMethod = useCalibrated
    ? cal!.measurementMethod
    : 'ai_estimation';
  const dimConfidence = useCalibrated ? cal!.confidence : 0.62;

  const inferredGeomType: GeometryReconstructionType = GEOMETRY_TYPES.includes(
    parsed.geometry?.geometryType
  )
    ? parsed.geometry.geometryType
    : legacyShape === 'cylinder' || legacyShape === 'cone'
    ? 'lathe'
    : legacyShape === 'box'
    ? 'box'
    : 'irregular';

  const rawReconstruction: Partial<ReconstructionResult> = {
    analysisId: `rec_${Date.now()}`,
    status: 'success',
    reconstructionMethod: 'parametric',
    object: {
      name: parsed.materialName || 'Vật liệu tái chế',
      category: parsed.category || 'other',
      material: DETAILED_MATERIALS.includes(parsed.materialDetail)
        ? parsed.materialDetail
        : 'Unknown',
      materialConfidence: Number(parsed.materialConfidence ?? 0.72),
      shapeType: aiShape,
      objectConfidence: Number(parsed.objectConfidence ?? 0.8),
      partCount: Number(parsed.partCount || 1),
      partConnections: parsed.partConnections || 'Cấu trúc liền khối',
      surfaceFeatures: Array.isArray(parsed.surfaceFeatures) ? parsed.surfaceFeatures : [],
      deformations: Array.isArray(parsed.deformations) ? parsed.deformations : [],
    },
    dimensions: {
      heightCm,
      widthCm,
      depthCm,
      lengthCm,
      maxDiameterCm: legacyShape === 'cylinder' ? diameterCm : Math.max(widthCm, depthCm),
      minDiameterCm: parsed.dimensions?.minDiameterCm || null,
      thicknessCm: parsed.dimensions?.thicknessCm || parsed.geometry?.wallThicknessCm || null,
      aspectRatio: widthCm > 0 ? Number((heightCm / widthCm).toFixed(3)) : null,
      boundingBox3D: { xCm: widthCm, yCm: heightCm, zCm: depthCm },
      measurementMethod,
      confidence: dimConfidence,
      perMetric: {
        height: { valueCm: heightCm, method: measurementMethod, confidence: dimConfidence },
        width: { valueCm: widthCm, method: measurementMethod, confidence: dimConfidence },
        depth: {
          valueCm: depthCm,
          method: input.images.length >= 2 ? 'multi_view_estimation' : measurementMethod,
          confidence: Number((dimConfidence * (input.images.length >= 2 ? 0.92 : 0.72)).toFixed(2)),
        },
        maxDiameter: {
          valueCm: legacyShape === 'cylinder' ? diameterCm : null,
          method: measurementMethod,
          confidence: legacyShape === 'cylinder' ? dimConfidence : 0,
        },
        minDiameter: {
          valueCm: parsed.dimensions?.minDiameterCm || null,
          method: parsed.dimensions?.minDiameterCm ? 'ai_estimation' : 'unknown',
          confidence: parsed.dimensions?.minDiameterCm ? 0.58 : 0,
        },
        thickness: {
          valueCm: parsed.dimensions?.thicknessCm || parsed.geometry?.wallThicknessCm || null,
          method: parsed.dimensions?.thicknessCm ? 'ai_estimation' : 'unknown',
          confidence: parsed.dimensions?.thicknessCm ? 0.5 : 0,
        },
      },
    },
    geometry: {
      geometryType: inferredGeomType,
      profilePoints: chosenProfile,
      contourPoints:
        validateContourPoints(parsed.geometry?.contourPoints).points.length >= 3
          ? validateContourPoints(parsed.geometry?.contourPoints).points
          : Array.isArray(input.contourPoints) && input.contourPoints.length >= 3
          ? input.contourPoints
          : undefined,
      crossSectionShape: parsed.geometry?.crossSectionShape,
      profileIsEstimated,
      wallThicknessCm: parsed.geometry?.wallThicknessCm || null,
      bevelCm: parsed.geometry?.bevelCm || null,
      labelBandY: parsed.geometry?.hasLabel ? [0.24, 0.68] : null,
      dentRegions: Array.isArray(parsed.geometry?.dentRegions) ? parsed.geometry.dentRegions : [],
      creaseStrength: parsed.deformations?.length ? 0.35 : 0,
      asymmetryRatio: 0,
      tubularPath: Array.isArray(parsed.geometry?.tubularPath) ? parsed.geometry.tubularPath : undefined,
      components: Array.isArray(parsed.geometry?.components) ? parsed.geometry.components : [],
      hasHandle: Boolean(parsed.geometry?.hasHandle),
      hasCap: Boolean(parsed.geometry?.hasCap),
      hasLabel: Boolean(parsed.geometry?.hasLabel),
      hasIndentation: Boolean(parsed.geometry?.hasIndentation),
      hasRibs: Boolean(parsed.geometry?.hasRibs),
    },
    appearance: {
      primaryColor: normalizeHexColor(parsed.appearance?.primaryColor, '#cbd5e1'),
      secondaryColor: parsed.appearance?.secondaryColor
        ? normalizeHexColor(parsed.appearance.secondaryColor, '#94a3b8')
        : undefined,
      capColor: parsed.appearance?.capColor
        ? normalizeHexColor(parsed.appearance.capColor, '#0284c7')
        : undefined,
      labelColor: parsed.appearance?.labelColor
        ? normalizeHexColor(parsed.appearance.labelColor, '#f8fafc')
        : undefined,
      roughness: Number(parsed.appearance?.roughness ?? 0.42),
      metalness: Number(parsed.appearance?.metalness ?? 0.05),
      opacity: Number(parsed.appearance?.opacity ?? 1),
      transparent: Boolean(parsed.appearance?.transparent),
      clearcoat: Number(parsed.appearance?.clearcoat ?? 0.3),
      visualEstimateDisclaimer:
        'Các thông số bề mặt (màu sắc, độ nhám, phản xạ) được suy luận thị giác từ ảnh chụp.',
    },
    segmentation: {
      boundingBox: input.boundingBox || null,
      maskUrl: input.maskUrl || null,
      croppedObjectUrl: input.croppedObjectUrl || null,
      processedImageUrl: input.segmentedImageUrl || null,
    },
    quality: {
      imageQuality: Number(input.imageQualityScore ?? 0.8),
      geometryConfidence: Number(
        Math.min(0.96, (profileIsEstimated ? 0.64 : 0.86) * (input.images.length >= 2 ? 1.05 : 0.92)).toFixed(2)
      ),
      measurementConfidence: dimConfidence,
      multiViewConsistency: input.multiViewConsistency ?? null,
      silhouetteOverlapIoU: null,
      proportionErrorRatio: null,
      missingAnglesRecommended: Array.isArray(parsed.missingAnglesRecommended)
        ? parsed.missingAnglesRecommended
        : [],
      uncertainties: [
        ...(Array.isArray(parsed.uncertainties)
          ? parsed.uncertainties.filter((u: unknown): u is string => typeof u === 'string' && u.trim().length > 0)
          : []),
        ...(!useCalibrated ? ['Chưa có vật chuẩn đo lường trực tiếp trên ảnh; kích thước thực là ước lượng AI.'] : []),
        ...(input.images.length < 2 ? ['Phân tích từ 1 góc ảnh nên chiều sâu/mặt khuất được suy luận đối xứng.'] : []),
      ],
      validationWarnings: [],
    },
  };

  const validated = validateReconstructionPayload(rawReconstruction);

  const material: MaterialItem = {
    id: 'mat_' + Date.now(),
    name: validated.sanitized.object.name,
    category: validated.sanitized.object.category,
    categoryLabel: parsed.categoryLabel || 'Vật liệu tái chế',
    recycleCode: parsed.recycleCode || `${validated.sanitized.object.material}`,
    images: [
      ...(input.croppedObjectUrl ? [input.croppedObjectUrl] : []),
      ...input.images.slice(0, 5),
    ].slice(0, 5),
    status: parsed.status || 'needs_cleaning',
    statusLabel: parsed.statusLabel || 'Cần làm sạch',
    condition: parsed.condition || 'Vật liệu còn nguyên vẹn',
    color: parsed.color || validated.sanitized.appearance.primaryColor,
    quantity: Math.max(1, Number(parsed.quantity) || 1),
    unit: parsed.unit || 'cái',
    dimensions: {
      shapeType: legacyShape,
      lengthCm: Number(lengthCm.toFixed(1)),
      widthCm: Number(widthCm.toFixed(1)),
      heightCm: Number(heightCm.toFixed(1)),
      diameterCm: legacyShape === 'cylinder' ? Number(diameterCm.toFixed(1)) : undefined,
      volumeMl: parsed.dimensions?.volumeMl || mathMetrics.volumeMl,
      usableSurfaceCm2: parsed.dimensions?.usableSurfaceCm2 || mathMetrics.usableSurfaceCm2,
      totalSurfaceCm2: parsed.dimensions?.totalSurfaceCm2 || mathMetrics.totalSurfaceCm2,
      usableRatioPercent: parsed.dimensions?.usableRatioPercent || mathMetrics.usableRatioPercent,
    },
    cleaningInstructions:
      Array.isArray(parsed.cleaningInstructions) && parsed.cleaningInstructions.length > 0
        ? parsed.cleaningInstructions
        : ['Rửa sạch bụi bẩn bên ngoài và bên trong, sau đó phơi khô ráo.'],
    safetyWarnings:
      Array.isArray(parsed.safetyWarnings) && parsed.safetyWarnings.length > 0
        ? parsed.safetyWarnings
        : ['Cẩn thận cạnh sắc sau khi cắt, nên có người lớn hỗ trợ nếu vật liệu dày cứng.'],
    dateAdded: new Date().toISOString().split('T')[0],
    reconstruction: validated.sanitized,
  };

  const advisorInput = {
    materialName: material.name,
    category: material.category,
    materialDetail: validated.sanitized.object.material,
    materialConfidence: validated.sanitized.object.materialConfidence,
    status: material.status,
    condition: material.condition,
    dimensions: {
      shapeType: legacyShape,
      lengthCm: material.dimensions.lengthCm,
      widthCm: material.dimensions.widthCm,
      heightCm: material.dimensions.heightCm,
      diameterCm: material.dimensions.diameterCm,
    },
    deformations: validated.sanitized.object.deformations,
    components: (validated.sanitized.geometry.components || []).map((c) => ({
      name: c.name,
      role: c.role,
    })),
    uncertainties: validated.sanitized.quality.uncertainties,
    userNotes: input.userNotes,
  };

  const reusabilityAnalysis = analyzeMaterialReusability(advisorInput);
  const rawGroup100 = (parsed.recommendations?.group100Percent || []).map((p: any, idx: number) =>
    normalizeProduct(p, idx, '100_percent_recycled')
  );
  const rawGroupAdded = (parsed.recommendations?.groupWithAddedMaterials || []).map(
    (p: any, idx: number) => normalizeProduct(p, idx + 10, 'with_added_materials')
  );

  const audit100 = filterAndSanitizeCraftList(rawGroup100, reusabilityAnalysis, advisorInput);
  const auditAdded = filterAndSanitizeCraftList(rawGroupAdded, reusabilityAnalysis, advisorInput);
  const fallbackIdeas = buildSafeFallbackIdeas(reusabilityAnalysis, advisorInput);

  const finalGroup100 =
    reusabilityAnalysis.suitabilityForManualCrafting === 'unsafe' ||
    reusabilityAnalysis.suitabilityForManualCrafting === 'insufficient_data'
      ? []
      : audit100.valid.length > 0
      ? audit100.valid
      : fallbackIdeas.group100Percent;

  const finalGroupAdded =
    reusabilityAnalysis.suitabilityForManualCrafting === 'unsafe' ||
    reusabilityAnalysis.suitabilityForManualCrafting === 'insufficient_data'
      ? []
      : auditAdded.valid.length > 0
      ? auditAdded.valid
      : fallbackIdeas.groupWithAddedMaterials;

  const blockedHazards = [...audit100.blockedHazards, ...auditAdded.blockedHazards];
  const requiresAdultSupervision =
    reusabilityAnalysis.requiresAdultSupervision ||
    [...finalGroup100, ...finalGroupAdded].some((c) => Boolean(c.adultSupervisionRequired));

  return {
    isDemoMode: false,
    engineUsed,
    engineLabel,
    material,
    reconstruction: validated.sanitized,
    geometryAnalysis: {
      shapeType: legacyShape,
      dimensionsFormula: parsed.geometryAnalysis?.dimensionsFormula || mathMetrics.dimensionsFormula,
      volumeFormula: parsed.geometryAnalysis?.volumeFormula || mathMetrics.volumeFormula,
      calculatedVolumeMl: parsed.geometryAnalysis?.calculatedVolumeMl || mathMetrics.volumeMl,
      calculatedSurfaceCm2: parsed.geometryAnalysis?.calculatedSurfaceCm2 || mathMetrics.totalSurfaceCm2,
      usableSurfaceCm2: parsed.geometryAnalysis?.usableSurfaceCm2 || mathMetrics.usableSurfaceCm2,
      wastedRatioPercent:
        parsed.geometryAnalysis?.wastedRatioPercent ?? 100 - mathMetrics.usableRatioPercent,
      referenceScaleNote: useCalibrated
        ? `Kích thước hiệu chuẩn từ phép đo thực tế trên ảnh (${cal!.measurementMethod}, độ tin cậy ${Math.round(dimConfidence * 100)}%).`
        : parsed.geometryAnalysis?.referenceScaleNote ||
          'Ước lượng tương đối từ AI Vision (chưa có vật chuẩn đo trực tiếp trên ảnh).',
    },
    recommendations: {
      group100Percent: finalGroup100,
      groupWithAddedMaterials: finalGroupAdded,
    },
    reusabilityAnalysis,
    safetyCompliance: {
      isSafe: reusabilityAnalysis.suitabilityForManualCrafting !== 'unsafe',
      requiresAdultSupervision,
      blockedHazards,
      safetyNotes: reusabilityAnalysis.recommendedSafeActions,
      prohibitedMethodsReminder: PROHIBITED_METHODS_NOTICE,
    },
    aiInsight,
  };
}

/**
 * Pure Computer-Vision + Mathematical Geometry estimation endpoint logic (works offline/without LLM key).
 * Never fakes AI classification; clearly flags measurementMethod & uncertainty.
 */
export function estimateGeometryPayload(params: {
  materialName?: string;
  category?: MaterialItem['category'];
  geometryType?: GeometryReconstructionType;
  shapeType?: ExtendedShapeType;
  heightCm?: number | null;
  widthCm?: number | null;
  depthCm?: number | null;
  silhouetteProfile?: ProfilePoint[];
  contourPoints?: ContourPoint[];
  crossSectionShape?: 'circle' | 'oval' | 'rounded_rect' | 'polygon' | 'irregular';
  measurementMethod?: MeasurementMethod;
  confidence?: number;
  primaryColor?: string;
  boundingBox?: NormalizedBoundingBox | null;
  maskUrl?: string | null;
  croppedObjectUrl?: string | null;
  processedImageUrl?: string | null;
  imageQualityScore?: number;
  multiViewConsistency?: number | null;
}): {
  reconstruction: ReconstructionResult;
  geometryMetrics: ReturnType<typeof computeLegacyGeometryMetrics>;
} {
  const heightCm = Number(params.heightCm || 18);
  const widthCm = Number(params.widthCm || 7);
  const depthCm = Number(params.depthCm || widthCm);
  const shapeType: ExtendedShapeType = params.shapeType || (params.geometryType === 'box' ? 'box' : 'cylinder');
  const legacyShape = mapExtendedToLegacyShape(shapeType);

  const metrics = computeLegacyGeometryMetrics({
    shapeType: legacyShape,
    lengthCm: legacyShape === 'box' || legacyShape === 'irregular' ? depthCm : heightCm,
    widthCm,
    heightCm,
    diameterCm: Math.min(widthCm, depthCm),
  });

  const profilePoints =
    params.silhouetteProfile && params.silhouetteProfile.length >= 3
      ? params.silhouetteProfile
      : [];
  const contourCheck = validateContourPoints(params.contourPoints);
  const nameLower = (params.materialName || '').toLowerCase();
  const explicitHasCap =
    /\b(chai|lọ|bình|hũ|bottle|jar|flask)\b/i.test(nameLower) &&
    !/\b(ly|cốc|cup|mug|lon|can|bát|tô|bowl)\b/i.test(nameLower);

  const geometryType: GeometryReconstructionType =
    params.geometryType || (legacyShape === 'cylinder' ? 'lathe' : 'box');

  const method: MeasurementMethod = params.measurementMethod || 'user_input';
  const conf = Number(params.confidence ?? (method === 'reference_object' ? 0.88 : 0.72));

  const validation = validateReconstructionPayload({
    analysisId: `geo_${Date.now()}`,
    status: 'success',
    reconstructionMethod: 'parametric',
    object: {
      name: params.materialName || 'Vật thể đã hiệu chuẩn',
      category: params.category || 'other',
      material: 'Unknown',
      materialConfidence: 0.4,
      shapeType,
      objectConfidence: 0.75,
      partCount: explicitHasCap ? 2 : 1,
      partConnections: 'Dữ liệu hình học từ Computer Vision & thước chuẩn',
      surfaceFeatures: [],
      deformations: [],
    },
    dimensions: {
      heightCm,
      widthCm,
      depthCm,
      lengthCm: heightCm,
      maxDiameterCm: Math.max(widthCm, depthCm),
      minDiameterCm: null,
      thicknessCm: null,
      aspectRatio: Number((heightCm / Math.max(0.1, widthCm)).toFixed(3)),
      boundingBox3D: { xCm: widthCm, yCm: heightCm, zCm: depthCm },
      measurementMethod: method,
      confidence: conf,
      perMetric: {
        height: { valueCm: heightCm, method, confidence: conf },
        width: { valueCm: widthCm, method, confidence: conf },
        depth: {
          valueCm: depthCm,
          method: params.depthCm ? method : 'unknown',
          confidence: params.depthCm ? Number((conf * 0.85).toFixed(2)) : 0.3,
        },
        maxDiameter: {
          valueCm: legacyShape === 'cylinder' ? widthCm : null,
          method: legacyShape === 'cylinder' ? method : 'unknown',
          confidence: legacyShape === 'cylinder' ? conf : 0,
        },
        minDiameter: { valueCm: null, method: 'unknown', confidence: 0 },
        thickness: { valueCm: null, method: 'unknown', confidence: 0 },
      },
    },
    geometry: {
      geometryType,
      profilePoints,
      contourPoints: contourCheck.points.length >= 3 ? contourCheck.points : undefined,
      crossSectionShape: params.crossSectionShape,
      profileIsEstimated: profilePoints.length === 0,
      wallThicknessCm: null,
      bevelCm: geometryType === 'box' ? 0.15 : null,
      components: [],
      hasHandle: false,
      hasCap: explicitHasCap,
      hasLabel: false,
      hasIndentation: false,
      hasRibs: false,
    },
    appearance: {
      primaryColor: normalizeHexColor(params.primaryColor, '#94a3b8'),
      roughness: 0.45,
      metalness: 0.05,
      opacity: 1,
      transparent: false,
      clearcoat: 0.2,
      visualEstimateDisclaimer: 'Ước lượng từ biên dạng hình học Computer Vision.',
    },
    segmentation: {
      boundingBox: params.boundingBox || null,
      maskUrl: params.maskUrl || null,
      croppedObjectUrl: params.croppedObjectUrl || null,
      processedImageUrl: params.processedImageUrl || null,
    },
    quality: {
      imageQuality: Number(params.imageQualityScore ?? 0.75),
      geometryConfidence: profilePoints.length >= 4 || contourCheck.points.length >= 4 ? 0.84 : 0.62,
      measurementConfidence: conf,
      multiViewConsistency: params.multiViewConsistency ?? null,
      silhouetteOverlapIoU: null,
      proportionErrorRatio: null,
      missingAnglesRecommended: [],
      uncertainties: [
        'Dựng hình cục bộ không qua LLM nên cấu tạo bộ phận phụ chỉ suy luận khi có dấu hiệu rõ ràng.',
      ],
      validationWarnings: [],
    },
  });

  return { reconstruction: validation.sanitized, geometryMetrics: metrics };
}

export async function analyzeRecycleMaterials(input: AnalysisInput): Promise<AnalysisResult> {
  const selectedEngine = input.aiEngine || 'gemini';
  if (selectedEngine === 'chatgpt') {
    return analyzeWithChatGPT(input);
  }
  if (selectedEngine === 'dual') {
    return analyzeWithDualEngine(input);
  }
  return analyzeWithGemini(input);
}

export function buildModelImageInputs(input: AnalysisInput): string[] {
  const focusOnly = input.focusOnSelection !== false;
  const deduped: string[] = [];
  const pushUnique = (val?: string | null) => {
    if (typeof val === 'string' && val.trim() && !deduped.includes(val)) {
      deduped.push(val);
    }
  };

  if (focusOnly) {
    // Strictly prioritize segmented studio cutouts & direct BBox crops before general input images
    pushUnique(input.segmentedImageUrl);
    pushUnique(input.bboxCroppedImageUrl);
    if (Array.isArray(input.viewsMetadata)) {
      for (const vm of input.viewsMetadata) {
        if (vm.processedImageUrl) {
          pushUnique(vm.processedImageUrl);
        } else {
          pushUnique(vm.bboxCroppedUrl);
        }
      }
    }
    if (deduped.length === 0) {
      pushUnique(input.croppedObjectUrl);
    }
    if (deduped.length === 0) {
      for (const img of input.images || []) pushUnique(img);
    }
    return deduped.slice(0, 4);
  }

  pushUnique(input.segmentedImageUrl);
  pushUnique(input.bboxCroppedImageUrl);
  for (const img of input.images || []) pushUnique(img);
  return deduped.slice(0, 4);
}

async function analyzeWithGemini(input: AnalysisInput): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new AiServiceError(
      'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Bạn vẫn có thể dựng mô hình 3D bằng dữ liệu Segmentation & thước chuẩn nội bộ hoặc cấu hình GEMINI_API_KEY trong Secrets.',
      503,
      'GEMINI_KEY_MISSING'
    );
  }

  const imageInputs = buildModelImageInputs(input);

  const imageParts = loadImagePartsFromInput(imageInputs);
  if (imageParts.length === 0) {
    throw new AiServiceError(
      'Không có dữ liệu ảnh hợp lệ để gửi tới Gemini Vision.',
      400,
      'NO_VALID_IMAGES'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const calibrationContext = input.calibratedDimensions?.heightCm
    ? `Số đo đã hiệu chuẩn bằng vật chuẩn (${input.calibratedDimensions.measurementMethod}): Cao=${input.calibratedDimensions.heightCm} cm, Rộng=${input.calibratedDimensions.widthCm} cm, Sâu=${input.calibratedDimensions.depthCm ?? 'chưa đo'} cm (độ tin cậy ${Math.round(input.calibratedDimensions.confidence * 100)}%).`
    : 'Chưa có số đo hiệu chuẩn bằng vật chuẩn trực tiếp trên ảnh.';

  const silhouetteContext =
    input.silhouetteProfile && input.silhouetteProfile.length >= 4
      ? `Biên dạng 2D trích xuất từ Segmentation Mask (yRatio 0=đáy -> 1=đỉnh): ${JSON.stringify(
          input.silhouetteProfile.map((p) => ({ y: p.yRatio, r: p.radiusRatio }))
        )}`
      : 'Chưa trích xuất được profile 2D từ mask.';

  const bboxContext = input.boundingBox
    ? `Tọa độ vùng chọn chuẩn hóa [0..1]: x=[${input.boundingBox.xMin.toFixed(2)}..${input.boundingBox.xMax.toFixed(2)}], y=[${input.boundingBox.yMin.toFixed(2)}..${input.boundingBox.yMax.toFixed(2)}].`
    : 'Không có tọa độ vùng chọn.';

  const qualityContext = input.qualityReport
    ? `Chất lượng ảnh CV: ${input.qualityReport.status} (điểm ${Math.round((input.qualityReport.overallScore || 0) * 100)}%).`
    : '';

  const anglesList =
    input.angles && input.angles.length > 0
      ? input.angles.join(', ')
      : `Cung cấp ${imageParts.length} góc ảnh`;

  const focusInstruction =
    input.focusOnSelection !== false
      ? 'QUY TẮC TẬP TRUNG ĐỐI TƯỢNG: Các ảnh gửi kèm đã được cắt gọn và tách nền theo vùng người dùng khoanh. CHỈ phân tích vật thể chính đã được chọn, bỏ qua hoàn toàn vật khác hoặc nền nếu còn sót.'
      : '';

  const contourContext =
    input.contourPoints && input.contourPoints.length >= 4
      ? `Đường bao 2D từ mask ([-0.5..0.5]): ${JSON.stringify(input.contourPoints.slice(0, 16))}`
      : '';

  const userPrompt = `Hãy phân tích vật liệu tái chế trong tập ảnh đính kèm (Ảnh đầu tiên là ảnh đã tách nền trung tính / cắt theo vùng chọn để quan sát rõ đối tượng).
${focusInstruction}
${bboxContext} ${qualityContext}
Góc chụp hiện có: ${anglesList}.
Vật tham chiếu: ${input.referenceObject?.type || 'none'} (${input.referenceObject?.description || ''}).
${calibrationContext}
${silhouetteContext}
${contourContext}
Mô tả/Yêu cầu của người dùng: "${input.userNotes || 'Phân tích vật liệu, hình học và gợi ý sản phẩm tái chế khả thi nhất.'}"

Hãy trả về JSON đầy đủ:
1. Nhận diện vật liệu chi tiết trong 18 nhóm (materialDetail), mã tái chế, trạng thái an toàn và độ tin cậy thực tế.
2. Mô tả cấu tạo các bộ phận thực sự thấy trong ảnh (partCount, partConnections, components với role/parentId/geometryMethod/positionRatio/sizeRatio, surfaceFeatures, deformations), loại hình học (shapeType, geometryType, crossSectionShape), profilePoints phản ánh đúng hình dáng vật thể thật (từ đáy yRatio=0 đến đỉnh yRatio=1), contourPoints nếu cần tiết diện bất đối xứng, mã màu hex #RRGGBB quan sát từ ảnh và danh sách uncertainties.
3. Gợi ý các góc chụp còn thiếu nếu cần (missingAnglesRecommended) và tối thiểu 3 ý tưởng tái chế thực tế chia vào group100Percent & groupWithAddedMaterials.`;

  const candidateAttempts: Array<{
    model: string;
    thinkingLevel?: ThinkingLevel;
    timeoutMs: number;
  }> = [
    { model: GEMINI_VISION_MODEL, thinkingLevel: ThinkingLevel.LOW, timeoutMs: 12000 },
    { model: GEMINI_VISION_FALLBACK_MODEL, thinkingLevel: ThinkingLevel.LOW, timeoutMs: 20000 },
    { model: GEMINI_VISION_FALLBACK_MODEL, thinkingLevel: undefined, timeoutMs: 18000 },
  ];

  const isNonRetryableClientError = (err: any): boolean => {
    const msg = String(err?.message || '');
    const status = Number(err?.status || err?.code || 0);
    if (status === 400 || status === 401 || status === 403) return true;
    return /API_KEY_INVALID|PERMISSION_DENIED|INVALID_ARGUMENT/i.test(msg);
  };

  const activeAttempts = candidateAttempts.filter((a) => !isModelInCooldown(a.model));
  const attemptsToRun =
    activeAttempts.length > 0
      ? activeAttempts
      : candidateAttempts.filter((a) => a.model === GEMINI_VISION_FALLBACK_MODEL);

  let lastError: any = null;
  for (let attempt = 0; attempt < attemptsToRun.length; attempt++) {
    const spec = attemptsToRun[attempt];
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const config: any = {
        systemInstruction: SYSTEM_ANALYSIS_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: RECYCLE_ANALYSIS_RESPONSE_SCHEMA,
      };
      if (spec.thinkingLevel) {
        config.thinkingConfig = { thinkingLevel: spec.thinkingLevel };
      }

      const geminiCall = ai.models.generateContent({
        model: spec.model,
        contents: [...imageParts, { text: userPrompt }],
        config,
      });

      const timeoutGuard = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Thời gian phản hồi AI Gemini (${spec.model}) vượt quá ${Math.round(spec.timeoutMs / 1000)} giây`)),
          spec.timeoutMs
        );
      });

      const response = (await Promise.race([geminiCall, timeoutGuard])) as any;
      if (timer) clearTimeout(timer);

      const text = response?.text || '';
      if (!text) {
        throw new Error('Gemini API trả về nội dung rỗng.');
      }
      const parsed = JSON.parse(text);
      clearModelCooldown(spec.model);

      return buildUnifiedAnalysisResult({
        parsed,
        input,
        engineUsed: 'gemini',
        engineLabel: `Google Gemini (${spec.model})`,
        aiInsight:
          'Gemini Vision đã phân tích đồng thời ảnh tách nền + đa góc nhìn, đồng bộ biên dạng 3D và kiểm tra độ an toàn.',
      });
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      lastError = err;
      if (isNonRetryableClientError(err)) {
        break;
      }
      markModelCooldown(spec.model, err);
      if (attempt < attemptsToRun.length - 1) {
        const delayMs = 500 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw new AiServiceError(
    `Phân tích Gemini Vision thất bại: ${lastError?.message || 'Lỗi không xác định'}`,
    502,
    'GEMINI_CALL_FAILED'
  );
}

async function analyzeWithChatGPT(input: AnalysisInput): Promise<AnalysisResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || openaiKey === 'MY_OPENAI_API_KEY') {
    throw new AiServiceError(
      'Chưa cấu hình OPENAI_API_KEY trên máy chủ để gọi ChatGPT-4o Vision. Vui lòng chọn Google Gemini hoặc cấu hình OPENAI_API_KEY.',
      503,
      'OPENAI_KEY_MISSING'
    );
  }

  const imageInputs = buildModelImageInputs(input);
  const imageParts = loadImagePartsFromInput(imageInputs.slice(0, 4));
  if (imageParts.length === 0) {
    throw new AiServiceError('Không có dữ liệu ảnh hợp lệ cho ChatGPT-4o.', 400, 'NO_VALID_IMAGES');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  const bboxNote = input.boundingBox
    ? `BBox chuẩn hóa: [${input.boundingBox.xMin.toFixed(2)}, ${input.boundingBox.yMin.toFixed(2)}, ${input.boundingBox.xMax.toFixed(2)}, ${input.boundingBox.yMax.toFixed(2)}].`
    : '';
  const qualityNote = input.qualityReport
    ? `Chất lượng ảnh: ${input.qualityReport.status} (${Math.round((input.qualityReport.overallScore || 0) * 100)}%).`
    : '';

  try {
    const messages: any[] = [
      {
        role: 'system',
        content: `${SYSTEM_ANALYSIS_PROMPT}\nBắt buộc trả về 1 JSON object hợp lệ khớp các trường: materialName, category, categoryLabel, materialDetail, materialConfidence, objectConfidence, recycleCode, status, statusLabel, condition, color, partCount, partConnections, surfaceFeatures, deformations, dimensions, geometry, appearance, missingAnglesRecommended, cleaningInstructions, safetyWarnings, geometryAnalysis, recommendations.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Chỉ phân tích vật thể đã được khoanh vùng và tách nền trong ảnh đính kèm. ${bboxNote} ${qualityNote} Vật tham chiếu: ${input.referenceObject?.type || 'none'}. Ghi chú: ${input.userNotes || 'Không có'}. Calibration: ${JSON.stringify(input.calibratedDimensions || null)}.`,
          },
          ...imageParts.map((part) => ({
            type: 'image_url',
            image_url: {
              url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            },
          })),
        ],
      },
    ];

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 3200,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new AiServiceError(
        `OpenAI GPT-4o trả lỗi HTTP ${res.status}: ${errText.slice(0, 200)}`,
        502,
        'OPENAI_CALL_FAILED'
      );
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiServiceError('OpenAI GPT-4o trả về phản hồi rỗng.', 502, 'OPENAI_EMPTY');
    }
    const parsed = JSON.parse(content);

    return buildUnifiedAnalysisResult({
      parsed,
      input,
      engineUsed: 'chatgpt',
      engineLabel: 'OpenAI ChatGPT-4o Vision',
      aiInsight:
        'OpenAI ChatGPT-4o Vision đã phân tích đầy đủ cấu tạo vật thể, biên dạng 3D và đề xuất ý tưởng DIY.',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeWithDualEngine(input: AnalysisInput): Promise<AnalysisResult> {
  const hasGemini = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const hasOpenAi = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY'
  );

  if (!hasGemini && !hasOpenAi) {
    throw new AiServiceError(
      'Chưa cấu hình cả GEMINI_API_KEY và OPENAI_API_KEY trên máy chủ.',
      503,
      'DUAL_KEYS_MISSING'
    );
  }

  if (hasGemini && hasOpenAi) {
    const [geminiRes, gptRes] = await Promise.allSettled([
      analyzeWithGemini(input),
      analyzeWithChatGPT(input),
    ]);
    if (geminiRes.status === 'fulfilled' && gptRes.status === 'fulfilled') {
      return {
        ...geminiRes.value,
        engineUsed: 'dual',
        engineLabel: `AI Song Mã (${GEMINI_VISION_MODEL} + GPT-4o)`,
        recommendations: {
          group100Percent: [
            ...geminiRes.value.recommendations.group100Percent,
            ...gptRes.value.recommendations.group100Percent,
          ].slice(0, 6),
          groupWithAddedMaterials: [
            ...geminiRes.value.recommendations.groupWithAddedMaterials,
            ...gptRes.value.recommendations.groupWithAddedMaterials,
          ].slice(0, 6),
        },
        aiInsight:
          'Hệ thống Song Mã đã kết hợp phân tích hình học từ Gemini Vision và ý tưởng chế tác từ OpenAI GPT-4o.',
      };
    }
    if (geminiRes.status === 'fulfilled') return geminiRes.value;
    if (gptRes.status === 'fulfilled') return gptRes.value;
    throw new AiServiceError('Cả hai engine Gemini và GPT-4o đều gặp lỗi.', 502, 'DUAL_FAILED');
  }

  // Only one key configured: invoke only that configured service honestly
  return hasGemini ? analyzeWithGemini(input) : analyzeWithChatGPT(input);
}

// Generate 3D Isometric visual for craft items missing an image
export async function generateCraft3DVisual(
  params: GenerateVisualInput
): Promise<GenerateVisualResult> {
  const engine = params.aiEngine || 'gemini';
  const title = params.craftTitle;
  const material = params.materialName || 'nhựa tái chế';

  const lowerTitle = title.toLowerCase();
  let chosenModel: CraftProduct['model3DType'] = 'bottle_pot';

  if (lowerTitle.includes('thủy canh') || lowerTitle.includes('trồng rau') || lowerTitle.includes('plastic_planter')) {
    chosenModel = 'plastic_planter';
  } else if (lowerTitle.includes('xe') || lowerTitle.includes('car') || lowerTitle.includes('toy_car')) {
    chosenModel = 'toy_car';
  } else if (lowerTitle.includes('nhà bìa') || lowerTitle.includes('ngôi nhà') || lowerTitle.includes('cardboard_house')) {
    chosenModel = 'cardboard_house';
  } else if (lowerTitle.includes('túi') || lowerTitle.includes('vải') || lowerTitle.includes('jean') || lowerTitle.includes('fabric_tote')) {
    chosenModel = 'fabric_tote';
  } else if (lowerTitle.includes('rùa') || lowerTitle.includes('nắp chai') || lowerTitle.includes('tranh ghép') || lowerTitle.includes('cap_mosaic')) {
    chosenModel = 'cap_mosaic';
  } else if (lowerTitle.includes('chim') || lowerTitle.includes('bird') || lowerTitle.includes('feeder')) {
    chosenModel = 'bird_feeder';
  } else if (lowerTitle.includes('đèn') || lowerTitle.includes('lamp') || lowerTitle.includes('lantern')) {
    chosenModel = 'lantern_lamp';
  } else if (lowerTitle.includes('kệ') || lowerTitle.includes('organizer') || lowerTitle.includes('carton')) {
    chosenModel = 'box_organizer';
  } else if (lowerTitle.includes('bút') || lowerTitle.includes('pen')) {
    chosenModel = 'pen_holder';
  }

  const svg3DIsoMockup = generateIsometric3DSvg(title, material, chosenModel, engine);
  const stepsEnhanced: CraftStep[] = [
    {
      stepNumber: 1,
      title: `Chuẩn bị & đo vẽ ${title}`,
      description: `Định vị đường cắt và tỉ lệ trên vật liệu ${material}.`,
      materialsNeeded: [material],
      toolsNeeded: ['Thước kẻ', 'Bút lông đánh dấu'],
      highlightPart: 'cut_line',
      isCompleted: false,
    },
    {
      stepNumber: 2,
      title: 'Tạo hình thân chính & các khớp nối',
      description: 'Cắt cẩn thận theo đường phác thảo, làm nhẵn các mép viền để đảm bảo an toàn.',
      materialsNeeded: [],
      toolsNeeded: ['Kéo sắc', 'Giấy nhám'],
      highlightPart: 'body',
      safetyWarning: 'Luôn hướng lưỡi kéo ra ngoài cơ thể.',
      isCompleted: false,
    },
    {
      stepNumber: 3,
      title: 'Lắp ráp chi tiết theo cấu trúc 3D',
      description: 'Khớp nối các bộ phận vào nhau theo đúng tọa độ mô hình 3D.',
      materialsNeeded: ['Keo dán thủ công'],
      toolsNeeded: ['Súng keo nến hoặc keo sữa'],
      highlightPart: 'assembly',
      isCompleted: false,
    },
  ];

  return {
    success: true,
    craftId: params.craftId,
    imageUrl: svg3DIsoMockup,
    model3DType: chosenModel,
    visualNotes: `Đã dựng bản vẽ 3D Isometric và cấu trúc thao tác cho "${title}".`,
    engineUsed: engine,
    enhancedSteps: stepsEnhanced,
    dimensionsFinished: { lengthCm: 16, widthCm: 10, heightCm: 14 },
  };
}

function generateIsometric3DSvg(
  title: string,
  material: string,
  modelType: string,
  engine: 'gemini' | 'chatgpt'
): string {
  const isGemini = engine === 'gemini';
  const brandColor = isGemini ? '#10b981' : '#6366f1';
  const brandGradient = isGemini
    ? ['#059669', '#10b981', '#34d399']
    : ['#4f46e5', '#6366f1', '#818cf8'];

  const safeTitle = title.replace(/[<>&"]/g, '');
  const safeMat = material.replace(/[<>&"]/g, '');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e293b" />
    </linearGradient>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${brandGradient[0]}" />
      <stop offset="50%" stop-color="${brandGradient[1]}" />
      <stop offset="100%" stop-color="${brandGradient[2]}" />
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bgGrad)" />
  <ellipse cx="400" cy="420" rx="220" ry="85" fill="#1e293b" stroke="${brandColor}" stroke-width="3" opacity="0.8" />
  <g transform="translate(400, 310)">
    <polygon points="0,-120 120,-50 0,20 -120,-50" fill="url(#primaryGrad)" stroke="#ffffff" stroke-width="2" opacity="0.95" />
    <polygon points="-120,-50 0,20 0,110 -120,40" fill="${brandGradient[0]}" stroke="#ffffff" stroke-width="1.5" opacity="0.9" />
    <polygon points="0,20 120,-50 120,40 0,110" fill="${brandGradient[2]}" stroke="#ffffff" stroke-width="1.5" opacity="0.85" />
    <circle cx="0" cy="-30" r="26" fill="#0f172a" stroke="${brandColor}" stroke-width="3" />
    <text x="0" y="-23" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">3D</text>
  </g>
  <rect x="30" y="500" width="740" height="70" rx="16" fill="#0f172a" stroke="#334155" stroke-width="1.5" opacity="0.95" />
  <text x="50" y="528" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${safeTitle}</text>
  <text x="50" y="552" font-family="system-ui, sans-serif" font-size="12" fill="${brandColor}">Vật liệu: ${safeMat} • Mô hình 3D: ${modelType.toUpperCase()}</text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function normalizeProduct(
  p: any,
  index: number,
  defaultType: '100_percent_recycled' | 'with_added_materials'
): CraftProduct {
  const rawModel = (p.model3DType || '').toLowerCase().trim();
  const text = `${p.title || ''} ${p.description || ''} ${rawModel}`.toLowerCase();
  let chosenModel: CraftProduct['model3DType'] = 'bottle_pot';

  if (rawModel === 'plastic_planter' || text.includes('thủy canh') || text.includes('trồng rau') || text.includes('chậu ngang')) {
    chosenModel = 'plastic_planter';
  } else if (rawModel === 'toy_car' || text.includes('xe đua') || text.includes('ô tô') || text.includes('bánh xe')) {
    chosenModel = 'toy_car';
  } else if (rawModel === 'cardboard_house' || text.includes('ngôi nhà bìa') || text.includes('nhà tiết kiệm')) {
    chosenModel = 'cardboard_house';
  } else if (rawModel === 'fabric_tote' || text.includes('túi vải') || text.includes('quần jean') || text.includes('túi cá')) {
    chosenModel = 'fabric_tote';
  } else if (rawModel === 'cap_mosaic' || text.includes('chú rùa nắp') || text.includes('tranh nắp chai') || text.includes('mosaic')) {
    chosenModel = 'cap_mosaic';
  } else if (rawModel === 'bird_feeder' || text.includes('chim') || text.includes('hộp sữa') || text.includes('feeder')) {
    chosenModel = 'bird_feeder';
  } else if (rawModel === 'lantern_lamp' || rawModel === 'tin_lamp' || text.includes('đèn') || text.includes('lamp') || text.includes('lantern') || text.includes('nến')) {
    chosenModel = 'lantern_lamp';
  } else if (rawModel === 'box_organizer' || rawModel === 'desk_organizer' || text.includes('kệ') || text.includes('organizer') || text.includes('carton') || text.includes('ngăn')) {
    chosenModel = 'box_organizer';
  } else if (rawModel === 'pen_holder' || text.includes('bút') || text.includes('pen') || text.includes('ống cắm')) {
    chosenModel = 'pen_holder';
  } else {
    chosenModel = 'bottle_pot';
  }

  return {
    id: p.id || `craft_${Date.now()}_${index}`,
    title: p.title || 'Món đồ tái chế sáng tạo',
    description: p.description || 'Sản phẩm tái chế hữu ích, dễ làm cho gia đình và góc học tập.',
    category: p.category || 'decor',
    categoryLabel: p.categoryLabel || 'Đồ trang trí',
    type: p.type || defaultType,
    imageUrl: p.imageUrl || generateIsometric3DSvg(p.title || 'Sản phẩm tái chế', 'vật liệu tái chế', chosenModel, 'gemini'),
    model3DType: chosenModel,
    difficulty: p.difficulty || 'Dễ',
    estimatedTime: p.estimatedTime || '30 phút',
    recycledMaterialRatio: p.recycledMaterialRatio || (defaultType === '100_percent_recycled' ? 100 : 75),
    materialsUsed: p.materialsUsed || [
      { name: 'Vật liệu tái chế chính', fromCurrentInventory: true, role: 'Cấu trúc chịu lực chính' },
    ],
    materialsNeededExtra: p.materialsNeededExtra || [],
    toolsRequired: p.toolsRequired || ['Kéo thủ công', 'Thước kẻ', 'Bút chì'],
    dimensionsFinished: p.dimensionsFinished || { lengthCm: 10, widthCm: 10, heightCm: 15 },
    whySuitable: p.whySuitable || 'Đặc tính vật liệu phù hợp cho chế tác thủ công.',
    guideStatus: 'completed',
    imageStatus: 'completed',
    steps:
      p.steps && p.steps.length > 0
        ? p.steps
        : [
            {
              stepNumber: 1,
              title: 'Làm sạch và đánh dấu đường cắt',
              description: 'Vệ sinh vật liệu sạch sẽ, dùng thước và bút vẽ vị trí cần cắt.',
              materialsNeeded: ['Vật liệu tái chế'],
              toolsNeeded: ['Bút chì', 'Thước kẻ'],
              isCompleted: false,
              highlightPart: 'cut_line',
            },
            {
              stepNumber: 2,
              title: 'Cắt tạo hình chi tiết',
              description: 'Dùng kéo hoặc dao cắt cẩn thận theo đường đã kẻ và làm nhẵn mép cắt.',
              materialsNeeded: [],
              toolsNeeded: ['Kéo sắc'],
              safetyWarning: 'Cẩn thận với lưỡi kéo sắc bén, luôn hướng lưỡi ra ngoài.',
              isCompleted: false,
              highlightPart: 'body',
            },
            {
              stepNumber: 3,
              title: 'Lắp ghép và hoàn thiện',
              description: 'Gắn các bộ phận vào nhau và trang trí theo sở thích.',
              materialsNeeded: [],
              toolsNeeded: ['Keo dán'],
              isCompleted: false,
              highlightPart: 'assembly',
            },
          ],
  };
}
