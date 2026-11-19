import * as THREE from 'three';
import type { MaterialItem } from '../../server/db';
import {
  type ContourPoint,
  type DentRegion,
  type DetailedMaterialType,
  type ExtendedShapeType,
  type GeometryComponentSpec,
  type GeometryReconstructionType,
  type GlbInspectionReport,
  type ProfilePoint,
  type ReconstructionResult,
  type ThreeGeometryMethod,
  normalizeHexColor,
  validateContourPoints,
  validateReconstructionPayload,
} from '../types/reconstruction';
import {
  analyzeUvAndTextureAlignment,
  extractObjectTextureCanvas,
  type TextureProjectionMode,
  type UvAlignmentMetrics,
} from '../vision/textureExtractor';
import {
  ensureSharedCacheFlags,
  getBambooWoodTexture,
  getBottleCapTextures,
  getBrushedMetalTextures,
  getFabricWeaveTextures,
  getKraftCardboardTexture,
  getRecycledPETTextures,
} from './photorealisticTextures';

export interface PartHierarchyNode {
  id: string;
  name: string;
  role: string;
  parentId: string | null;
  geometryMethod: ThreeGeometryMethod;
  confidence?: number;
}

export interface GeometryTelemetry {
  valid: boolean;
  meshCount: number;
  vertexCount: number;
  triangleCount: number;
  degenerateTriangleCount: number;
  invertedNormalCount: number;
  estimatedGpuBytes: number;
  issues: string[];
  partNames: string[];
  geometryMethodsUsed: ThreeGeometryMethod[];
  partHierarchy: PartHierarchyNode[];
  sceneDimensions: { x: number; y: number; z: number };
  groundedMinY: number;
  scaleUnitsPerCm: number;
}

export interface Phase3ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  uncertainties: string[];
  hasProfilePoints: boolean;
  hasContourPoints: boolean;
  componentCount: number;
}

export interface GeometryRefinementReport {
  before: {
    vertexCount: number;
    triangleCount: number;
    degenerateTriangles: number;
    invertedNormals: number;
    uvCoverageRatio: number;
  };
  after: {
    vertexCount: number;
    triangleCount: number;
    degenerateTriangles: number;
    invertedNormals: number;
    uvCoverageRatio: number;
  };
  degenerateRemoved: number;
  normalsFixed: number;
  uvNormalizedMeshes: number;
  tangentsComputedMeshes: number;
  proportionsPreservedRatio: number;
  smoothingApplied: boolean;
  materialsEnhanced: number;
  textureModeUsed: TextureProjectionMode | 'none';
}

export type ReconstructionQualityMode = 'optimized' | 'raw';

export interface ParametricBuildOptions {
  material: MaterialItem;
  isSoftwareGl?: boolean;
  usePhotoTexture?: boolean;
  qualityMode?: ReconstructionQualityMode;
}

export interface ParametricPartEntry {
  id: string;
  name: string;
  label: string;
  role: string;
  parentId: string | null;
  geometryMethod: ThreeGeometryMethod;
  mesh: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
}

export interface ParametricBuildOutput {
  group: THREE.Group;
  parts: ParametricPartEntry[];
  telemetry: GeometryTelemetry;
  validation: Phase3ValidationReport;
  reconstruction: ReconstructionResult;
  textureCreated?: THREE.Texture | null;
  refinementReport?: GeometryRefinementReport | null;
  uvMetrics?: UvAlignmentMetrics | null;
}

const CM_TO_SCENE = 0.1;

function mapCategoryToDetailedMaterial(cat: MaterialItem['category'], name: string): DetailedMaterialType {
  const lower = name.toLowerCase();
  if (lower.includes('pet')) return 'PET';
  if (lower.includes('hdpe') || lower.includes('nắp')) return 'HDPE';
  if (lower.includes('carton')) return 'Cardboard';
  if (lower.includes('nhôm') || lower.includes('lon')) return 'Aluminum';
  if (lower.includes('thủy tinh') || lower.includes('glass')) return 'Glass';
  if (lower.includes('jean')) return 'Denim';
  if (cat === 'plastic') return 'PET';
  if (cat === 'paper') return 'Cardboard';
  if (cat === 'metal') return 'Aluminum';
  if (cat === 'glass') return 'Glass';
  if (cat === 'fabric') return 'Fabric';
  return 'Unknown';
}

/**
 * Validates Phase 3 AI analysis & segmentation input before building any 3D geometry.
 */
export function validatePhase3GeometryInput(recon: ReconstructionResult): Phase3ValidationReport {
  const checked = validateReconstructionPayload(recon);
  const errors = [...checked.errors];
  const warnings = [...checked.warnings];
  const uncertainties = [...(checked.sanitized.quality.uncertainties || [])];

  const dims = checked.sanitized.dimensions;
  if (!dims.heightCm || !dims.widthCm) {
    warnings.push('Thiếu chiều cao hoặc chiều rộng chuẩn (cm); hệ thống dùng tỷ lệ mặc định an toàn.');
  }
  if (checked.sanitized.object.materialConfidence < 0.5) {
    warnings.push(
      `Độ tin cậy vật liệu thấp (${Math.round(checked.sanitized.object.materialConfidence * 100)}%).`
    );
  }
  if (checked.sanitized.quality.geometryConfidence < 0.55) {
    warnings.push(
      `Độ tin cậy hình học ở mức ước lượng (${Math.round(checked.sanitized.quality.geometryConfidence * 100)}%).`
    );
  }

  const contourCheck = validateContourPoints(checked.sanitized.geometry.contourPoints);
  const hasContourPoints = contourCheck.points.length >= 3;
  const hasProfilePoints = checked.sanitized.geometry.profilePoints.length >= 3;

  if (!hasProfilePoints && !hasContourPoints && checked.sanitized.geometry.geometryType !== 'box') {
    uncertainties.push('Chưa có profilePoints/contourPoints chi tiết nên sử dụng nội suy hình học chuẩn.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    uncertainties: Array.from(new Set(uncertainties)),
    hasProfilePoints,
    hasContourPoints,
    componentCount: checked.sanitized.geometry.components.length,
  };
}

/**
 * Ensures any legacy MaterialItem without a `reconstruction` payload gets a clean,
 * strictly validated Parametric ReconstructionResult derived ONLY from observed evidence
 * (never fabricates caps, ribs, or handles without explicit textual/structural signals).
 */
export function ensureMaterialReconstruction(material: MaterialItem): ReconstructionResult {
  if (material.reconstruction) {
    return validateReconstructionPayload(material.reconstruction).sanitized;
  }

  const lower = material.name.toLowerCase();
  const dims = material.dimensions || { shapeType: 'cylinder', lengthCm: 20, widthCm: 7, heightCm: 20 };

  let shapeType: ExtendedShapeType = 'cylinder';
  let geometryType: GeometryReconstructionType = 'lathe';

  if (dims.shapeType === 'box' || material.category === 'paper' || lower.includes('carton') || lower.includes('hộp')) {
    shapeType = 'box';
    geometryType = 'box';
  } else if (lower.includes('ống hút') || lower.includes('dây') || lower.includes('ống cong')) {
    shapeType = 'tubular_shape';
    geometryType = 'tubular';
  } else if (material.category === 'fabric' || lower.includes('vải') || lower.includes('jean')) {
    shapeType = 'irregular_solid';
    geometryType = 'irregular';
  } else if (dims.shapeType === 'sphere') {
    shapeType = 'sphere';
    geometryType = 'irregular';
  } else if (dims.shapeType === 'cone' || lower.includes('phễu') || lower.includes('nón')) {
    shapeType = 'cone';
    geometryType = 'lathe';
  }

  const isBottleOrJar =
    /\b(chai|lọ|bình|hũ|bottle|jar|flask)\b/i.test(lower) &&
    !/\b(ly|cốc|cup|mug|lon|can|bát|tô|bowl)\b/i.test(lower);
  const explicitlyHasCap = (isBottleOrJar || lower.includes('nắp')) && !lower.includes('không nắp');
  const explicitlyHasHandle = /\b(quai|tay cầm|handle|ca có quai|mug|jug|bình tưới)\b/i.test(lower);
  const explicitlyHasRibs = /\b(gân|khía|vằn|rib)\b/i.test(lower);

  const h = Math.max(1, Number(dims.heightCm) || 20);
  const w = Math.max(1, Number(dims.diameterCm || dims.widthCm) || 7);
  const d = Math.max(1, Number(dims.diameterCm || dims.lengthCm || w) || w);

  return validateReconstructionPayload({
    analysisId: `legacy_${material.id}`,
    status: 'success',
    reconstructionMethod: 'parametric',
    object: {
      name: material.name,
      category: material.category,
      material: mapCategoryToDetailedMaterial(material.category, material.name),
      materialConfidence: 0.65,
      shapeType,
      objectConfidence: 0.7,
      partCount: explicitlyHasCap ? 2 : 1,
      partConnections: 'Dữ liệu khôi phục từ kích thước kho vật liệu',
      surfaceFeatures: [],
      deformations: [],
    },
    dimensions: {
      heightCm: h,
      widthCm: w,
      depthCm: d,
      lengthCm: Number(dims.lengthCm) || h,
      maxDiameterCm: Number(dims.diameterCm) || Math.max(w, d),
      minDiameterCm: null,
      thicknessCm: null,
      aspectRatio: Number((h / Math.max(0.1, w)).toFixed(3)),
      boundingBox3D: { xCm: w, yCm: h, zCm: d },
      measurementMethod: 'user_input',
      confidence: 0.7,
      perMetric: {
        height: { valueCm: h, method: 'user_input', confidence: 0.7 },
        width: { valueCm: w, method: 'user_input', confidence: 0.7 },
        depth: { valueCm: d, method: 'user_input', confidence: 0.7 },
        maxDiameter: { valueCm: Number(dims.diameterCm) || Math.max(w, d), method: 'user_input', confidence: 0.7 },
        minDiameter: { valueCm: null, method: 'unknown', confidence: 0 },
        thickness: { valueCm: null, method: 'unknown', confidence: 0 },
      },
    },
    geometry: {
      geometryType,
      profilePoints: [],
      profileIsEstimated: true,
      wallThicknessCm: null,
      bevelCm: geometryType === 'box' ? 0.15 : null,
      components: [],
      hasHandle: explicitlyHasHandle,
      hasCap: explicitlyHasCap,
      hasLabel: false,
      hasIndentation: false,
      hasRibs: explicitlyHasRibs,
    },
    appearance: {
      primaryColor: normalizeHexColor(material.color, '#94a3b8'),
      roughness: material.category === 'metal' ? 0.28 : material.category === 'glass' ? 0.08 : 0.42,
      metalness: material.category === 'metal' ? 0.85 : 0.04,
      opacity: material.category === 'plastic' || material.category === 'glass' ? 0.86 : 1,
      transparent: material.category === 'plastic' || material.category === 'glass',
      clearcoat: material.category === 'plastic' || material.category === 'glass' ? 0.85 : 0.05,
      visualEstimateDisclaimer: 'Thông số màu sắc & bề mặt ước lượng từ phân tích kho vật liệu.',
    },
    segmentation: {
      boundingBox: null,
      maskUrl: null,
      croppedObjectUrl: material.images?.[0] || null,
      processedImageUrl: material.images?.[0] || null,
    },
    quality: {
      imageQuality: 0.7,
      geometryConfidence: 0.6,
      measurementConfidence: 0.7,
      multiViewConsistency: null,
      silhouetteOverlapIoU: null,
      proportionErrorRatio: null,
      missingAnglesRecommended: [],
      uncertainties: ['Dữ liệu khôi phục từ thông số cơ bản (chưa có phân tích đa góc).'],
      validationWarnings: [],
    },
  }).sanitized;
}

function getMaterialPhysicalProfile(
  materialType: DetailedMaterialType,
  appearance: ReconstructionResult['appearance']
): {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenRoughness: number;
  anisotropy: number;
  ior: number;
  translucent: boolean;
  transmission: number;
  opacity: number;
} {
  const baseR = Math.max(0.04, Math.min(0.98, appearance.roughness));
  const baseM = Math.max(0, Math.min(0.98, appearance.metalness));

  switch (materialType) {
    case 'PET':
    case 'LDPE':
      return {
        roughness: Math.min(0.45, Math.max(0.08, baseR)),
        metalness: Math.min(0.06, baseM),
        clearcoat: Math.max(0.65, appearance.clearcoat),
        clearcoatRoughness: 0.14,
        sheen: 0,
        sheenRoughness: 0.5,
        anisotropy: 0,
        ior: 1.49,
        translucent: true,
        transmission: 0.68,
        opacity: Math.max(0.76, Math.min(0.94, appearance.opacity)),
      };
    case 'Glass':
      return {
        roughness: Math.min(0.16, Math.max(0.03, baseR)),
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        sheen: 0,
        sheenRoughness: 0.2,
        anisotropy: 0,
        ior: 1.52,
        translucent: true,
        transmission: 0.88,
        opacity: Math.max(0.68, Math.min(0.92, appearance.opacity)),
      };
    case 'Aluminum':
    case 'Steel':
      return {
        roughness: Math.min(0.42, Math.max(0.16, baseR)),
        metalness: Math.max(0.84, baseM),
        clearcoat: 0.15,
        clearcoatRoughness: 0.28,
        sheen: 0,
        sheenRoughness: 0.5,
        anisotropy: materialType === 'Aluminum' ? 0.45 : 0.28,
        ior: 1.5,
        translucent: false,
        transmission: 0,
        opacity: 1.0,
      };
    case 'Cardboard':
    case 'Paper':
      return {
        roughness: Math.max(0.82, baseR),
        metalness: 0.0,
        clearcoat: 0.0,
        clearcoatRoughness: 0.9,
        sheen: 0.12,
        sheenRoughness: 0.85,
        anisotropy: 0,
        ior: 1.45,
        translucent: false,
        transmission: 0,
        opacity: 1.0,
      };
    case 'Fabric':
    case 'Denim':
      return {
        roughness: Math.max(0.84, baseR),
        metalness: 0.0,
        clearcoat: 0.0,
        clearcoatRoughness: 1.0,
        sheen: 0.72,
        sheenRoughness: 0.72,
        anisotropy: 0,
        ior: 1.4,
        translucent: false,
        transmission: 0,
        opacity: 1.0,
      };
    case 'Wood':
      return {
        roughness: Math.max(0.66, Math.min(0.92, baseR)),
        metalness: 0.0,
        clearcoat: 0.1,
        clearcoatRoughness: 0.6,
        sheen: 0,
        sheenRoughness: 0.5,
        anisotropy: 0,
        ior: 1.48,
        translucent: false,
        transmission: 0,
        opacity: 1.0,
      };
    case 'Rubber':
      return {
        roughness: Math.max(0.82, baseR),
        metalness: 0.02,
        clearcoat: 0,
        clearcoatRoughness: 0.9,
        sheen: 0,
        sheenRoughness: 0.5,
        anisotropy: 0,
        ior: 1.45,
        translucent: false,
        transmission: 0,
        opacity: 1.0,
      };
    case 'HDPE':
    case 'PP':
    case 'PVC':
    case 'PS':
    default: {
      const translucent = Boolean(appearance.transparent && appearance.opacity < 0.95);
      return {
        roughness: Math.max(0.24, Math.min(0.85, baseR)),
        metalness: Math.min(0.25, baseM),
        clearcoat: Math.max(0.22, appearance.clearcoat),
        clearcoatRoughness: 0.28,
        sheen: 0,
        sheenRoughness: 0.5,
        anisotropy: 0,
        ior: 1.5,
        translucent,
        transmission: translucent ? 0.35 : 0,
        opacity: translucent ? Math.max(0.7, appearance.opacity) : 1.0,
      };
    }
  }
}

function attachMaterialMicroMaps(
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  materialType: DetailedMaterialType,
  hasPhotoAlbedo: boolean
) {
  if (typeof document === 'undefined') return;
  ensureSharedCacheFlags();

  if (materialType === 'PET' || materialType === 'LDPE' || materialType === 'PVC') {
    const petTex = getRecycledPETTextures();
    if (!mat.normalMap) mat.normalMap = petTex.normalMap;
    if (!mat.roughnessMap) mat.roughnessMap = petTex.roughnessMap;
    mat.normalScale.set(0.28, 0.28);
  } else if (materialType === 'Aluminum' || materialType === 'Steel') {
    const metalTex = getBrushedMetalTextures();
    if (!mat.normalMap) mat.normalMap = metalTex.normalMap;
    if (!mat.roughnessMap) mat.roughnessMap = metalTex.roughnessMap;
    mat.normalScale.set(0.32, 0.32);
  } else if (materialType === 'Cardboard' || materialType === 'Paper') {
    const cardTex = getKraftCardboardTexture();
    if (!hasPhotoAlbedo && !mat.map) mat.map = cardTex.colorMap;
    if (!mat.bumpMap) mat.bumpMap = cardTex.bumpMap;
    mat.bumpScale = 0.018;
  } else if (materialType === 'Fabric' || materialType === 'Denim') {
    const fabTex = getFabricWeaveTextures();
    if (!mat.normalMap) mat.normalMap = fabTex.normalMap;
    if (!mat.roughnessMap) mat.roughnessMap = fabTex.roughnessMap;
    mat.normalScale.set(0.55, 0.55);
  } else if (materialType === 'Wood') {
    const woodTex = getBambooWoodTexture();
    if (!hasPhotoAlbedo && !mat.map) mat.map = woodTex;
  }
}

function createSurfaceMaterial(
  recon: ReconstructionResult,
  isSoftwareGl: boolean,
  photoTexture?: THREE.Texture | null,
  qualityMode: ReconstructionQualityMode = 'optimized'
): THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial {
  const { appearance, object } = recon;
  const colorHex = new THREE.Color(normalizeHexColor(appearance.primaryColor, '#cbd5e1'));
  const secondaryHex = appearance.secondaryColor
    ? new THREE.Color(normalizeHexColor(appearance.secondaryColor, '#94a3b8'))
    : colorHex;

  if (qualityMode === 'raw') {
    const rawMat = new THREE.MeshStandardMaterial({
      color: photoTexture ? 0xffffff : colorHex.clone().lerp(secondaryHex, 0.08),
      map: photoTexture || null,
      roughness: Math.max(0.2, Math.min(0.95, appearance.roughness)),
      metalness: Math.max(0, Math.min(0.95, appearance.metalness)),
      transparent: Boolean(appearance.transparent && appearance.opacity < 0.96),
      opacity: appearance.transparent ? Math.max(0.68, appearance.opacity) : 1.0,
      side: THREE.DoubleSide,
    });
    rawMat.userData._wasTransparent = rawMat.transparent;
    rawMat.userData._wasOpacity = rawMat.opacity;
    rawMat.userData._wasDepthWrite = rawMat.depthWrite;
    return rawMat;
  }

  const profile = getMaterialPhysicalProfile(object.material, appearance);
  const useTranslucent = profile.translucent && (!isSoftwareGl || object.material === 'Glass' || object.material === 'PET');

  const mat = new THREE.MeshPhysicalMaterial({
    color: photoTexture ? 0xffffff : colorHex.clone().lerp(secondaryHex, 0.12),
    map: photoTexture || null,
    roughness: profile.roughness,
    metalness: profile.metalness,
    clearcoat: isSoftwareGl ? Math.min(0.25, profile.clearcoat) : profile.clearcoat,
    clearcoatRoughness: profile.clearcoatRoughness,
    sheen: profile.sheen,
    sheenRoughness: profile.sheenRoughness,
    sheenColor: colorHex.clone().lerp(new THREE.Color(0xffffff), 0.35),
    anisotropy: profile.anisotropy,
    ior: profile.ior,
    thickness: useTranslucent ? 0.52 : 0,
    transmission: !isSoftwareGl && useTranslucent ? (photoTexture ? Math.min(0.45, profile.transmission) : profile.transmission) : 0,
    transparent: useTranslucent && (!isSoftwareGl || !photoTexture),
    opacity: useTranslucent ? (isSoftwareGl ? Math.max(0.7, profile.opacity) : profile.opacity) : 1.0,
    depthWrite: !(!isSoftwareGl && object.material === 'Glass' && !photoTexture),
    side: THREE.DoubleSide,
  });

  attachMaterialMicroMaps(mat, object.material, Boolean(photoTexture));

  mat.userData._wasTransparent = mat.transparent;
  mat.userData._wasOpacity = mat.opacity;
  mat.userData._wasDepthWrite = mat.depthWrite;
  return mat;
}

function createComponentMaterial(
  colorHex: string | undefined,
  fallbackHex: string,
  roughness = 0.4,
  metalness = 0.06,
  options?: {
    role?: string;
    texture?: THREE.Texture | null;
    qualityMode?: ReconstructionQualityMode;
  }
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: options?.texture ? 0xffffff : new THREE.Color(normalizeHexColor(colorHex, fallbackHex)),
    map: options?.texture || null,
    roughness: options?.role === 'label' ? 0.42 : roughness,
    metalness: options?.role === 'label' ? 0.04 : metalness,
    side: THREE.DoubleSide,
  });
  if (options?.qualityMode !== 'raw' && options?.role === 'cap' && typeof document !== 'undefined') {
    const capTex = getBottleCapTextures();
    mat.bumpMap = capTex.bumpMap;
    mat.bumpScale = 0.015;
  }
  mat.userData._wasTransparent = false;
  mat.userData._wasOpacity = 1.0;
  mat.userData._wasDepthWrite = true;
  return mat;
}

function synthesizeProfileIfMissing(recon: ReconstructionResult): {
  points: ProfilePoint[];
  isEstimated: boolean;
} {
  if (recon.geometry.profilePoints && recon.geometry.profilePoints.length >= 3) {
    return {
      points: recon.geometry.profilePoints,
      isEstimated: recon.geometry.profileIsEstimated,
    };
  }

  const { shapeType } = recon.object;
  if (shapeType === 'cone') {
    return {
      points: [
        { yRatio: 0, radiusRatio: 1.0, isEstimated: true },
        { yRatio: 0.35, radiusRatio: 0.72, isEstimated: true },
        { yRatio: 0.7, radiusRatio: 0.42, isEstimated: true },
        { yRatio: 1.0, radiusRatio: 0.16, isEstimated: true },
      ],
      isEstimated: true,
    };
  }

  if (recon.object.material === 'Aluminum' || !recon.geometry.hasCap) {
    return {
      points: [
        { yRatio: 0, radiusRatio: 0.88, isEstimated: true },
        { yRatio: 0.08, radiusRatio: 1.0, isEstimated: true },
        { yRatio: 0.86, radiusRatio: 1.0, isEstimated: true },
        { yRatio: 0.95, radiusRatio: 0.92, isEstimated: true },
        { yRatio: 1.0, radiusRatio: 0.9, isEstimated: true },
      ],
      isEstimated: true,
    };
  }

  return {
    points: [
      { yRatio: 0.0, radiusRatio: 0.88, isEstimated: true },
      { yRatio: 0.08, radiusRatio: 1.0, isEstimated: true },
      { yRatio: 0.4, radiusRatio: 0.98, isEstimated: true },
      { yRatio: 0.66, radiusRatio: 0.98, isEstimated: true },
      { yRatio: 0.82, radiusRatio: 0.56, isEstimated: true },
      { yRatio: 0.9, radiusRatio: 0.34, isEstimated: true },
      { yRatio: 1.0, radiusRatio: 0.34, isEstimated: true },
    ],
    isEstimated: true,
  };
}

/**
 * Interpolates a discrete vertical ProfilePoint list via Catmull-Rom spline into smooth rings.
 */
function sampleProfileRadiusAt(points: ProfilePoint[], yRatio: number): number {
  if (points.length === 0) return 1.0;
  if (points.length === 1) return points[0].radiusRatio;

  const sorted = [...points].sort((a, b) => a.yRatio - b.yRatio);
  const clampedY = Math.max(sorted[0].yRatio, Math.min(sorted[sorted.length - 1].yRatio, yRatio));

  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i];
    const p2 = sorted[i + 1];
    if (clampedY >= p1.yRatio && clampedY <= p2.yRatio) {
      const span = Math.max(1e-5, p2.yRatio - p1.yRatio);
      const t = (clampedY - p1.yRatio) / span;
      const p0 = sorted[Math.max(0, i - 1)];
      const p3 = sorted[Math.min(sorted.length - 1, i + 2)];
      // Catmull-Rom 1D interpolation for smooth transitions without wild overshoot
      const t2 = t * t;
      const t3 = t2 * t;
      const r =
        0.5 *
        (2 * p1.radiusRatio +
          (-p0.radiusRatio + p2.radiusRatio) * t +
          (2 * p0.radiusRatio - 5 * p1.radiusRatio + 4 * p2.radiusRatio - p3.radiusRatio) * t2 +
          (-p0.radiusRatio + 3 * p1.radiusRatio - 3 * p2.radiusRatio + p3.radiusRatio) * t3);
      return Math.max(0.03, Math.min(1.25, r));
    }
  }

  return sorted[sorted.length - 1].radiusRatio;
}

/**
 * Computes radial distance r(theta) for an arbitrary closed cross-section polygon or superellipse.
 */
function sampleCrossSectionRadius(
  angleRad: number,
  crossSection: ReconstructionResult['geometry']['crossSectionShape'],
  contour?: ContourPoint[]
): { rxScale: number; rzScale: number } {
  // If an explicit 2D contour polygon is supplied with >= 4 points, cast ray in direction (cos θ, sin θ)
  if (contour && contour.length >= 4) {
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    let bestT = 0;
    const n = contour.length;

    for (let i = 0; i < n; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % n];
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-6) continue;
      const t = (a.x * sy - a.y * sx) / denom;
      const u = (a.x * dy - a.y * dx) / denom;
      if (t >= 0 && u >= -0.001 && u <= 1.001) {
        if (t > bestT) bestT = t;
      }
    }

    if (bestT > 0.04) {
      // Contour points are centered in [-0.5..0.5], so full normalized half-extent is ~0.5 -> double for unit radius
      const unitR = Math.max(0.25, Math.min(1.35, bestT * 2.0));
      return { rxScale: unitR, rzScale: unitR };
    }
  }

  if (crossSection === 'rounded_rect') {
    // Superellipse (n = 4.2) for clean rounded rectangular container body
    const c = Math.abs(Math.cos(angleRad));
    const s = Math.abs(Math.sin(angleRad));
    const p = 4.2;
    const r = Math.pow(Math.pow(c, p) + Math.pow(s, p), -1 / p);
    return { rxScale: r, rzScale: r };
  }

  if (crossSection === 'polygon') {
    // Softened octagonal/polygonal cross section
    const sides = 8;
    const sector = (Math.PI * 2) / sides;
    const localAngle = ((angleRad % sector) + sector) % sector - sector / 2;
    const r = Math.cos(sector / 2) / Math.max(0.5, Math.cos(localAngle));
    return { rxScale: r, rzScale: r };
  }

  return { rxScale: 1, rzScale: 1 };
}

/**
 * Applies physical dent regions, crease perturbations, and subtle organic asymmetry
 * onto any BufferGeometry vertex buffer while strictly recomputing normals.
 */
function applyDeformationsToGeometry(
  geometry: THREE.BufferGeometry,
  dents: DentRegion[],
  creaseStrength: number,
  heightUnits: number,
  radiusUnits: number,
  asymmetryRatio = 0
) {
  if ((!dents || dents.length === 0) && creaseStrength <= 0.01 && asymmetryRatio <= 0.01) return;
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return;

  for (let i = 0; i < posAttr.count; i++) {
    let x = posAttr.getX(i);
    const y = posAttr.getY(i);
    let z = posAttr.getZ(i);

    const radialLen = Math.hypot(x, z);
    if (radialLen < 1e-4) continue;
    const angle = Math.atan2(z, x);
    const yRatio = Math.max(0, Math.min(1, y / Math.max(0.01, heightUnits)));

    let radialScale = 1.0;

    if (asymmetryRatio > 0.01) {
      radialScale += Math.sin(angle * 2 + yRatio * Math.PI) * 0.14 * asymmetryRatio;
    }

    if (creaseStrength > 0.01) {
      const ripple = Math.sin(yRatio * Math.PI * 6 + angle * 2) * 0.06 * creaseStrength;
      radialScale -= Math.abs(ripple);
    }

    for (const dent of dents) {
      const dy = Math.abs(yRatio - dent.yRatio);
      const targetAngle = (dent.angleDeg * Math.PI) / 180;
      let dAngle = Math.abs(angle - targetAngle);
      if (dAngle > Math.PI) dAngle = Math.PI * 2 - dAngle;

      const spread = Math.max(0.14, Math.min(0.45, dent.radiusRatio || 0.24));
      if (dy < spread && dAngle < 1.15) {
        const yFalloff = Math.cos((dy / spread) * (Math.PI / 2));
        const aFalloff = Math.cos((dAngle / 1.15) * (Math.PI / 2));
        radialScale -= Math.min(0.45, dent.depthRatio * 0.55) * yFalloff * aFalloff;
      }
    }

    radialScale = Math.max(0.45, radialScale);
    if (Math.abs(radialScale - 1.0) > 1e-4 && radialLen > radiusUnits * 0.12) {
      x *= radialScale;
      z *= radialScale;
      posAttr.setXYZ(i, x, y, z);
    }
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Verifies winding on closed/convex-like custom BufferGeometry by testing average dot(normal, centroid->pos).
 * If majority of face normals point inward, flips triangle winding and recomputes vertex normals.
 */
function verifyAndFixOutwardNormals(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const center = new THREE.Vector3();
  geometry.boundingBox?.getCenter(center);

  const pos = geometry.getAttribute('position');
  const norm = geometry.getAttribute('normal');
  if (!pos || !norm) {
    geometry.computeVertexNormals();
    return;
  }

  let inwardVotes = 0;
  let totalVotes = 0;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(center);
    n.fromBufferAttribute(norm, i);
    if (v.lengthSq() > 1e-6 && n.lengthSq() > 1e-6) {
      if (v.dot(n) < 0) inwardVotes++;
      totalVotes++;
    }
  }

  if (totalVotes > 0 && inwardVotes > totalVotes * 0.6) {
    const idx = geometry.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        const c = idx.getX(i + 2);
        idx.setX(i + 1, c);
        idx.setX(i + 2, b);
      }
      idx.needsUpdate = true;
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const bx = pos.getX(i + 1);
        const by = pos.getY(i + 1);
        const bz = pos.getZ(i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, bx, by, bz);
      }
      pos.needsUpdate = true;
    }
    geometry.computeVertexNormals();
  }
}

/**
 * Builds a watertight, lofted BufferGeometry combining spline vertical profilePoints
 * with custom cross-section contourPoints / superellipse shapes + closed caps.
 */
function createLoftedCustomBufferGeometry(params: {
  profilePoints: ProfilePoint[];
  contourPoints?: ContourPoint[];
  crossSectionShape?: ReconstructionResult['geometry']['crossSectionShape'];
  widthU: number;
  heightU: number;
  depthU: number;
  dents: DentRegion[];
  creaseStrength: number;
  asymmetryRatio: number;
  radialSegments?: number;
  verticalRings?: number;
}): THREE.BufferGeometry {
  const {
    profilePoints,
    contourPoints,
    crossSectionShape,
    widthU,
    heightU,
    depthU,
    dents,
    creaseStrength,
    asymmetryRatio,
    radialSegments = 36,
    verticalRings = 24,
  } = params;

  const rxBase = Math.max(0.12, widthU / 2);
  const rzBase = Math.max(0.12, depthU / 2);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Ring vertices: (verticalRings + 1) x (radialSegments + 1) for seamless UV wrap
  for (let iy = 0; iy <= verticalRings; iy++) {
    const yRatio = iy / verticalRings;
    const y = yRatio * heightU;
    const profileScale = sampleProfileRadiusAt(profilePoints, yRatio);

    for (let ir = 0; ir <= radialSegments; ir++) {
      const u = ir / radialSegments;
      const theta = u * Math.PI * 2;
      const { rxScale, rzScale } = sampleCrossSectionRadius(theta, crossSectionShape, contourPoints);
      const x = Math.cos(theta) * rxBase * profileScale * rxScale;
      const z = -Math.sin(theta) * rzBase * profileScale * rzScale;
      positions.push(x, y, z);
      uvs.push(u, yRatio);
    }
  }

  const stride = radialSegments + 1;
  for (let iy = 0; iy < verticalRings; iy++) {
    for (let ir = 0; ir < radialSegments; ir++) {
      const a = iy * stride + ir;
      const b = iy * stride + ir + 1;
      const c = (iy + 1) * stride + ir;
      const d = (iy + 1) * stride + ir + 1;
      // CCW winding when viewed from outside (+x, -sin z)
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  // Bottom cap center fan (y = 0, normal pointing -Y)
  const botCenterIdx = positions.length / 3;
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);
  for (let ir = 0; ir < radialSegments; ir++) {
    const a = ir;
    const b = ir + 1;
    indices.push(botCenterIdx, b, a);
  }

  // Top cap center fan (y = heightU, normal pointing +Y)
  const topCenterIdx = positions.length / 3;
  positions.push(0, heightU, 0);
  uvs.push(0.5, 0.5);
  const topRingStart = verticalRings * stride;
  for (let ir = 0; ir < radialSegments; ir++) {
    const a = topRingStart + ir;
    const b = topRingStart + ir + 1;
    indices.push(topCenterIdx, a, b);
  }

  // Filter degenerate zero-area triangles before committing index buffer
  const validIndices: number[] = [];
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];
    pA.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
    pB.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
    pC.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
    ab.subVectors(pB, pA);
    ac.subVectors(pC, pA);
    if (ab.cross(ac).lengthSq() > 1e-12) {
      validIndices.push(i0, i1, i2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(validIndices);
  geo.computeVertexNormals();

  applyDeformationsToGeometry(
    geo,
    dents,
    creaseStrength,
    heightU,
    Math.max(rxBase, rzBase),
    asymmetryRatio
  );
  verifyAndFixOutwardNormals(geo);
  return geo;
}

/**
 * Builds an ExtrudeGeometry from normalized 2D contourPoints (or rounded rectangle fallback).
 * Seated cleanly at min.y = 0 and centered along X and Z.
 */
function createExtrudePartGeometry(
  contourPoints: ContourPoint[] | undefined,
  widthU: number,
  heightU: number,
  depthU: number,
  bevelCm: number | null
): THREE.BufferGeometry {
  const bevel = Math.max(0.008, Math.min(0.045, (bevelCm || 0.12) * CM_TO_SCENE));
  const extrudeDepth = Math.max(0.04, depthU - bevel * 2);

  let pts2D: THREE.Vector2[];
  if (contourPoints && contourPoints.length >= 3) {
    pts2D = contourPoints.map((pt) => new THREE.Vector2(pt.x * widthU, pt.y * heightU));
    // Ensure consistent CCW winding for ExtrudeGeometry
    if (THREE.ShapeUtils.isClockWise(pts2D)) {
      pts2D.reverse();
    }
  } else {
    // Rounded rectangle 2D cross section
    const hw = Math.max(0.08, widthU * 0.46);
    const hh = Math.max(0.08, heightU * 0.46);
    const r = Math.min(hw, hh) * 0.22;
    const shape = new THREE.Shape();
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
    shape.lineTo(hw, hh - r);
    shape.quadraticCurveTo(hw, hh, hw - r, hh);
    shape.lineTo(-hw + r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    pts2D = shape.getPoints(32);
  }

  const shape = new THREE.Shape(pts2D);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: extrudeDepth,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 24,
  });

  // Center on X and Z, ground min.y = 0
  geo.computeBoundingBox();
  if (geo.boundingBox) {
    const c = new THREE.Vector3();
    geo.boundingBox.getCenter(c);
    geo.translate(-c.x, -geo.boundingBox.min.y, -c.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a clean TubeGeometry along a 3D CatmullRomCurve3 path with duplicate-point protection.
 */
function createTubePartGeometry(
  rawPath: Array<{ x: number; y: number; z: number }> | undefined,
  widthU: number,
  heightU: number,
  depthU: number,
  radiusU: number
): THREE.BufferGeometry {
  const defaultPts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, heightU * 0.55, 0),
    new THREE.Vector3(radiusU * 1.1, heightU * 0.82, 0),
    new THREE.Vector3(radiusU * 2.2, heightU, 0),
  ];

  let curvePts = defaultPts;
  if (Array.isArray(rawPath) && rawPath.length >= 2) {
    const mapped: THREE.Vector3[] = [];
    for (const p of rawPath) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
      const vec = new THREE.Vector3(
        p.x * widthU,
        Math.max(0, Math.min(1.2, p.y)) * heightU,
        p.z * depthU
      );
      const prev = mapped[mapped.length - 1];
      if (!prev || prev.distanceTo(vec) >= 0.015) {
        mapped.push(vec);
      }
    }
    if (mapped.length >= 2) curvePts = mapped;
  }

  const curve = new THREE.CatmullRomCurve3(curvePts);
  const tubeRadius = Math.max(0.025, Math.min(0.45, radiusU));
  const geo = new THREE.TubeGeometry(curve, 36, tubeRadius, 18, false);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds an independent component BufferGeometry dispatching cleanly across all 8 Three.js geometry methods:
 * box | cylinder | sphere | cone | lathe | extrude | tube | buffer
 */
function buildGeometryForComponent(
  comp: GeometryComponentSpec,
  method: ThreeGeometryMethod,
  cx: number,
  cy: number,
  cz: number,
  recon: ReconstructionResult
): THREE.BufferGeometry {
  switch (method) {
    case 'cone': {
      const rBot = Math.max(0.04, Math.max(cx, cz) / 2);
      return new THREE.ConeGeometry(rBot, Math.max(0.05, cy), 32);
    }
    case 'cylinder': {
      const rx = Math.max(0.04, cx / 2);
      const rTop = comp.role === 'neck' ? rx * 0.92 : rx;
      const geo = new THREE.CylinderGeometry(rTop, rx, Math.max(0.05, cy), 32);
      if (Math.abs(cz - cx) > 0.03) {
        geo.scale(1, 1, Math.max(0.4, cz / Math.max(0.05, cx)));
      }
      return geo;
    }
    case 'sphere': {
      const geo = new THREE.SphereGeometry(1, 32, 24);
      geo.scale(Math.max(0.04, cx / 2), Math.max(0.04, cy / 2), Math.max(0.04, cz / 2));
      return geo;
    }
    case 'lathe': {
      const pts =
        comp.profilePoints && comp.profilePoints.length >= 3
          ? comp.profilePoints
          : synthesizeProfileIfMissing(recon).points;
      const maxR = Math.max(0.06, cx / 2);
      const vecs: THREE.Vector2[] = [new THREE.Vector2(0.001, 0)];
      const samples = 24;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        vecs.push(new THREE.Vector2(Math.max(0.02, sampleProfileRadiusAt(pts, t) * maxR), t * cy));
      }
      vecs.push(new THREE.Vector2(0.001, cy));
      const geo = new THREE.LatheGeometry(vecs, 40);
      const oval = Math.max(0.45, Math.min(1.6, cz / Math.max(0.05, cx)));
      if (Math.abs(oval - 1) > 0.04) geo.scale(1, 1, oval);
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        const c = new THREE.Vector3();
        geo.boundingBox.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
      }
      geo.computeVertexNormals();
      return geo;
    }
    case 'extrude': {
      const geo = createExtrudePartGeometry(
        comp.contourPoints || recon.geometry.contourPoints,
        cx,
        cy,
        cz,
        recon.geometry.bevelCm
      );
      // Center around Y=0 for component local origin consistency
      geo.translate(0, -cy / 2, 0);
      return geo;
    }
    case 'tube': {
      const pathPts =
        comp.tubularPath ||
        (comp.role === 'handle'
          ? [
              { x: 0, y: 0.42, z: 0 },
              { x: 0.38, y: 0.3, z: 0 },
              { x: 0.42, y: 0, z: 0 },
              { x: 0.35, y: -0.32, z: 0 },
              { x: 0, y: -0.42, z: 0 },
            ]
          : undefined);
      const geo = createTubePartGeometry(pathPts, cx, cy, cz, Math.max(0.03, Math.min(cx, cz) * 0.18));
      geo.computeBoundingBox();
      if (geo.boundingBox) {
        const c = new THREE.Vector3();
        geo.boundingBox.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
      }
      return geo;
    }
    case 'buffer': {
      const pts =
        comp.profilePoints && comp.profilePoints.length >= 3
          ? comp.profilePoints
          : [
              { yRatio: 0, radiusRatio: 0.85 },
              { yRatio: 0.5, radiusRatio: 1.0 },
              { yRatio: 1.0, radiusRatio: 0.85 },
            ];
      const geo = createLoftedCustomBufferGeometry({
        profilePoints: pts,
        contourPoints: comp.contourPoints || recon.geometry.contourPoints,
        crossSectionShape: recon.geometry.crossSectionShape,
        widthU: cx,
        heightU: cy,
        depthU: cz,
        dents: [],
        creaseStrength: 0,
        asymmetryRatio: 0,
      });
      geo.translate(0, -cy / 2, 0);
      return geo;
    }
    case 'box':
    default:
      return new THREE.BoxGeometry(Math.max(0.04, cx), Math.max(0.04, cy), Math.max(0.04, cz));
  }
}

function resolveComponentGeometryMethod(comp: GeometryComponentSpec): ThreeGeometryMethod {
  if (comp.geometryMethod) return comp.geometryMethod;
  switch (comp.shape) {
    case 'cylinder':
      return 'cylinder';
    case 'sphere':
      return 'sphere';
    case 'cone':
      return 'cone';
    case 'lathe':
      return 'lathe';
    case 'extruded':
      return 'extrude';
    case 'tube':
    case 'torus':
      return 'tube';
    case 'buffer':
      return 'buffer';
    case 'box':
    default:
      return 'box';
  }
}

/**
 * Selects optimal primary Three.js geometry strategy based on Phase 3 geometry metadata.
 */
function selectPrimaryGeometryMethod(recon: ReconstructionResult): ThreeGeometryMethod {
  const { geometryType, contourPoints, crossSectionShape, profilePoints } = recon.geometry;
  const shapeType = recon.object.shapeType;

  if (geometryType === 'tubular' || shapeType === 'tubular_shape') return 'tube';
  if (geometryType === 'extruded' || shapeType === 'extruded_shape' || shapeType === 'thin_surface') {
    return 'extrude';
  }
  if (geometryType === 'box' || shapeType === 'box') return 'box';
  if (shapeType === 'sphere' && profilePoints.length < 3 && (!contourPoints || contourPoints.length < 3)) {
    return 'sphere';
  }
  if (shapeType === 'cone' && profilePoints.length < 4 && (!contourPoints || contourPoints.length < 3)) {
    return 'cone';
  }
  if (
    geometryType === 'irregular' ||
    geometryType === 'composite' ||
    (contourPoints && contourPoints.length >= 4) ||
    (crossSectionShape && crossSectionShape !== 'circle' && crossSectionShape !== 'oval')
  ) {
    return 'buffer';
  }
  return 'lathe';
}

function buildHandleAttachment(
  bodyNode: THREE.Object3D,
  recon: ReconstructionResult,
  parts: ParametricPartEntry[],
  heightU: number,
  widthU: number,
  customSpec?: GeometryComponentSpec
) {
  const handleMat = createComponentMaterial(
    customSpec?.colorHex || recon.appearance.secondaryColor,
    recon.appearance.primaryColor,
    recon.appearance.roughness,
    recon.appearance.metalness
  );

  const attachX = widthU * 0.44;
  const reachX = widthU * (customSpec?.sizeRatio?.x ? Math.max(0.32, customSpec.sizeRatio.x) : 0.36);
  const hCenterY = (customSpec?.positionRatio?.y ?? 0.56) * heightU;
  const spanY = (customSpec?.sizeRatio?.y ?? 0.42) * heightU;
  const tubeR = Math.max(0.032, Math.min(0.09, widthU * 0.08));

  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(attachX, hCenterY + spanY * 0.5, 0),
    new THREE.Vector3(attachX + reachX * 0.85, hCenterY + spanY * 0.42, 0),
    new THREE.Vector3(attachX + reachX, hCenterY, 0),
    new THREE.Vector3(attachX + reachX * 0.85, hCenterY - spanY * 0.42, 0),
    new THREE.Vector3(attachX, hCenterY - spanY * 0.5, 0),
  ]);

  const handleGeo = new THREE.TubeGeometry(curve, 32, tubeR, 14, false);
  const handleMesh = new THREE.Mesh(handleGeo, handleMat);
  handleMesh.name = customSpec?.id || 'handle';
  handleMesh.castShadow = true;
  handleMesh.receiveShadow = true;
  bodyNode.add(handleMesh);

  parts.push({
    id: customSpec?.id || 'handle',
    name: customSpec?.name || 'handle',
    label: customSpec?.name || 'Tay cầm',
    role: 'handle',
    parentId: 'body',
    geometryMethod: 'tube',
    mesh: handleMesh,
    basePos: handleMesh.position.clone(),
    explodeDir: new THREE.Vector3(0.55, 0.05, 0),
  });
}

function buildLatheOrBufferBodyReconstruction(
  root: THREE.Group,
  recon: ReconstructionResult,
  mainMat: THREE.Material,
  parts: ParametricPartEntry[],
  heightU: number,
  widthU: number,
  depthU: number,
  primaryMethod: ThreeGeometryMethod,
  options?: {
    labelTexture?: THREE.Texture | null;
    qualityMode?: ReconstructionQualityMode;
  }
) {
  const { points } = synthesizeProfileIfMissing(recon);
  const maxRadiusX = Math.max(0.14, widthU / 2);
  const zOvalRatio = Math.max(0.45, Math.min(1.6, depthU / Math.max(0.1, widthU)));

  // Only split top neck/cap from profile if cap is genuinely present in Phase 3 data
  const hasExplicitNeck = recon.geometry.components.some((c) => c.role === 'neck');
  const hasCap =
    Boolean(recon.geometry.hasCap) || recon.geometry.components.some((c) => c.role === 'cap');

  const capSplitY = hasCap ? 0.9 : 1.0;
  const rawBodyPoints = points.filter((p) => p.yRatio <= capSplitY + 0.01);
  const bodyPoints =
    rawBodyPoints.length >= 3
      ? rawBodyPoints
      : [
          { yRatio: 0, radiusRatio: 0.9, isEstimated: true },
          { yRatio: 0.5, radiusRatio: 1.0, isEstimated: true },
          { yRatio: capSplitY, radiusRatio: hasCap ? 0.36 : 0.9, isEstimated: true },
        ];

  const bodyHeightU = heightU * (hasCap ? 0.91 : 1.0);
  const normalizedBodyPts: ProfilePoint[] = bodyPoints.map((p) => ({
    yRatio: Math.max(0, Math.min(1, p.yRatio / Math.max(0.1, capSplitY))),
    radiusRatio: p.radiusRatio,
    isEstimated: p.isEstimated,
  }));

  let bodyGeo: THREE.BufferGeometry;
  let actualMethod: ThreeGeometryMethod = primaryMethod;

  if (primaryMethod === 'cone' && bodyPoints.length <= 4) {
    bodyGeo = new THREE.ConeGeometry(maxRadiusX, bodyHeightU, 40);
    bodyGeo.translate(0, bodyHeightU / 2, 0);
    if (Math.abs(zOvalRatio - 1) > 0.04) bodyGeo.scale(1, 1, zOvalRatio);
    applyDeformationsToGeometry(
      bodyGeo,
      recon.geometry.dentRegions || [],
      recon.geometry.creaseStrength || 0,
      bodyHeightU,
      maxRadiusX,
      recon.geometry.asymmetryRatio || 0
    );
  } else if (primaryMethod === 'sphere') {
    bodyGeo = new THREE.SphereGeometry(1, 36, 28);
    bodyGeo.scale(maxRadiusX, bodyHeightU / 2, (maxRadiusX * zOvalRatio));
    bodyGeo.translate(0, bodyHeightU / 2, 0);
    applyDeformationsToGeometry(
      bodyGeo,
      recon.geometry.dentRegions || [],
      recon.geometry.creaseStrength || 0,
      bodyHeightU,
      maxRadiusX,
      recon.geometry.asymmetryRatio || 0
    );
  } else if (
    primaryMethod === 'buffer' ||
    (recon.geometry.contourPoints && recon.geometry.contourPoints.length >= 4) ||
    (recon.geometry.crossSectionShape && recon.geometry.crossSectionShape !== 'circle')
  ) {
    actualMethod = 'buffer';
    bodyGeo = createLoftedCustomBufferGeometry({
      profilePoints: normalizedBodyPts,
      contourPoints: recon.geometry.contourPoints,
      crossSectionShape: recon.geometry.crossSectionShape,
      widthU,
      heightU: bodyHeightU,
      depthU,
      dents: recon.geometry.dentRegions || [],
      creaseStrength: recon.geometry.creaseStrength || 0,
      asymmetryRatio: recon.geometry.asymmetryRatio || 0,
    });
  } else {
    actualMethod = 'lathe';
    // Spline-smoothed Lathe profile (28 samples)
    const latheVecs: THREE.Vector2[] = [new THREE.Vector2(0.001, 0)];
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = sampleProfileRadiusAt(normalizedBodyPts, t) * maxRadiusX;
      latheVecs.push(new THREE.Vector2(Math.max(0.025, r), t * bodyHeightU));
    }
    const topR = sampleProfileRadiusAt(normalizedBodyPts, 1) * maxRadiusX;
    latheVecs.push(new THREE.Vector2(Math.max(0.015, topR * 0.72), bodyHeightU));
    latheVecs.push(new THREE.Vector2(0.001, bodyHeightU));

    bodyGeo = new THREE.LatheGeometry(latheVecs, 48);
    if (Math.abs(zOvalRatio - 1) > 0.04) {
      bodyGeo.scale(1, 1, zOvalRatio);
    }
    applyDeformationsToGeometry(
      bodyGeo,
      recon.geometry.dentRegions || [],
      recon.geometry.creaseStrength || 0,
      bodyHeightU,
      maxRadiusX,
      recon.geometry.asymmetryRatio || 0
    );
    bodyGeo.computeVertexNormals();
  }

  // Body container group acts as parent for child attachments (neck->cap, handle, label, base, top, decorative)
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'body_assembly';
  root.add(bodyGroup);

  const bodyMesh = new THREE.Mesh(bodyGeo, mainMat);
  bodyMesh.name = 'body';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyGroup.add(bodyMesh);

  parts.push({
    id: 'body',
    name: 'body',
    label: 'Thân chính',
    role: 'body',
    parentId: null,
    geometryMethod: actualMethod,
    mesh: bodyGroup,
    basePos: bodyGroup.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 0),
  });

  // Explicit ribs ONLY when Phase 3 reported hasRibs === true
  if (recon.geometry.hasRibs) {
    const ribGroup = new THREE.Group();
    ribGroup.name = 'ribs';
    for (const yFrac of [0.34, 0.52]) {
      const ringR = sampleProfileRadiusAt(normalizedBodyPts, yFrac) * maxRadiusX * 0.99;
      const ribGeo = new THREE.TorusGeometry(Math.max(0.06, ringR), 0.014, 10, 40);
      const rib = new THREE.Mesh(ribGeo, mainMat);
      rib.rotation.x = Math.PI / 2;
      rib.scale.set(1, zOvalRatio, 1);
      rib.position.y = bodyHeightU * yFrac;
      ribGroup.add(rib);
    }
    bodyGroup.add(ribGroup);
    parts.push({
      id: 'ribs',
      name: 'ribs',
      label: 'Gân gia cường',
      role: 'decorative',
      parentId: 'body',
      geometryMethod: 'tube',
      mesh: ribGroup,
      basePos: ribGroup.position.clone(),
      explodeDir: new THREE.Vector3(0.42, 0, 0),
    });
  }

  // Parent-child assembly: Neck -> Cap (only when backed by Phase 3 data)
  let neckNode: THREE.Object3D = bodyGroup;
  const neckSpec = recon.geometry.components.find((c) => c.role === 'neck');
  const capSpec = recon.geometry.components.find((c) => c.role === 'cap');

  if (hasCap || hasExplicitNeck) {
    const neckR = neckSpec
      ? Math.max(0.06, (neckSpec.sizeRatio.x * widthU) / 2)
      : Math.max(0.08, sampleProfileRadiusAt(points, 0.9) * maxRadiusX);
    const neckH = Math.max(0.05, heightU * 0.055);
    const neckY = bodyHeightU;

    const neckGroup = new THREE.Group();
    neckGroup.name = 'neck';
    neckGroup.position.set(0, neckY, 0);

    const neckGeo = new THREE.CylinderGeometry(neckR * 0.96, neckR * 1.04, neckH, 32);
    const neckMesh = new THREE.Mesh(neckGeo, mainMat);
    neckMesh.name = 'neck_mesh';
    neckMesh.position.set(0, neckH / 2, 0);
    neckMesh.castShadow = true;
    neckGroup.add(neckMesh);
    bodyGroup.add(neckGroup);

    parts.push({
      id: neckSpec?.id || 'neck',
      name: 'neck',
      label: neckSpec?.name || 'Cổ bình / Miệng',
      role: 'neck',
      parentId: 'body',
      geometryMethod: 'cylinder',
      mesh: neckGroup,
      basePos: neckGroup.position.clone(),
      explodeDir: new THREE.Vector3(0, 0.32, 0),
    });
    neckNode = neckGroup;

    if (hasCap) {
      const capR = capSpec
        ? Math.max(0.07, (capSpec.sizeRatio.x * widthU) / 2)
        : neckR * 1.14;
      const capH = capSpec
        ? Math.max(0.06, capSpec.sizeRatio.y * heightU)
        : Math.max(0.075, heightU * 0.078);
      const capColor = normalizeHexColor(
        capSpec?.colorHex || recon.appearance.capColor || recon.appearance.secondaryColor,
        '#0284c7'
      );
      const capMat = createComponentMaterial(capColor, '#0284c7', 0.36, 0.05, {
        role: 'cap',
        qualityMode: options?.qualityMode,
      });
      const capMethod: ThreeGeometryMethod =
        capSpec?.geometryMethod || (capSpec?.shape === 'cone' ? 'cone' : 'cylinder');
      const capGeo =
        capMethod === 'cone'
          ? new THREE.ConeGeometry(capR, capH, 32)
          : new THREE.CylinderGeometry(capR * 0.98, capR * 1.02, capH, 32);
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.name = 'cap';
      capMesh.position.set(0, neckH + capH * 0.42, 0);
      capMesh.castShadow = true;
      neckNode.add(capMesh);

      parts.push({
        id: capSpec?.id || 'cap',
        name: 'cap',
        label: capSpec?.name || 'Nắp đậy',
        role: 'cap',
        parentId: neckSpec?.id || 'neck',
        geometryMethod: capMethod,
        mesh: capMesh,
        basePos: capMesh.position.clone(),
        explodeDir: new THREE.Vector3(0, 0.58, 0),
      });
    }
  }

  // Handle attachment ONLY when explicitly indicated in Phase 3 data
  const handleSpec = recon.geometry.components.find((c) => c.role === 'handle');
  if (recon.geometry.hasHandle || handleSpec) {
    buildHandleAttachment(bodyGroup, recon, parts, bodyHeightU, widthU, handleSpec);
  }

  // Label band ONLY when hasLabel === true or explicit label component
  const labelSpec = recon.geometry.components.find((c) => c.role === 'label');
  if (recon.geometry.hasLabel || labelSpec) {
    const bandMin = recon.geometry.labelBandY?.[0] ?? 0.28;
    const bandMax = recon.geometry.labelBandY?.[1] ?? 0.62;
    const bandMid = (bandMin + bandMax) * 0.5;
    const labelH = Math.max(0.08, bodyHeightU * (bandMax - bandMin));
    const labelR = sampleProfileRadiusAt(normalizedBodyPts, bandMid) * maxRadiusX * 1.02;

    const labelGeo = new THREE.CylinderGeometry(labelR, labelR, labelH, 40, 1, true);
    if (Math.abs(zOvalRatio - 1) > 0.04) labelGeo.scale(1, 1, zOvalRatio);
    const labelMat = createComponentMaterial(
      labelSpec?.colorHex || recon.appearance.labelColor || recon.appearance.secondaryColor,
      '#38bdf8',
      0.4,
      0.04,
      {
        role: 'label',
        texture: options?.labelTexture || null,
        qualityMode: options?.qualityMode,
      }
    );
    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.name = 'label';
    labelMesh.position.set(0, bodyHeightU * bandMid, 0);
    bodyGroup.add(labelMesh);
    parts.push({
      id: labelSpec?.id || 'label',
      name: 'label',
      label: labelSpec?.name || 'Nhãn bọc',
      role: 'label',
      parentId: 'body',
      geometryMethod: 'cylinder',
      mesh: labelMesh,
      basePos: labelMesh.position.clone(),
      explodeDir: new THREE.Vector3(-0.5, 0, 0.25),
    });
  }

  // Additional verified components from Phase 3 (base, top, decorative, detail) not yet instantiated
  const handledRoles = new Set(['body', 'neck', 'cap', 'handle', 'label']);
  const extraComps = recon.geometry.components.filter((c) => !handledRoles.has(c.role));
  attachStructuredChildComponents(bodyGroup, neckNode, extraComps, parts, widthU, heightU, depthU, recon);

  const usableGeo = new THREE.CylinderGeometry(
    maxRadiusX * 1.04,
    maxRadiusX * 1.04,
    heightU * 0.6,
    24,
    1,
    true
  );
  if (Math.abs(zOvalRatio - 1) > 0.04) usableGeo.scale(1, 1, zOvalRatio);
  const usableMesh = new THREE.Mesh(
    usableGeo,
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.24,
      wireframe: true,
      side: THREE.DoubleSide,
    })
  );
  usableMesh.name = 'usableZoneHighlight';
  usableMesh.position.set(0, heightU * 0.44, 0);
  root.add(usableMesh);
}

function attachStructuredChildComponents(
  bodyNode: THREE.Object3D,
  neckNode: THREE.Object3D,
  components: GeometryComponentSpec[],
  parts: ParametricPartEntry[],
  widthU: number,
  heightU: number,
  depthU: number,
  recon: ReconstructionResult
) {
  const nodeMap = new Map<string, THREE.Object3D>();
  nodeMap.set('body', bodyNode);
  nodeMap.set('neck', neckNode);

  components.slice(0, 8).forEach((comp, idx) => {
    const method = resolveComponentGeometryMethod(comp);
    const cx = Math.max(0.05, (comp.sizeRatio?.x || 0.28) * widthU);
    const cy = Math.max(0.05, (comp.sizeRatio?.y || 0.22) * heightU);
    const cz = Math.max(0.05, (comp.sizeRatio?.z || 0.28) * depthU);

    const compGeo = buildGeometryForComponent(comp, method, cx, cy, cz, recon);
    const compMat = createComponentMaterial(
      comp.colorHex,
      recon.appearance.secondaryColor || '#64748b',
      recon.appearance.roughness,
      recon.appearance.metalness
    );

    const parentId = comp.parentId && nodeMap.has(comp.parentId) ? comp.parentId : 'body';
    const parentObj = nodeMap.get(parentId) || bodyNode;

    const compMesh = new THREE.Mesh(compGeo, compMat);
    compMesh.name = comp.id || comp.name || `component_${idx + 1}`;
    compMesh.castShadow = true;
    compMesh.receiveShadow = true;

    let posY = Math.max(cy / 2, (comp.positionRatio?.y ?? 0.5) * heightU);
    if (comp.role === 'base' || comp.role === 'bottom') {
      posY = cy / 2;
    } else if (comp.role === 'top' || comp.role === 'flap_top') {
      posY = heightU - cy / 2;
    }

    compMesh.position.set(
      (comp.positionRatio?.x ?? 0) * widthU,
      posY,
      (comp.positionRatio?.z ?? 0) * depthU
    );

    if (typeof comp.foldAngleDeg === 'number' && Number.isFinite(comp.foldAngleDeg)) {
      compMesh.rotation.x = THREE.MathUtils.degToRad(comp.foldAngleDeg);
    }

    parentObj.add(compMesh);
    nodeMap.set(comp.id, compMesh);

    const explodeY = comp.role === 'base' || comp.role === 'bottom' ? -0.3 : comp.role === 'top' || comp.role === 'flap_top' ? 0.5 : 0.25;
    parts.push({
      id: comp.id || compMesh.name,
      name: compMesh.name,
      label: comp.name || `Bộ phận ${idx + 1}`,
      role: comp.role,
      parentId,
      geometryMethod: method,
      mesh: compMesh,
      basePos: compMesh.position.clone(),
      explodeDir: new THREE.Vector3((idx % 2 === 0 ? 1 : -1) * 0.35, explodeY, 0.2),
    });
  });
}

function buildBoxReconstruction(
  root: THREE.Group,
  recon: ReconstructionResult,
  mainMat: THREE.Material,
  parts: ParametricPartEntry[],
  heightU: number,
  widthU: number,
  depthU: number
) {
  const wallT = Math.max(0.02, Math.min(0.08, (recon.geometry.wallThicknessCm || 0.35) * CM_TO_SCENE));
  const bodyGroup = new THREE.Group();
  bodyGroup.name = 'box_body';
  root.add(bodyGroup);

  const frontGeo = new THREE.BoxGeometry(widthU, heightU, wallT);
  const sideGeo = new THREE.BoxGeometry(wallT, heightU, Math.max(0.05, depthU - wallT * 2));
  const topBotGeo = new THREE.BoxGeometry(widthU, wallT, depthU);

  const panels: Array<{
    id: string;
    role: string;
    label: string;
    geo: THREE.BufferGeometry;
    pos: [number, number, number];
    explode: [number, number, number];
  }> = [
    { id: 'panel_front', role: 'panel_front', label: 'Mặt trước', geo: frontGeo, pos: [0, heightU / 2, depthU / 2 - wallT / 2], explode: [0, 0, 0.45] },
    { id: 'panel_back', role: 'panel_back', label: 'Mặt sau', geo: frontGeo.clone(), pos: [0, heightU / 2, -depthU / 2 + wallT / 2], explode: [0, 0, -0.45] },
    { id: 'panel_left', role: 'panel_side_left', label: 'Mặt trái', geo: sideGeo, pos: [-widthU / 2 + wallT / 2, heightU / 2, 0], explode: [-0.45, 0, 0] },
    { id: 'panel_right', role: 'panel_side_right', label: 'Mặt phải', geo: sideGeo.clone(), pos: [widthU / 2 - wallT / 2, heightU / 2, 0], explode: [0.45, 0, 0] },
    { id: 'panel_bottom', role: 'base', label: 'Mặt đáy', geo: topBotGeo, pos: [0, wallT / 2, 0], explode: [0, -0.25, 0] },
    { id: 'panel_top', role: 'top', label: 'Nắp trên', geo: topBotGeo.clone(), pos: [0, heightU - wallT / 2, 0], explode: [0, 0.55, 0] },
  ];

  for (const p of panels) {
    const mesh = new THREE.Mesh(p.geo, mainMat);
    mesh.name = p.id;
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bodyGroup.add(mesh);
    parts.push({
      id: p.id,
      name: p.id,
      label: p.label,
      role: p.role,
      parentId: 'box_body',
      geometryMethod: 'box',
      mesh,
      basePos: mesh.position.clone(),
      explodeDir: new THREE.Vector3(p.explode[0], p.explode[1], p.explode[2]),
    });
  }

  // Render any extra Phase 3 handle / decorative / label parts attached to the box
  const boxPanelRoles = new Set(['body', 'panel_front', 'panel_back', 'panel_side_left', 'panel_side_right', 'flap_bottom', 'flap_top', 'bottom', 'base', 'top']);
  const extraComps = recon.geometry.components.filter((c) => !boxPanelRoles.has(c.role));
  if (extraComps.length > 0) {
    attachStructuredChildComponents(bodyGroup, bodyGroup, extraComps, parts, widthU, heightU, depthU, recon);
  }
  if (recon.geometry.hasHandle && !extraComps.some((c) => c.role === 'handle')) {
    buildHandleAttachment(bodyGroup, recon, parts, heightU, widthU);
  }

  const usableGeo = new THREE.BoxGeometry(widthU * 1.02, heightU * 0.85, depthU * 1.02);
  const usableMesh = new THREE.Mesh(
    usableGeo,
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.24,
      wireframe: true,
    })
  );
  usableMesh.name = 'usableZoneHighlight';
  usableMesh.position.y = heightU / 2;
  root.add(usableMesh);
}

function buildExtrudedReconstruction(
  root: THREE.Group,
  recon: ReconstructionResult,
  mainMat: THREE.Material,
  parts: ParametricPartEntry[],
  heightU: number,
  widthU: number,
  depthU: number
) {
  const geo = createExtrudePartGeometry(
    recon.geometry.contourPoints,
    widthU,
    heightU,
    depthU,
    recon.geometry.bevelCm
  );

  const bodyMesh = new THREE.Mesh(geo, mainMat);
  bodyMesh.name = 'body';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);

  parts.push({
    id: 'body',
    name: 'body',
    label: 'Khối Extrude theo biên dạng',
    role: 'body',
    parentId: null,
    geometryMethod: 'extrude',
    mesh: bodyMesh,
    basePos: bodyMesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0, 0),
  });

  const extraComps = recon.geometry.components.filter((c) => c.role !== 'body');
  if (extraComps.length > 0) {
    attachStructuredChildComponents(bodyMesh, bodyMesh, extraComps, parts, widthU, heightU, depthU, recon);
  }

  const usableMesh = new THREE.Mesh(
    new THREE.BoxGeometry(widthU * 1.02, heightU * 0.9, depthU * 1.05),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
    })
  );
  usableMesh.name = 'usableZoneHighlight';
  usableMesh.position.y = heightU / 2;
  root.add(usableMesh);
}

function buildTubularReconstruction(
  root: THREE.Group,
  recon: ReconstructionResult,
  mainMat: THREE.Material,
  parts: ParametricPartEntry[],
  heightU: number,
  widthU: number,
  depthU: number
) {
  const tubeRadius = Math.max(0.04, Math.min(0.4, Math.min(widthU, depthU) * 0.36));
  const geo = createTubePartGeometry(recon.geometry.tubularPath, widthU, heightU, depthU, tubeRadius);
  const mesh = new THREE.Mesh(geo, mainMat);
  mesh.name = 'body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);

  parts.push({
    id: 'body',
    name: 'body',
    label: 'Thân ống TubeGeometry',
    role: 'body',
    parentId: null,
    geometryMethod: 'tube',
    mesh,
    basePos: mesh.position.clone(),
    explodeDir: new THREE.Vector3(0, 0.2, 0),
  });

  const extraComps = recon.geometry.components.filter((c) => c.role !== 'body');
  if (extraComps.length > 0) {
    attachStructuredChildComponents(mesh, mesh, extraComps, parts, widthU, heightU, depthU, recon);
  }

  const usableMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(tubeRadius * 1.25, tubeRadius * 1.25, heightU * 0.65, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.25,
      wireframe: true,
    })
  );
  usableMesh.name = 'usableZoneHighlight';
  usableMesh.position.y = heightU * 0.325;
  root.add(usableMesh);
}

/**
 * Centers the reconstructed model on X/Z and grounds min.y strictly at 0
 * (excluding helper wireframe highlight meshes from physical footprint alignment).
 */
export function normalizeAndGroundGroup(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let hasPhysicalMesh = false;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === 'usableZoneHighlight') return;
    const meshBox = new THREE.Box3().setFromObject(mesh);
    if (!meshBox.isEmpty()) {
      box.union(meshBox);
      hasPhysicalMesh = true;
    }
  });

  if (!hasPhysicalMesh || box.isEmpty()) return;

  const center = new THREE.Vector3();
  box.getCenter(center);

  // Offset top-level non-helper children uniformly so model stands centered at (0, 0, 0)
  for (const child of root.children) {
    if (child.name === 'usableZoneHighlight') {
      child.position.y -= box.min.y;
      continue;
    }
    child.position.x -= center.x;
    child.position.z -= center.z;
    child.position.y -= box.min.y;
  }
  root.updateMatrixWorld(true);
}

/**
 * Proportionally or anisotropically resizes the assembled 3D model to match real calibrated
 * centimeter dimensions, re-centering and re-grounding at y = 0.
 */
export function resizeReconstructedModel(
  root: THREE.Object3D,
  targetHeightCm: number,
  targetWidthCm?: number,
  targetDepthCm?: number,
  scaleUnitsPerCm: number = CM_TO_SCENE
): GeometryTelemetry {
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const curBox = new THREE.Box3();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || m.name === 'usableZoneHighlight') return;
    curBox.expandByObject(m);
  });

  const curSize = new THREE.Vector3();
  curBox.getSize(curSize);

  const safeH = Math.max(0.05, curSize.y);
  const safeW = Math.max(0.05, curSize.x);
  const safeD = Math.max(0.05, curSize.z);

  const targetHU = Math.max(0.2, targetHeightCm * scaleUnitsPerCm);
  const sy = targetHU / safeH;
  const sx = targetWidthCm ? Math.max(0.2, targetWidthCm * scaleUnitsPerCm) / safeW : sy;
  const sz = targetDepthCm ? Math.max(0.2, targetDepthCm * scaleUnitsPerCm) / safeD : sx;

  root.scale.set(sx, sy, sz);
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh || m.name === 'usableZoneHighlight') return;
    scaledBox.expandByObject(m);
  });
  if (!scaledBox.isEmpty()) {
    const c = new THREE.Vector3();
    scaledBox.getCenter(c);
    root.position.set(-c.x, -scaledBox.min.y, -c.z);
  }
  root.updateMatrixWorld(true);

  const tel = validateBufferGeometry(root);
  tel.scaleUnitsPerCm = scaleUnitsPerCm;
  return tel;
}

/**
 * Validates every BufferGeometry inside the built Three.js hierarchy for NaN/Infinity,
 * missing/inverted normals, degenerate triangles, grounded alignment, and valid bounds.
 */
export function validateBufferGeometry(
  root: THREE.Object3D,
  partsMeta?: ParametricPartEntry[]
): GeometryTelemetry {
  let meshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let degenerateTriangleCount = 0;
  let invertedNormalCount = 0;
  let estimatedGpuBytes = 0;
  const issues: string[] = [];
  const partNames: string[] = [];
  const methodsSet = new Set<ThreeGeometryMethod>();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  const physicalBox = new THREE.Box3();

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.name === 'usableZoneHighlight') return;
    meshCount++;
    if (mesh.name) partNames.push(mesh.name);

    const geo = mesh.geometry as THREE.BufferGeometry;
    if (!geo) {
      issues.push(`Mesh "${mesh.name}" thiếu BufferGeometry`);
      return;
    }

    if (geo.type === 'BoxGeometry') methodsSet.add('box');
    else if (geo.type === 'CylinderGeometry') methodsSet.add('cylinder');
    else if (geo.type === 'SphereGeometry') methodsSet.add('sphere');
    else if (geo.type === 'ConeGeometry') methodsSet.add('cone');
    else if (geo.type === 'LatheGeometry') methodsSet.add('lathe');
    else if (geo.type === 'ExtrudeGeometry') methodsSet.add('extrude');
    else if (geo.type === 'TubeGeometry') methodsSet.add('tube');
    else methodsSet.add('buffer');

    const pos = geo.getAttribute('position');
    if (!pos || pos.count === 0) {
      issues.push(`Mesh "${mesh.name}" có buffer đỉnh rỗng`);
      return;
    }

    vertexCount += pos.count;
    estimatedGpuBytes += pos.array.byteLength;
    const normal = geo.getAttribute('normal');
    if (!normal || normal.count !== pos.count) {
      issues.push(`Mesh "${mesh.name}" thiếu vertex normal đầy đủ`);
    } else {
      estimatedGpuBytes += normal.array.byteLength;
      for (let i = 0; i < normal.count; i++) {
        const nx = normal.getX(i);
        const ny = normal.getY(i);
        const nz = normal.getZ(i);
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) {
          invertedNormalCount++;
          issues.push(`Mesh "${mesh.name}" chứa pháp tuyến NaN tại đỉnh ${i}`);
          break;
        }
      }
    }

    const uv = geo.getAttribute('uv');
    if (uv) estimatedGpuBytes += uv.array.byteLength;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        issues.push(`Mesh "${mesh.name}" chứa đỉnh NaN/Infinity tại index ${i}`);
        break;
      }
    }

    const idx = geo.getIndex();
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
    triangleCount += triCount;
    if (idx) estimatedGpuBytes += idx.array.byteLength;

    // Sample triangle area integrity (up to 4000 triangles per mesh for O(1) responsiveness)
    const step = Math.max(1, Math.floor(triCount / 4000));
    for (let t = 0; t < triCount; t += step) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      vA.fromBufferAttribute(pos, i0);
      vB.fromBufferAttribute(pos, i1);
      vC.fromBufferAttribute(pos, i2);
      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      if (e1.cross(e2).lengthSq() < 1e-13) {
        degenerateTriangleCount++;
      }
    }

    physicalBox.expandByObject(mesh);
  });

  if (degenerateTriangleCount > Math.max(4, triangleCount * 0.05)) {
    issues.push(`Phát hiện ${degenerateTriangleCount} tam giác suy biến (diện tích ~0).`);
  }

  const size = new THREE.Vector3();
  physicalBox.getSize(size);
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z) || size.y <= 0) {
    issues.push('Bounding box 3D không hợp lệ hoặc kích thước rỗng');
  }

  const partHierarchy: PartHierarchyNode[] = (partsMeta || []).map((p) => {
    methodsSet.add(p.geometryMethod);
    return {
      id: p.id,
      name: p.label,
      role: p.role,
      parentId: p.parentId,
      geometryMethod: p.geometryMethod,
    };
  });

  return {
    valid: issues.length === 0 && meshCount > 0 && vertexCount > 0,
    meshCount,
    vertexCount,
    triangleCount,
    degenerateTriangleCount,
    invertedNormalCount,
    estimatedGpuBytes,
    issues,
    partNames,
    geometryMethodsUsed: Array.from(methodsSet),
    partHierarchy,
    sceneDimensions: {
      x: Number(size.x.toFixed(3)),
      y: Number(size.y.toFixed(3)),
      z: Number(size.z.toFixed(3)),
    },
    groundedMinY: physicalBox.isEmpty() ? 0 : Number(physicalBox.min.y.toFixed(4)),
    scaleUnitsPerCm: CM_TO_SCENE,
  };
}

/**
 * Normalizes UV coordinates strictly to [0..1] (especially fixing ExtrudeGeometry raw world-unit UVs)
 * and mirrors uv -> uv2 for AO/lightmap compatibility.
 */
export function normalizeAndRefineGeometryUVs(
  geometry: THREE.BufferGeometry,
  mode: 'cylindrical' | 'planar' | 'box' = 'planar'
): boolean {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) return false;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return false;
  const size = new THREE.Vector3();
  box.getSize(size);
  const safeW = Math.max(1e-4, size.x);
  const safeH = Math.max(1e-4, size.y);
  const safeD = Math.max(1e-4, size.z);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const uv = geometry.getAttribute('uv');
  let needsRemap = !uv || uv.count !== pos.count;

  if (!needsRemap && uv) {
    let outOfBounds = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (!Number.isFinite(u) || !Number.isFinite(v) || u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) {
        outOfBounds++;
      }
    }
    if (outOfBounds > Math.max(2, uv.count * 0.05)) {
      needsRemap = true;
    }
  }

  if (!needsRemap && uv) {
    if (!geometry.getAttribute('uv2')) {
      geometry.setAttribute('uv2', uv.clone());
    }
    return false;
  }

  const norm = geometry.getAttribute('normal');
  const nextUv = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    let u = 0;
    let v = 0;
    if (mode === 'cylindrical') {
      const angle = Math.atan2(-(z - center.z), x - center.x);
      u = (angle / (Math.PI * 2) + 1) % 1;
      v = (y - box.min.y) / safeH;
    } else if (mode === 'box' && norm) {
      const nx = Math.abs(norm.getX(i));
      const ny = Math.abs(norm.getY(i));
      const nz = Math.abs(norm.getZ(i));
      if (nx >= ny && nx >= nz) {
        u = (z - box.min.z) / safeD;
        v = (y - box.min.y) / safeH;
      } else if (ny >= nx && ny >= nz) {
        u = (x - box.min.x) / safeW;
        v = (z - box.min.z) / safeD;
      } else {
        u = (x - box.min.x) / safeW;
        v = (y - box.min.y) / safeH;
      }
    } else {
      u = (x - box.min.x) / safeW;
      v = (y - box.min.y) / safeH;
    }

    nextUv[i * 2] = Math.max(0, Math.min(1, Number.isFinite(u) ? u : 0));
    nextUv[i * 2 + 1] = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  }

  const uvAttr = new THREE.Float32BufferAttribute(nextUv, 2);
  geometry.setAttribute('uv', uvAttr);
  geometry.setAttribute('uv2', uvAttr.clone());
  return true;
}

/**
 * Safely computes MikkTSpace vertex tangents only when index, position, normal, and uv are valid.
 */
export function computeTangentsSafe(geometry: THREE.BufferGeometry): boolean {
  const pos = geometry.getAttribute('position');
  const norm = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const idx = geometry.getIndex();
  if (!pos || !norm || !uv || !idx || pos.count === 0 || idx.count < 3) {
    return false;
  }
  try {
    geometry.computeTangents();
    return Boolean(geometry.getAttribute('tangent'));
  } catch {
    return false;
  }
}

/**
 * Phase 6 Geometry Refinement pipeline:
 * - Fixes NaN coordinates
 * - Prunes zero-area degenerate triangles cleanly
 * - Repairs missing/inverted normals
 * - Optionally applies bounded, proportion-preserving Laplacian smoothing for deformed organic surfaces
 * - Normalizes out-of-range UVs and computes vertex tangents
 */
export function refineBufferGeometry(
  geometry: THREE.BufferGeometry,
  options?: {
    mode?: 'cylindrical' | 'planar' | 'box';
    smoothOrganic?: boolean;
    fixOutwardNormals?: boolean;
    computeTangents?: boolean;
  }
): {
  degenerateRemoved: number;
  normalsFixed: boolean;
  uvNormalized: boolean;
  tangentsComputed: boolean;
  proportionsPreservedRatio: number;
} {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count === 0) {
    return {
      degenerateRemoved: 0,
      normalsFixed: false,
      uvNormalized: false,
      tangentsComputed: false,
      proportionsPreservedRatio: 1,
    };
  }

  // 1. Replace any NaN/Infinity positions safely
  let fixedPosNan = false;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      pos.setXYZ(i, Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0);
      fixedPosNan = true;
    }
  }
  if (fixedPosNan) pos.needsUpdate = true;

  geometry.computeBoundingBox();
  const origSize = new THREE.Vector3();
  geometry.boundingBox?.getSize(origSize);

  // 2. Remove degenerate zero-area triangles (indexed geometry)
  let degenerateRemoved = 0;
  const idx = geometry.getIndex();
  if (idx && idx.count >= 3) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const cleanIndices: number[] = [];

    for (let t = 0; t + 2 < idx.count; t += 3) {
      const i0 = idx.getX(t);
      const i1 = idx.getX(t + 1);
      const i2 = idx.getX(t + 2);
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        degenerateRemoved++;
        continue;
      }
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      if (e1.cross(e2).lengthSq() < 1e-13) {
        degenerateRemoved++;
        continue;
      }
      cleanIndices.push(i0, i1, i2);
    }

    if (degenerateRemoved > 0 && cleanIndices.length >= 3) {
      geometry.setIndex(cleanIndices);
    }
  }

  // 3. Bounded crease-preserving Laplacian smoothing for organic/deformed geometry (strictly preserving extents)
  if (options?.smoothOrganic && geometry.getIndex() && pos.count >= 12) {
    const cleanIdx = geometry.getIndex()!;
    const accum = new Float32Array(pos.count * 3);
    const counts = new Uint16Array(pos.count);

    for (let t = 0; t + 2 < cleanIdx.count; t += 3) {
      const i0 = cleanIdx.getX(t);
      const i1 = cleanIdx.getX(t + 1);
      const i2 = cleanIdx.getX(t + 2);
      const pairs: Array<[number, number]> = [
        [i0, i1],
        [i1, i2],
        [i2, i0],
      ];
      for (const [u, v] of pairs) {
        accum[u * 3] += pos.getX(v);
        accum[u * 3 + 1] += pos.getY(v);
        accum[u * 3 + 2] += pos.getZ(v);
        counts[u]++;

        accum[v * 3] += pos.getX(u);
        accum[v * 3 + 1] += pos.getY(u);
        accum[v * 3 + 2] += pos.getZ(u);
        counts[v]++;
      }
    }

    const alpha = 0.22;
    const minY = geometry.boundingBox?.min.y ?? 0;
    const maxY = geometry.boundingBox?.max.y ?? 1;
    const yEps = Math.max(1e-4, origSize.y * 0.02);

    for (let i = 0; i < pos.count; i++) {
      const n = counts[i];
      if (n < 2) continue;
      const y = pos.getY(i);
      // Pin top & bottom rims to protect silhouette height and flat seating
      if (Math.abs(y - minY) < yEps || Math.abs(y - maxY) < yEps) continue;
      const nx = pos.getX(i) * (1 - alpha) + (accum[i * 3] / n) * alpha;
      const ny = y * (1 - alpha * 0.35) + (accum[i * 3 + 1] / n) * (alpha * 0.35);
      const nz = pos.getZ(i) * (1 - alpha) + (accum[i * 3 + 2] / n) * alpha;
      pos.setXYZ(i, nx, ny, nz);
    }

    // Restore original exact bounding-box proportions so zero silhouette shrinkage happens
    pos.needsUpdate = true;
    geometry.computeBoundingBox();
    const postSize = new THREE.Vector3();
    geometry.boundingBox?.getSize(postSize);
    if (origSize.x > 1e-4 && origSize.y > 1e-4 && origSize.z > 1e-4 && postSize.x > 1e-4 && postSize.y > 1e-4 && postSize.z > 1e-4) {
      const postCenter = new THREE.Vector3();
      geometry.boundingBox?.getCenter(postCenter);
      const sx = origSize.x / postSize.x;
      const sy = origSize.y / postSize.y;
      const sz = origSize.z / postSize.z;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          postCenter.x + (pos.getX(i) - postCenter.x) * sx,
          (geometry.boundingBox?.min.y ?? 0) + (pos.getY(i) - (geometry.boundingBox?.min.y ?? 0)) * sy,
          postCenter.z + (pos.getZ(i) - postCenter.z) * sz
        );
      }
      pos.needsUpdate = true;
    }
  }

  // 4. Repair missing or invalid normals
  let normalsFixed = false;
  const norm = geometry.getAttribute('normal');
  if (!norm || norm.count !== pos.count) {
    geometry.computeVertexNormals();
    normalsFixed = true;
  } else {
    for (let i = 0; i < norm.count; i++) {
      if (!Number.isFinite(norm.getX(i)) || !Number.isFinite(norm.getY(i)) || !Number.isFinite(norm.getZ(i))) {
        geometry.computeVertexNormals();
        normalsFixed = true;
        break;
      }
    }
  }

  if (options?.fixOutwardNormals) {
    verifyAndFixOutwardNormals(geometry);
  }

  // 5. Normalize UVs & compute safe tangents
  const uvNormalized = normalizeAndRefineGeometryUVs(geometry, options?.mode || 'planar');
  const tangentsComputed = options?.computeTangents ? computeTangentsSafe(geometry) : false;

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const finalSize = new THREE.Vector3();
  geometry.boundingBox?.getSize(finalSize);
  let proportionsPreservedRatio = 1;
  if (origSize.y > 1e-4 && origSize.x > 1e-4) {
    const origRatio = origSize.x / origSize.y;
    const nextRatio = finalSize.x / Math.max(1e-4, finalSize.y);
    proportionsPreservedRatio = Number(
      Math.max(0, Math.min(1, 1 - Math.abs(origRatio - nextRatio) / Math.max(origRatio, 0.01))).toFixed(4)
    );
  }

  return {
    degenerateRemoved,
    normalsFixed,
    uvNormalized,
    tangentsComputed,
    proportionsPreservedRatio,
  };
}

/**
 * Optimizes any Three.js Object3D subtree (Phase 4 Parametric, Craft, or Phase 5 GLB)
 * for geometry hygiene, UV alignment, PBR material fidelity, and WebGL colorSpace correctness.
 */
export function optimizeSceneForQualityAndPerformance(
  root: THREE.Object3D,
  options?: {
    isSoftwareGl?: boolean;
    materialType?: DetailedMaterialType;
    textureModeUsed?: TextureProjectionMode | 'none';
    smoothOrganic?: boolean;
    fixOutwardNormals?: boolean;
  }
): {
  beforeTelemetry: GeometryTelemetry;
  afterTelemetry: GeometryTelemetry;
  refinementReport: GeometryRefinementReport;
  uvMetrics: UvAlignmentMetrics | null;
} {
  ensureSharedCacheFlags();
  const beforeTelemetry = validateBufferGeometry(root);
  let beforeUvSum = 0;
  let beforeUvMeshes = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === 'usableZoneHighlight' || !mesh.geometry) return;
    const uvStat = analyzeUvAndTextureAlignment(mesh.geometry as THREE.BufferGeometry);
    beforeUvSum += uvStat.uvCoverageRatio;
    beforeUvMeshes++;
  });

  let totalDegenerateRemoved = 0;
  let totalNormalsFixed = 0;
  let uvNormalizedMeshes = 0;
  let tangentsComputedMeshes = 0;
  let materialsEnhanced = 0;
  let propRatioSum = 0;
  let propRatioCount = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === 'usableZoneHighlight' || !mesh.geometry) return;

    const geo = mesh.geometry as THREE.BufferGeometry;
    const isCylinder =
      geo.type === 'LatheGeometry' || geo.type === 'CylinderGeometry' || mesh.name === 'label' || mesh.name === 'body';
    const isBox = geo.type === 'BoxGeometry';

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasBumpOrNormal = mats.some((m: any) => Boolean(m && (m.normalMap || m.bumpMap)));

    const ref = refineBufferGeometry(geo, {
      mode: isBox ? 'box' : isCylinder ? 'cylindrical' : 'planar',
      smoothOrganic: Boolean(options?.smoothOrganic) && (geo.type === 'BufferGeometry' || geo.type === 'LatheGeometry') && mesh.name !== 'label',
      fixOutwardNormals: Boolean(options?.fixOutwardNormals) && geo.type === 'BufferGeometry',
      computeTangents: hasBumpOrNormal,
    });

    totalDegenerateRemoved += ref.degenerateRemoved;
    if (ref.normalsFixed) totalNormalsFixed++;
    if (ref.uvNormalized) uvNormalizedMeshes++;
    if (ref.tangentsComputed) tangentsComputedMeshes++;
    propRatioSum += ref.proportionsPreservedRatio;
    propRatioCount++;

    for (const m of mats) {
      if (!m) continue;
      const std = m as THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
      if (std.isMeshStandardMaterial || (std as any).isMeshPhysicalMaterial) {
        if (std.map) {
          std.map.colorSpace = THREE.SRGBColorSpace;
          std.map.anisotropy = options?.isSoftwareGl ? 1 : 4;
        }
        if (std.emissiveMap) {
          std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        }
        for (const dataKey of ['normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'aoMap'] as const) {
          const tex = (std as any)[dataKey] as THREE.Texture | undefined;
          if (tex) {
            tex.colorSpace = THREE.NoColorSpace;
          }
        }
        if (options?.materialType && mesh.name !== 'label' && mesh.name !== 'cap') {
          attachMaterialMicroMaps(std, options.materialType, Boolean(std.map));
        }
        std.envMapIntensity = 1.05;
        std.needsUpdate = true;
        materialsEnhanced++;
      }
    }
  });

  const afterTelemetry = validateBufferGeometry(root);
  let afterUvMetrics: UvAlignmentMetrics | null = null;
  let afterUvSum = 0;
  let afterUvMeshes = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === 'usableZoneHighlight' || !mesh.geometry) return;
    const uvStat = analyzeUvAndTextureAlignment(mesh.geometry as THREE.BufferGeometry);
    afterUvSum += uvStat.uvCoverageRatio;
    afterUvMeshes++;
    if (!afterUvMetrics || mesh.name === 'body' || mesh.name === 'panel_front') {
      afterUvMetrics = uvStat;
    }
  });

  const refinementReport: GeometryRefinementReport = {
    before: {
      vertexCount: beforeTelemetry.vertexCount,
      triangleCount: beforeTelemetry.triangleCount,
      degenerateTriangles: beforeTelemetry.degenerateTriangleCount,
      invertedNormals: beforeTelemetry.invertedNormalCount,
      uvCoverageRatio: beforeUvMeshes > 0 ? Number((beforeUvSum / beforeUvMeshes).toFixed(3)) : 0,
    },
    after: {
      vertexCount: afterTelemetry.vertexCount,
      triangleCount: afterTelemetry.triangleCount,
      degenerateTriangles: afterTelemetry.degenerateTriangleCount,
      invertedNormals: afterTelemetry.invertedNormalCount,
      uvCoverageRatio: afterUvMeshes > 0 ? Number((afterUvSum / afterUvMeshes).toFixed(3)) : 0,
    },
    degenerateRemoved: totalDegenerateRemoved,
    normalsFixed: totalNormalsFixed,
    uvNormalizedMeshes,
    tangentsComputedMeshes,
    proportionsPreservedRatio: propRatioCount > 0 ? Number((propRatioSum / propRatioCount).toFixed(4)) : 1,
    smoothingApplied: Boolean(options?.smoothOrganic),
    materialsEnhanced,
    textureModeUsed: options?.textureModeUsed || 'none',
  };

  return {
    beforeTelemetry,
    afterTelemetry,
    refinementReport,
    uvMetrics: afterUvMetrics,
  };
}

/**
 * Disposes all GPU geometries, materials, and non-shared textures in a Three.js Object3D subtree.
 * Preserves globally cached procedural textures (marked with userData.isSharedCache = true).
 */
export function disposeObject3D(root: THREE.Object3D | null | undefined) {
  if (!root) return;
  root.traverse((child) => {
    const anyChild = child as any;
    if (anyChild.geometry && typeof anyChild.geometry.dispose === 'function') {
      anyChild.geometry.dispose();
    }
    if (anyChild.material) {
      const mats = Array.isArray(anyChild.material) ? anyChild.material : [anyChild.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of [
          'map',
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'bumpMap',
          'alphaMap',
          'aoMap',
          'emissiveMap',
        ]) {
          const tex = m[key];
          if (tex && !tex.userData?.isSharedCache && typeof tex.dispose === 'function') {
            tex.dispose();
          }
        }
        if (typeof m.dispose === 'function') m.dispose();
      }
    }
  });
}

/**
 * Inspects an imported GLTF/GLB Three.js scene graph, normalizes scale to match target scene
 * dimensions (or safe 1.6..2.8 scene units), centers X/Z and grounds min.y strictly at 0.
 */
export function inspectAndNormalizeGlbScene(
  root: THREE.Object3D,
  options?: {
    targetHeightCm?: number | null;
    targetSceneHeightU?: number;
    scaleUnitsPerCm?: number;
    enableShadows?: boolean;
  }
): GlbInspectionReport {
  const scaleUnitsPerCm = options?.scaleUnitsPerCm ?? CM_TO_SCENE;
  const targetHeightCm = Math.max(2, Number(options?.targetHeightCm) || 20);
  const desiredHeightU =
    options?.targetSceneHeightU ?? Math.max(0.9, Math.min(3.0, targetHeightCm * scaleUnitsPerCm));
  const enableShadows = options?.enableShadows ?? true;

  root.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(root);
  const rawSize = new THREE.Vector3();
  rawBox.getSize(rawSize);

  const maxRaw = Math.max(rawSize.x, rawSize.y, rawSize.z);
  const issues: string[] = [];

  if (!Number.isFinite(maxRaw) || maxRaw <= 1e-5) {
    issues.push('Bounding box của mô hình GLB bằng 0 hoặc chứa NaN/Infinity.');
  }

  const scaleFactor = Number.isFinite(maxRaw) && maxRaw > 1e-5 ? desiredHeightU / maxRaw : 1;
  root.scale.setScalar(scaleFactor);
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  if (!scaledBox.isEmpty()) {
    root.position.set(-center.x, -scaledBox.min.y, -center.z);
    root.updateMatrixWorld(true);
  }

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);

  const materialSet = new Set<THREE.Material>();
  const textureSet = new Set<THREE.Texture>();
  let meshCount = 0;
  let nodeCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let hasPbrMaterials = false;

  root.traverse((obj) => {
    nodeCount++;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount++;
    mesh.castShadow = enableShadows;
    mesh.receiveShadow = enableShadows;

    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geo) {
      const pos = geo.getAttribute('position');
      if (pos) vertexCount += pos.count;
      const idx = geo.getIndex();
      triangleCount += idx ? Math.floor(idx.count / 3) : pos ? Math.floor(pos.count / 3) : 0;
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      materialSet.add(m);
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial || (std as any).isMeshPhysicalMaterial) {
        hasPbrMaterials = true;
      }
      for (const texKey of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
        const tex = (std as any)[texKey] as THREE.Texture | undefined;
        if (tex) {
          if (texKey === 'map' || texKey === 'emissiveMap') {
            tex.colorSpace = THREE.SRGBColorSpace;
          } else {
            tex.colorSpace = THREE.NoColorSpace;
          }
          textureSet.add(tex);
        }
      }
    }
  });

  if (meshCount === 0) {
    issues.push('Scene GLB không chứa bất kỳ Mesh nào.');
  }

  return {
    valid: issues.length === 0 && meshCount > 0 && vertexCount > 0,
    source: 'client_gltf',
    meshCount,
    materialCount: materialSet.size,
    textureCount: textureSet.size,
    nodeCount,
    hasEmbeddedTextures: textureSet.size > 0,
    hasPbrMaterials,
    vertexCount,
    triangleCount,
    boundingBoxCm: {
      x: Number((finalSize.x / scaleUnitsPerCm).toFixed(2)),
      y: Number((finalSize.y / scaleUnitsPerCm).toFixed(2)),
      z: Number((finalSize.z / scaleUnitsPerCm).toFixed(2)),
    },
    groundedMinY: finalBox.isEmpty() ? 0 : Number(finalBox.min.y.toFixed(4)),
    scaleFactor: Number(scaleFactor.toFixed(4)),
    issues,
  };
}

/**
 * Main Phase 4 + Phase 6 Parametric & Custom Geometry 3D Builder driven strictly by validated Phase 3 data.
 * Supports qualityMode ('optimized' vs 'raw') for genuine Before-vs-After visual & telemetry comparison.
 */
export async function buildParametricReconstructionMesh(
  options: ParametricBuildOptions
): Promise<ParametricBuildOutput> {
  const {
    material,
    isSoftwareGl = false,
    usePhotoTexture = true,
    qualityMode = 'optimized',
  } = options;
  const recon = ensureMaterialReconstruction(material);
  const validation = validatePhase3GeometryInput(recon);

  const dims = recon.dimensions;
  const heightCm = Math.max(2, Number(dims.heightCm) || 18);
  const widthCm = Math.max(2, Number(dims.widthCm) || 7);
  const depthCm = Math.max(2, Number(dims.depthCm) || widthCm);

  const maxDim = Math.max(heightCm, widthCm, depthCm);
  const adaptiveScale = maxDim > 45 ? 3.8 / maxDim : maxDim < 6 ? 1.2 / maxDim : CM_TO_SCENE;

  const heightU = heightCm * adaptiveScale;
  const widthU = widthCm * adaptiveScale;
  const depthU = depthCm * adaptiveScale;

  const primaryMethod = selectPrimaryGeometryMethod(recon);
  const bodyProjMode: TextureProjectionMode =
    primaryMethod === 'box' || primaryMethod === 'extrude' ? 'planar_face' : 'cylindrical_body';

  let photoTexture: THREE.Texture | null = null;
  let labelTexture: THREE.Texture | null = null;
  let textureModeUsed: TextureProjectionMode | 'none' = 'none';

  const photoSource =
    recon.segmentation.croppedObjectUrl ||
    recon.segmentation.processedImageUrl ||
    material.images?.[0] ||
    null;

  if (usePhotoTexture && photoSource && typeof document !== 'undefined') {
    try {
      const bodyMode: TextureProjectionMode =
        qualityMode === 'raw' ? 'cylindrical_body' : bodyProjMode;
      const canvas = await extractObjectTextureCanvas(photoSource, {
        size: 512,
        mode: bodyMode,
        fallbackTintHex: recon.appearance.primaryColor,
      });
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = isSoftwareGl ? 1 : 4;
      tex.needsUpdate = true;
      photoTexture = tex;
      textureModeUsed = bodyMode;

      // Dedicated component-level label extraction in optimized mode when object has a label band
      if (
        qualityMode === 'optimized' &&
        (recon.geometry.hasLabel || recon.geometry.components.some((c) => c.role === 'label'))
      ) {
        const lblCanvas = await extractObjectTextureCanvas(photoSource, {
          size: 512,
          mode: 'label_band',
          labelBandY: recon.geometry.labelBandY,
          fallbackTintHex: recon.appearance.labelColor || recon.appearance.secondaryColor || '#e2e8f0',
        });
        const lTex = new THREE.CanvasTexture(lblCanvas);
        lTex.colorSpace = THREE.SRGBColorSpace;
        lTex.anisotropy = isSoftwareGl ? 1 : 4;
        lTex.needsUpdate = true;
        labelTexture = lTex;
        textureModeUsed = 'label_band';
      }
    } catch {
      photoTexture = null;
      labelTexture = null;
    }
  }

  const root = new THREE.Group();
  root.name = 'parametric_reconstruction_root';
  const parts: ParametricPartEntry[] = [];
  const mainMat = createSurfaceMaterial(recon, isSoftwareGl, photoTexture, qualityMode);

  if (primaryMethod === 'box') {
    buildBoxReconstruction(root, recon, mainMat, parts, heightU, widthU, depthU);
  } else if (primaryMethod === 'extrude') {
    buildExtrudedReconstruction(root, recon, mainMat, parts, heightU, widthU, depthU);
  } else if (primaryMethod === 'tube') {
    buildTubularReconstruction(root, recon, mainMat, parts, heightU, widthU, depthU);
  } else {
    buildLatheOrBufferBodyReconstruction(
      root,
      recon,
      mainMat,
      parts,
      heightU,
      widthU,
      depthU,
      primaryMethod,
      { labelTexture, qualityMode }
    );
  }

  // Strictly center on X/Z and seat physical base at y = 0
  normalizeAndGroundGroup(root);
  // Sync recorded basePos after grounding offset
  for (const p of parts) {
    p.basePos.copy(p.mesh.position);
  }

  let refinementReport: GeometryRefinementReport | null = null;
  let uvMetrics: UvAlignmentMetrics | null = null;
  let telemetry: GeometryTelemetry;

  if (qualityMode === 'optimized') {
    const hasDeform =
      (recon.geometry.dentRegions && recon.geometry.dentRegions.length > 0) ||
      (recon.geometry.creaseStrength || 0) > 0.05;
    const opt = optimizeSceneForQualityAndPerformance(root, {
      isSoftwareGl,
      materialType: recon.object.material,
      textureModeUsed,
      smoothOrganic: Boolean(hasDeform),
      fixOutwardNormals: primaryMethod === 'buffer' || primaryMethod === 'extrude',
    });
    refinementReport = opt.refinementReport;
    uvMetrics = opt.uvMetrics;
    telemetry = validateBufferGeometry(root, parts);
  } else {
    telemetry = validateBufferGeometry(root, parts);
    const bodyMesh = root.getObjectByName('body') as THREE.Mesh | undefined;
    if (bodyMesh?.geometry) {
      uvMetrics = analyzeUvAndTextureAlignment(bodyMesh.geometry as THREE.BufferGeometry);
    }
  }

  telemetry.scaleUnitsPerCm = adaptiveScale;

  return {
    group: root,
    parts,
    telemetry,
    validation,
    reconstruction: recon,
    textureCreated: photoTexture,
    refinementReport,
    uvMetrics,
  };
}
