// Unified AI Vision, Segmentation, Calibration & 3D Reconstruction Schema (v2.0.0)

export const RECONSTRUCTION_SCHEMA_VERSION = '2.0.0' as const;

export type DetailedMaterialType =
  | 'PET'
  | 'HDPE'
  | 'PVC'
  | 'LDPE'
  | 'PP'
  | 'PS'
  | 'Other Plastics'
  | 'Paper'
  | 'Cardboard'
  | 'Aluminum'
  | 'Steel'
  | 'Glass'
  | 'Fabric'
  | 'Denim'
  | 'Rubber'
  | 'Wood'
  | 'Mixed Materials'
  | 'Unknown';

export type ExtendedShapeType =
  | 'cylinder'
  | 'box'
  | 'sphere'
  | 'cone'
  | 'ellipsoid'
  | 'irregular_solid'
  | 'revolved_surface'
  | 'extruded_shape'
  | 'thin_surface'
  | 'tubular_shape'
  | 'composite_geometry';

export type GeometryReconstructionType =
  | 'lathe'
  | 'box'
  | 'extruded'
  | 'tubular'
  | 'irregular'
  | 'composite';

export type MeasurementMethod =
  | 'reference_object'
  | 'calibrated_camera'
  | 'multi_view_estimation'
  | 'user_input'
  | 'ai_estimation'
  | 'unknown';

export type ViewAngleId =
  | 'front'
  | 'side'
  | 'three_quarter'
  | 'back'
  | 'top'
  | 'bottom';

export type ReferenceObjectType =
  | 'none'
  | 'ruler_30cm'
  | 'ruler_15cm'
  | 'credit_card_85mm'
  | 'a4_paper'
  | 'aruco_50mm'
  | 'coin_25mm';

export interface NormalizedBoundingBox {
  xMin: number; // 0..1 relative to original image width
  yMin: number; // 0..1 relative to original image height
  xMax: number; // 0..1
  yMax: number; // 0..1
}

export interface ProfilePoint {
  yRatio: number; // 0 (bottom) .. 1 (top)
  radiusRatio: number; // relative to maxRadius (0..1.2)
  isEstimated?: boolean;
}

export interface ContourPoint {
  x: number; // normalized [-0.5..0.5] horizontal cross-section / silhouette coordinate
  y: number; // normalized [-0.5..0.5] vertical/depth coordinate
}

export interface DentRegion {
  yRatio: number; // 0..1
  angleDeg: number; // 0..360
  depthRatio: number; // 0.05..0.55 inward dent
  radiusRatio: number; // angular/vertical spread 0.1..0.5
}

export type ComponentRole =
  | 'body'
  | 'base'
  | 'top'
  | 'neck'
  | 'cap'
  | 'handle'
  | 'label'
  | 'bottom'
  | 'decorative'
  | 'panel_front'
  | 'panel_back'
  | 'panel_side_left'
  | 'panel_side_right'
  | 'flap_top'
  | 'flap_bottom'
  | 'detail';

export type ThreeGeometryMethod =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'cone'
  | 'lathe'
  | 'extrude'
  | 'tube'
  | 'buffer';

export interface GeometryComponentSpec {
  id: string;
  name: string;
  role: ComponentRole;
  parentId?: string;
  shape: 'lathe' | 'cylinder' | 'box' | 'extruded' | 'torus' | 'sphere' | 'tube' | 'cone' | 'buffer';
  geometryMethod?: ThreeGeometryMethod;
  positionRatio: { x: number; y: number; z: number };
  sizeRatio: { x: number; y: number; z: number };
  colorHex?: string;
  foldAngleDeg?: number;
  profilePoints?: ProfilePoint[];
  contourPoints?: ContourPoint[];
  tubularPath?: Array<{ x: number; y: number; z: number }>;
  confidence?: number;
}

export interface MetricEstimate {
  valueCm: number | null;
  method: MeasurementMethod;
  confidence: number; // 0..1
}

export interface CapturedViewQualitySummary {
  status: 'GOOD' | 'WARNING' | 'REJECTED';
  overallScore: number;
  blurScore: number;
  rawLaplacianVar?: number;
  brightness: number;
  contrast: number;
  glareRatio?: number;
  edgeClippingScore?: number;
  bboxAreaRatio?: number;
  reasons: string[];
  recommendations?: string[];
}

export interface CapturedViewEntry {
  id: string;
  angle: ViewAngleId;
  originalImage: string; // untouched captured/uploaded image
  imageWidth: number;
  imageHeight: number;
  boundingBox?: NormalizedBoundingBox; // normalized [0..1] relative to originalImage
  bboxCroppedUrl?: string | null; // unmasked rectangular crop matching boundingBox
  referenceBox?: NormalizedBoundingBox | null;
  referenceLinePx?: { x1: number; y1: number; x2: number; y2: number } | null;
  maskDataUrl?: string | null; // binary/soft alpha segmentation mask
  croppedObjectUrl?: string | null; // transparent foreground cutout inside boundingBox
  processedImageUrl?: string | null; // centered cutout on neutral background for AI/3D
  isManuallyRefined?: boolean;
  segmentationEngine?: 'client_grabcut_v1' | 'remote_sam_api';
  quality?: CapturedViewQualitySummary;
  silhouetteProfile?: ProfilePoint[];
  contourPoints?: ContourPoint[];
}

export interface ReconstructionResult {
  schemaVersion: typeof RECONSTRUCTION_SCHEMA_VERSION;
  analysisId: string;
  status: 'success' | 'needs_more_views' | 'quality_rejected' | 'error';
  reconstructionMethod: 'parametric' | 'image_to_3d' | 'hybrid_fallback';
  object: {
    name: string;
    category: 'plastic' | 'paper' | 'metal' | 'glass' | 'fabric' | 'organic' | 'electronic' | 'other';
    material: DetailedMaterialType;
    materialConfidence: number;
    shapeType: ExtendedShapeType;
    objectConfidence: number;
    partCount: number;
    partConnections: string;
    surfaceFeatures: string[];
    deformations: string[];
  };
  dimensions: {
    heightCm: number | null;
    widthCm: number | null;
    depthCm: number | null;
    lengthCm: number | null;
    maxDiameterCm: number | null;
    minDiameterCm: number | null;
    thicknessCm: number | null;
    aspectRatio: number | null;
    boundingBox3D: { xCm: number | null; yCm: number | null; zCm: number | null };
    measurementMethod: MeasurementMethod;
    confidence: number;
    perMetric: {
      height: MetricEstimate;
      width: MetricEstimate;
      depth: MetricEstimate;
      maxDiameter: MetricEstimate;
      minDiameter: MetricEstimate;
      thickness: MetricEstimate;
    };
  };
  geometry: {
    geometryType: GeometryReconstructionType;
    profilePoints: ProfilePoint[];
    contourPoints?: ContourPoint[];
    crossSectionShape?: 'circle' | 'oval' | 'rounded_rect' | 'polygon' | 'irregular';
    profileIsEstimated: boolean;
    wallThicknessCm: number | null;
    bevelCm: number | null;
    labelBandY?: [number, number] | null; // 0..1 on body
    dentRegions?: DentRegion[];
    creaseStrength?: number;
    asymmetryRatio?: number;
    tubularPath?: Array<{ x: number; y: number; z: number }>;
    components: GeometryComponentSpec[];
    hasHandle: boolean;
    hasCap: boolean;
    hasLabel: boolean;
    hasIndentation: boolean;
    hasRibs: boolean;
  };
  appearance: {
    primaryColor: string; // #RRGGBB
    secondaryColor?: string;
    capColor?: string;
    labelColor?: string;
    roughness: number; // 0..1
    metalness: number; // 0..1
    opacity: number; // 0..1
    transparent: boolean;
    clearcoat: number; // 0..1
    visualEstimateDisclaimer: string;
  };
  segmentation: {
    boundingBox: NormalizedBoundingBox | null;
    maskUrl: string | null;
    croppedObjectUrl: string | null;
    processedImageUrl: string | null;
  };
  quality: {
    imageQuality: number;
    geometryConfidence: number;
    measurementConfidence: number;
    multiViewConsistency: number | null;
    silhouetteOverlapIoU: number | null;
    proportionErrorRatio: number | null;
    missingAnglesRecommended: ViewAngleId[];
    uncertainties?: string[];
    validationWarnings: string[];
  };
  imageTo3D?: {
    jobId?: string;
    provider?: 'tripo3d' | 'meshy' | 'custom_endpoint' | 'none';
    status: 'not_requested' | 'unavailable' | 'queued' | 'processing' | 'completed' | 'failed';
    glbUrl?: string | null;
    glbByteLength?: number;
    elapsedMs?: number;
    estimatedCredits?: number;
    message?: string;
    glbInspection?: GlbInspectionReport | null;
  };
}

export interface GlbInspectionReport {
  valid: boolean;
  source: 'server_glb' | 'client_gltf';
  byteLength?: number;
  meshCount: number;
  primitiveCount?: number;
  materialCount: number;
  textureCount: number;
  nodeCount: number;
  hasEmbeddedTextures: boolean;
  hasPbrMaterials?: boolean;
  vertexCount?: number;
  triangleCount?: number;
  boundingBoxCm?: { x: number; y: number; z: number } | null;
  groundedMinY?: number;
  scaleFactor?: number;
  generator?: string;
  issues: string[];
}

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized: ReconstructionResult;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(val: unknown): val is string {
  return typeof val === 'string' && HEX_COLOR_RE.test(val.trim());
}

export function normalizeHexColor(val: unknown, fallback: string = '#94a3b8'): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (HEX_COLOR_RE.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`;
  return fallback;
}

function positiveOrNull(val: unknown, min = 0.05, max = 500): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0 || num < min || num > max) return null;
  return Number(num.toFixed(2));
}

function clamp01(val: unknown, fallback = 0.5): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, Number(num.toFixed(3))));
}

export function validateProfilePoints(points: unknown): {
  points: ProfilePoint[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!Array.isArray(points) || points.length === 0) {
    return { points: [], warnings };
  }

  const cleaned: ProfilePoint[] = [];
  for (const pt of points) {
    if (!pt || typeof pt !== 'object') continue;
    const y = Number((pt as any).yRatio);
    const r = Number((pt as any).radiusRatio);
    if (!Number.isFinite(y) || !Number.isFinite(r)) {
      warnings.push('Loại bỏ điểm biên dạng chứa NaN/Infinity.');
      continue;
    }
    if (y < -0.05 || y > 1.05 || r < 0 || r > 1.5) {
      warnings.push(`Loại bỏ điểm biên dạng bất hợp lý (y=${y}, r=${r}).`);
      continue;
    }
    cleaned.push({
      yRatio: Math.max(0, Math.min(1, Number(y.toFixed(4)))),
      radiusRatio: Math.max(0.01, Math.min(1.25, Number(r.toFixed(4)))),
      isEstimated: Boolean((pt as any).isEstimated),
    });
  }

  cleaned.sort((a, b) => a.yRatio - b.yRatio);

  // Deduplicate nearly identical yRatio values to prevent degenerate Lathe segments
  const deduped: ProfilePoint[] = [];
  for (const pt of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (!prev || pt.yRatio - prev.yRatio >= 0.012) {
      deduped.push(pt);
    }
  }

  if (deduped.length > 0 && deduped.length < 3) {
    warnings.push('Số điểm biên dạng quá ít (< 3), độ chi tiết hình tròn xoay bị giới hạn.');
  }

  return { points: deduped, warnings };
}

export function validateContourPoints(points: unknown): {
  points: ContourPoint[];
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!Array.isArray(points) || points.length === 0) {
    return { points: [], warnings };
  }

  const rawCleaned: ContourPoint[] = [];
  let maxAbs = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    if (!pt || typeof pt !== 'object') continue;
    const x = Number((pt as any).x);
    const y = Number((pt as any).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      warnings.push('Loại bỏ điểm contour chứa NaN/Infinity.');
      continue;
    }
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    rawCleaned.push({ x, y });
  }

  if (rawCleaned.length < 3) {
    if (rawCleaned.length > 0) {
      warnings.push('Contour ít hơn 3 điểm hợp lệ nên không thể tạo tiết diện khép kín.');
    }
    return { points: [], warnings };
  }

  // Normalize seamlessly to [-0.5, 0.5] centered space whether input was [0..1] or centered [-0.5..0.5]
  const isZeroToOne = minX >= -0.02 && minY >= -0.02 && maxX <= 1.02 && maxY <= 1.02 && (maxX > 0.52 || maxY > 0.52);
  const scaleDiv = maxAbs > 1.05 ? maxAbs * 2 : 1;

  const deduped: ContourPoint[] = [];
  for (const pt of rawCleaned) {
    const nx = isZeroToOne ? pt.x - 0.5 : pt.x / scaleDiv;
    const ny = isZeroToOne ? pt.y - 0.5 : pt.y / scaleDiv;
    const clamped = {
      x: Math.max(-0.55, Math.min(0.55, Number(nx.toFixed(4)))),
      y: Math.max(-0.55, Math.min(0.55, Number(ny.toFixed(4)))),
    };
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(clamped.x - prev.x, clamped.y - prev.y) >= 0.015) {
      deduped.push(clamped);
    }
  }

  if (deduped.length < 3) {
    warnings.push('Sau khi khử điểm trùng lặp, contour không đủ 3 đỉnh.');
    return { points: [], warnings };
  }

  return { points: deduped, warnings };
}

export function validateNormalizedBBox(bbox: unknown): NormalizedBoundingBox | null {
  if (!bbox || typeof bbox !== 'object') return null;
  const b = bbox as Record<string, unknown>;
  const xMin = Number(b.xMin);
  const yMin = Number(b.yMin);
  const xMax = Number(b.xMax);
  const yMax = Number(b.yMax);
  if (![xMin, yMin, xMax, yMax].every(Number.isFinite)) return null;
  const cxMin = Math.max(0, Math.min(1, xMin));
  const cyMin = Math.max(0, Math.min(1, yMin));
  const cxMax = Math.max(0, Math.min(1, xMax));
  const cyMax = Math.max(0, Math.min(1, yMax));
  if (cxMax - cxMin < 0.02 || cyMax - cyMin < 0.02) return null;
  return { xMin: cxMin, yMin: cyMin, xMax: cxMax, yMax: cyMax };
}

export function validateReconstructionPayload(raw: Partial<ReconstructionResult>): ValidationOutcome {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawDims = raw.dimensions || ({} as any);
  const heightCm = positiveOrNull(rawDims.heightCm);
  const widthCm = positiveOrNull(rawDims.widthCm);
  const depthCm = positiveOrNull(rawDims.depthCm);
  const lengthCm = positiveOrNull(rawDims.lengthCm ?? rawDims.heightCm);
  const maxDiameterCm = positiveOrNull(rawDims.maxDiameterCm);
  const minDiameterCm = positiveOrNull(rawDims.minDiameterCm);
  const thicknessCm = positiveOrNull(rawDims.thicknessCm, 0.01, 50);

  if (rawDims.heightCm !== undefined && rawDims.heightCm !== null && Number(rawDims.heightCm) <= 0) {
    errors.push('heightCm không được âm hoặc bằng 0.');
  }
  if (rawDims.widthCm !== undefined && rawDims.widthCm !== null && Number(rawDims.widthCm) <= 0) {
    errors.push('widthCm không được âm hoặc bằng 0.');
  }
  if (rawDims.depthCm !== undefined && rawDims.depthCm !== null && Number(rawDims.depthCm) <= 0) {
    errors.push('depthCm không được âm hoặc bằng 0.');
  }

  const profileCheck = validateProfilePoints(raw.geometry?.profilePoints);
  warnings.push(...profileCheck.warnings);
  const contourCheck = validateContourPoints(raw.geometry?.contourPoints);
  warnings.push(...contourCheck.warnings);

  const rawColor = raw.appearance?.primaryColor;
  if (rawColor !== undefined && !isValidHexColor(rawColor)) {
    warnings.push(`Màu primaryColor (${String(rawColor)}) không đúng chuẩn #RRGGBB.`);
  }

  const aspectRatio =
    heightCm && (widthCm || maxDiameterCm)
      ? Number((heightCm / (widthCm || maxDiameterCm || 1)).toFixed(3))
      : null;

  const defaultMethod: MeasurementMethod = rawDims.measurementMethod || 'unknown';
  const defaultConf = clamp01(rawDims.confidence, 0);

  const sanitized: ReconstructionResult = {
    schemaVersion: RECONSTRUCTION_SCHEMA_VERSION,
    analysisId: raw.analysisId || `rec_${Date.now()}`,
    status: raw.status || 'success',
    reconstructionMethod: raw.reconstructionMethod || 'parametric',
    object: {
      name: raw.object?.name || 'Vật liệu chưa xác định',
      category: raw.object?.category || 'other',
      material: raw.object?.material || 'Unknown',
      materialConfidence: clamp01(raw.object?.materialConfidence, 0),
      shapeType: raw.object?.shapeType || 'irregular_solid',
      objectConfidence: clamp01(raw.object?.objectConfidence, 0),
      partCount: Math.max(1, Math.round(Number(raw.object?.partCount) || 1)),
      partConnections: raw.object?.partConnections || 'Cấu trúc liền khối',
      surfaceFeatures: Array.isArray(raw.object?.surfaceFeatures) ? raw.object!.surfaceFeatures : [],
      deformations: Array.isArray(raw.object?.deformations) ? raw.object!.deformations : [],
    },
    dimensions: {
      heightCm,
      widthCm,
      depthCm,
      lengthCm,
      maxDiameterCm,
      minDiameterCm,
      thicknessCm,
      aspectRatio,
      boundingBox3D: {
        xCm: widthCm ?? maxDiameterCm,
        yCm: heightCm,
        zCm: depthCm ?? maxDiameterCm ?? widthCm,
      },
      measurementMethod: defaultMethod,
      confidence: defaultConf,
      perMetric: {
        height: rawDims.perMetric?.height || { valueCm: heightCm, method: defaultMethod, confidence: heightCm ? defaultConf : 0 },
        width: rawDims.perMetric?.width || { valueCm: widthCm, method: defaultMethod, confidence: widthCm ? defaultConf : 0 },
        depth: rawDims.perMetric?.depth || { valueCm: depthCm, method: depthCm ? defaultMethod : 'unknown', confidence: depthCm ? clamp01(defaultConf * 0.85) : 0 },
        maxDiameter: rawDims.perMetric?.maxDiameter || { valueCm: maxDiameterCm, method: defaultMethod, confidence: maxDiameterCm ? defaultConf : 0 },
        minDiameter: rawDims.perMetric?.minDiameter || { valueCm: minDiameterCm, method: defaultMethod, confidence: minDiameterCm ? clamp01(defaultConf * 0.85) : 0 },
        thickness: rawDims.perMetric?.thickness || { valueCm: thicknessCm, method: thicknessCm ? defaultMethod : 'unknown', confidence: thicknessCm ? clamp01(defaultConf * 0.7) : 0 },
      },
    },
    geometry: {
      geometryType: raw.geometry?.geometryType || 'box',
      profilePoints: profileCheck.points,
      contourPoints: contourCheck.points.length >= 3 ? contourCheck.points : undefined,
      crossSectionShape: raw.geometry?.crossSectionShape,
      profileIsEstimated: Boolean(raw.geometry?.profileIsEstimated ?? profileCheck.points.length === 0),
      wallThicknessCm: positiveOrNull(raw.geometry?.wallThicknessCm, 0.02, 20),
      bevelCm: positiveOrNull(raw.geometry?.bevelCm, 0.01, 5),
      labelBandY: raw.geometry?.labelBandY || null,
      dentRegions: Array.isArray(raw.geometry?.dentRegions) ? raw.geometry!.dentRegions : [],
      creaseStrength: clamp01(raw.geometry?.creaseStrength, 0),
      asymmetryRatio: clamp01(raw.geometry?.asymmetryRatio, 0),
      tubularPath: Array.isArray(raw.geometry?.tubularPath) ? raw.geometry!.tubularPath : undefined,
      components: Array.isArray(raw.geometry?.components) ? raw.geometry!.components : [],
      hasHandle: Boolean(raw.geometry?.hasHandle),
      hasCap: Boolean(raw.geometry?.hasCap),
      hasLabel: Boolean(raw.geometry?.hasLabel),
      hasIndentation: Boolean(raw.geometry?.hasIndentation),
      hasRibs: Boolean(raw.geometry?.hasRibs),
    },
    appearance: {
      primaryColor: normalizeHexColor(raw.appearance?.primaryColor, '#94a3b8'),
      secondaryColor: raw.appearance?.secondaryColor
        ? normalizeHexColor(raw.appearance.secondaryColor, '#cbd5e1')
        : undefined,
      capColor: raw.appearance?.capColor ? normalizeHexColor(raw.appearance.capColor, '#2563eb') : undefined,
      labelColor: raw.appearance?.labelColor ? normalizeHexColor(raw.appearance.labelColor, '#e2e8f0') : undefined,
      roughness: clamp01(raw.appearance?.roughness, 0.45),
      metalness: clamp01(raw.appearance?.metalness, 0.05),
      opacity: Math.max(0.15, clamp01(raw.appearance?.opacity, 1)),
      transparent: Boolean(raw.appearance?.transparent),
      clearcoat: clamp01(raw.appearance?.clearcoat, 0.2),
      visualEstimateDisclaimer:
        raw.appearance?.visualEstimateDisclaimer ||
        'Thông số vật liệu & độ bóng được ước lượng thị giác từ ảnh chụp, không phải phép đo vật lý.',
    },
    segmentation: {
      boundingBox: validateNormalizedBBox(raw.segmentation?.boundingBox),
      maskUrl: raw.segmentation?.maskUrl || null,
      croppedObjectUrl: raw.segmentation?.croppedObjectUrl || null,
      processedImageUrl: raw.segmentation?.processedImageUrl || null,
    },
    quality: {
      imageQuality: clamp01(raw.quality?.imageQuality, 0),
      geometryConfidence: clamp01(raw.quality?.geometryConfidence, 0),
      measurementConfidence: clamp01(raw.quality?.measurementConfidence, 0),
      multiViewConsistency:
        raw.quality?.multiViewConsistency !== undefined && raw.quality?.multiViewConsistency !== null
          ? clamp01(raw.quality.multiViewConsistency, 0)
          : null,
      silhouetteOverlapIoU:
        raw.quality?.silhouetteOverlapIoU !== undefined && raw.quality?.silhouetteOverlapIoU !== null
          ? clamp01(raw.quality.silhouetteOverlapIoU, 0)
          : null,
      proportionErrorRatio:
        raw.quality?.proportionErrorRatio !== undefined && raw.quality?.proportionErrorRatio !== null
          ? Math.max(0, Number(raw.quality.proportionErrorRatio))
          : null,
      missingAnglesRecommended: Array.isArray(raw.quality?.missingAnglesRecommended)
        ? raw.quality!.missingAnglesRecommended
        : [],
      uncertainties: Array.isArray(raw.quality?.uncertainties)
        ? raw.quality!.uncertainties.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
        : [],
      validationWarnings: [...warnings, ...(raw.quality?.validationWarnings || [])],
    },
    imageTo3D: raw.imageTo3D || {
      provider: 'none',
      status: 'not_requested',
      glbUrl: null,
    },
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitized,
  };
}
