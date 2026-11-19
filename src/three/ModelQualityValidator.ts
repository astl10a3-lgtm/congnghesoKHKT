import * as THREE from 'three';
import type { MultiViewConsistencyReport } from '../vision/multiViewConsistency';
import {
  analyzeUvAndTextureAlignment,
  evaluateSilhouetteOverlap,
  type UvAlignmentMetrics,
} from '../vision/textureExtractor';
import type { ProfilePoint, ReconstructionResult } from '../types/reconstruction';
import type {
  GeometryRefinementReport,
  GeometryTelemetry,
  ParametricPartEntry,
} from './GeometryReconstructionEngine';

export type ValidationMetricKey =
  | 'silhouetteSimilarity'
  | 'shapeConsistency'
  | 'componentProportions'
  | 'multiViewConsistency'
  | 'textureAlignment'
  | 'meshQuality';

export interface ValidationCriterionResult {
  key: ValidationMetricKey;
  label: string;
  score: number | null; // 0..1 when backed by real reference data; strictly null when unverified
  status: 'passed' | 'warning' | 'failed' | 'unverified';
  detail: string;
  evidence: string;
}

export interface Phase6QualityValidationReport {
  overallScore: number | null;
  availableMetricsCount: number;
  totalMetricsCount: 6;
  criteria: ValidationCriterionResult[];
  issues: string[];
  summary: string;
}

function statusFromScore(score: number): 'passed' | 'warning' | 'failed' {
  if (score >= 0.78) return 'passed';
  if (score >= 0.55) return 'warning';
  return 'failed';
}

/**
 * Evaluates a reconstructed or imported 3D model across all 6 Phase 6 validation dimensions.
 * Strictly returns `score: null` when corresponding reference data (2D mask, multi-view photos,
 * centimeter specs, or multi-component parts) is absent — never fabricates accuracy numbers.
 */
export function validateModelQualityPhase6(params: {
  root?: THREE.Object3D | null;
  recon: ReconstructionResult;
  telemetry: GeometryTelemetry;
  parts?: ParametricPartEntry[];
  maskProfile?: ProfilePoint[];
  multiViewReport?: MultiViewConsistencyReport | null;
  hasPhotoTexture?: boolean;
  refinementReport?: GeometryRefinementReport | null;
  uvMetrics?: UvAlignmentMetrics | null;
}): Phase6QualityValidationReport {
  const {
    root,
    recon,
    telemetry,
    parts = [],
    maskProfile = [],
    multiViewReport = null,
    hasPhotoTexture = false,
    refinementReport = null,
    uvMetrics = null,
  } = params;

  const issues: string[] = [];

  // 1. Silhouette Similarity (IoU against segmented 2D mask profile)
  let silhouetteCriterion: ValidationCriterionResult;
  const silEval = evaluateSilhouetteOverlap(recon.geometry.profilePoints || [], maskProfile);
  const measuredIou = silEval.iou ?? recon.quality.silhouetteOverlapIoU ?? null;

  if (measuredIou !== null && Number.isFinite(measuredIou)) {
    const score = Number(Math.max(0, Math.min(1, measuredIou)).toFixed(3));
    const status = statusFromScore(score);
    if (status === 'failed') {
      issues.push(`Độ khớp đường bao 2D↔3D thấp (${Math.round(score * 100)}%).`);
    }
    silhouetteCriterion = {
      key: 'silhouetteSimilarity',
      label: 'Silhouette Similarity (2D ↔ 3D IoU)',
      score,
      status,
      detail:
        silEval.meanRadiusError !== null
          ? `IoU đạt ${Math.round(score * 100)}% (sai số bán kính TB ${Math.round(silEval.meanRadiusError * 100)}%).`
          : `Độ khớp đường bao IoU đạt ${Math.round(score * 100)}%.`,
      evidence: maskProfile.length >= 3 ? `Đối chiếu trực tiếp ${maskProfile.length} điểm mask 2D` : 'Từ dữ liệu IoU phân tích',
    };
  } else {
    silhouetteCriterion = {
      key: 'silhouetteSimilarity',
      label: 'Silhouette Similarity (2D ↔ 3D IoU)',
      score: null,
      status: 'unverified',
      detail: 'Chưa có đường bao mask 2D (từ bước tách nền) để đo IoU.',
      evidence: 'Không có dữ liệu đối chiếu',
    };
  }

  // 2. Shape Consistency (3D Bounding Box vs Phase 3 Calibrated Proportions)
  let shapeCriterion: ValidationCriterionResult;
  const targetH = recon.dimensions.heightCm;
  const targetW = recon.dimensions.widthCm ?? recon.dimensions.maxDiameterCm;
  const targetD = recon.dimensions.depthCm ?? targetW;
  const sDim = telemetry.sceneDimensions;

  if (targetH && targetW && targetH > 0 && targetW > 0 && sDim.y > 0.01 && sDim.x > 0.01) {
    const targetWH = targetW / targetH;
    const actualWH = sDim.x / sDim.y;
    const errWH = Math.abs(actualWH - targetWH) / Math.max(0.05, targetWH);

    let meanErr = errWH;
    if (targetD && targetD > 0 && sDim.z > 0.01) {
      const targetDH = targetD / targetH;
      const actualDH = sDim.z / sDim.y;
      const errDH = Math.abs(actualDH - targetDH) / Math.max(0.05, targetDH);
      meanErr = (errWH + errDH) / 2;
    }

    const propPreserved = refinementReport?.proportionsPreservedRatio ?? 1;
    const score = Number(Math.max(0, Math.min(1, (1 - meanErr) * propPreserved)).toFixed(3));
    const status = statusFromScore(score);
    if (status === 'failed') {
      issues.push(`Tỷ lệ W:H:D lệch ${Math.round(meanErr * 100)}% so với thông số kích thước thực.`);
    }
    shapeCriterion = {
      key: 'shapeConsistency',
      label: 'Shape & Proportion Consistency',
      score,
      status,
      detail: `Sai lệch tỷ lệ kích thước W:H:D là ${Math.round(meanErr * 100)}% (bảo toàn tinh chỉnh ${Math.round(propPreserved * 100)}%).`,
      evidence: `3D: ${sDim.x.toFixed(2)}×${sDim.y.toFixed(2)}×${sDim.z.toFixed(2)}u vs ${targetW}×${targetH}×${targetD || targetW}cm`,
    };
  } else {
    shapeCriterion = {
      key: 'shapeConsistency',
      label: 'Shape & Proportion Consistency',
      score: null,
      status: 'unverified',
      detail: 'Thiếu kích thước chuẩn cm hoặc chiều cao scene để kiểm chứng tỷ lệ.',
      evidence: 'Thiếu dữ liệu kích thước đối chiếu',
    };
  }

  // 3. Component Proportions (Multi-part Spatial & Size Cohesion)
  let compCriterion: ValidationCriterionResult;
  if (root && telemetry.meshCount >= 2) {
    root.updateMatrixWorld(true);
    const rootBox = new THREE.Box3();
    const childBoxes: THREE.Box3[] = [];
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || m.name === 'usableZoneHighlight') return;
      const b = new THREE.Box3().setFromObject(m);
      if (!b.isEmpty()) {
        rootBox.union(b);
        childBoxes.push(b);
      }
    });

    const rootSize = new THREE.Vector3();
    rootBox.getSize(rootSize);
    const diag = Math.max(0.1, rootSize.length());

    let outlierParts = 0;
    let oversizedParts = 0;
    for (const cb of childBoxes) {
      const cCenter = new THREE.Vector3();
      cb.getCenter(cCenter);
      const rCenter = new THREE.Vector3();
      rootBox.getCenter(rCenter);
      if (cCenter.distanceTo(rCenter) > diag * 0.72) outlierParts++;

      const cSize = new THREE.Vector3();
      cb.getSize(cSize);
      if (cSize.length() > diag * 1.15) oversizedParts++;
    }

    const penalty = outlierParts * 0.25 + oversizedParts * 0.2;
    const score = Number(Math.max(0, Math.min(1, 1 - penalty)).toFixed(3));
    const status = statusFromScore(score);
    if (outlierParts > 0) {
      issues.push(`${outlierParts} bộ phận nằm lệch quá xa khối thân chính.`);
    }
    compCriterion = {
      key: 'componentProportions',
      label: 'Component Proportions & Cohesion',
      score,
      status,
      detail:
        outlierParts === 0
          ? `${Math.max(telemetry.meshCount, parts.length)} bộ phận gắn kết khít trong khung bao vật thể.`
          : `Phát hiện ${outlierParts} bộ phận có vị trí lệch bất thường.`,
      evidence: `Kiểm tra ${childBoxes.length} sub-mesh thực tế`,
    };
  } else {
    compCriterion = {
      key: 'componentProportions',
      label: 'Component Proportions & Cohesion',
      score: null,
      status: 'unverified',
      detail: 'Mô hình đơn khối (1 bộ phận) — không áp dụng kiểm tra tỷ lệ lắp ghép đa thành phần.',
      evidence: `Số mesh: ${telemetry.meshCount}`,
    };
  }

  // 4. Multi-View Consistency (Strictly requires >= 2 views compared)
  let mvCriterion: ValidationCriterionResult;
  if (multiViewReport && multiViewReport.checkedPairs > 0) {
    const score = Number(Math.max(0, Math.min(1, multiViewReport.consistencyScore)).toFixed(3));
    const status = multiViewReport.criticalConflicts.length > 0 ? 'failed' : statusFromScore(score);
    if (!multiViewReport.isConsistent) {
      issues.push(...multiViewReport.criticalConflicts);
    }
    mvCriterion = {
      key: 'multiViewConsistency',
      label: 'Multi-View Consistency',
      score,
      status,
      detail: `Khớp màu sắc & đặc trưng ${Math.round(score * 100)}% qua ${multiViewReport.checkedPairs} cặp góc chụp.`,
      evidence: `${multiViewReport.checkedPairs} cặp ảnh đã đối chiếu histogram`,
    };
  } else if (recon.quality.multiViewConsistency !== null && Number.isFinite(recon.quality.multiViewConsistency)) {
    const score = Number(Math.max(0, Math.min(1, recon.quality.multiViewConsistency)).toFixed(3));
    mvCriterion = {
      key: 'multiViewConsistency',
      label: 'Multi-View Consistency',
      score,
      status: statusFromScore(score),
      detail: `Nhất quán đa góc đạt ${Math.round(score * 100)}%.`,
      evidence: 'Từ báo cáo đa góc Phase 3',
    };
  } else {
    mvCriterion = {
      key: 'multiViewConsistency',
      label: 'Multi-View Consistency',
      score: null,
      status: 'unverified',
      detail: 'Chỉ có 1 góc chụp — chưa có ảnh góc thứ 2 trở lên để đối chiếu đa góc.',
      evidence: 'Cần tối thiểu 2 góc ảnh',
    };
  }

  // 5. Texture Alignment (UV Coverage, Stretch Distortion & Bounds Integrity)
  let uvCriterion: ValidationCriterionResult;
  let aggregatedUv: UvAlignmentMetrics | null = uvMetrics;

  if (!aggregatedUv && root) {
    let covSum = 0;
    let distSum = 0;
    let degenSum = 0;
    let validMeshes = 0;
    let firstBounds: UvAlignmentMetrics['uvBounds'] = null;
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh || m.name === 'usableZoneHighlight' || !m.geometry) return;
      const stat = analyzeUvAndTextureAlignment(m.geometry as THREE.BufferGeometry);
      if (stat.hasValidUv) {
        covSum += stat.uvCoverageRatio;
        distSum += stat.stretchDistortionScore;
        degenSum += stat.degenerateUvTriangles;
        if (!firstBounds) firstBounds = stat.uvBounds;
        validMeshes++;
      }
    });
    if (validMeshes > 0) {
      aggregatedUv = {
        hasValidUv: true,
        uvCoverageRatio: Number((covSum / validMeshes).toFixed(3)),
        stretchDistortionScore: Number((distSum / validMeshes).toFixed(3)),
        uvBounds: firstBounds,
        degenerateUvTriangles: degenSum,
      };
    }
  }

  if (aggregatedUv && aggregatedUv.hasValidUv) {
    const degenPenalty = aggregatedUv.degenerateUvTriangles > 8 ? 0.15 : 0;
    const score = Number(
      Math.max(
        0,
        Math.min(
          1,
          aggregatedUv.uvCoverageRatio * 0.5 + aggregatedUv.stretchDistortionScore * 0.5 - degenPenalty
        )
      ).toFixed(3)
    );
    const status = statusFromScore(score);
    if (status === 'failed') {
      issues.push('Tọa độ UV bị kéo giãn hoặc vượt ngoài vùng [0..1].');
    }
    uvCriterion = {
      key: 'textureAlignment',
      label: 'Texture & UV Alignment',
      score,
      status,
      detail: `Phủ UV chuẩn [0..1]: ${Math.round(aggregatedUv.uvCoverageRatio * 100)}% • Chống méo: ${Math.round(
        aggregatedUv.stretchDistortionScore * 100
      )}%.`,
      evidence: hasPhotoTexture
        ? `Áp texture ảnh thật (${refinementReport?.textureModeUsed || 'uv'})`
        : 'Bản đồ PBR / UV chuẩn hóa [0..1]',
    };
  } else if (telemetry.meshCount > 0) {
    issues.push('Mesh thiếu tọa độ UV hợp lệ.');
    uvCriterion = {
      key: 'textureAlignment',
      label: 'Texture & UV Alignment',
      score: 0,
      status: 'failed',
      detail: 'Không tìm thấy thuộc tính UV hợp lệ trên lưới 3D.',
      evidence: 'Thiếu attribute uv',
    };
  } else {
    uvCriterion = {
      key: 'textureAlignment',
      label: 'Texture & UV Alignment',
      score: null,
      status: 'unverified',
      detail: 'Chưa có hình học 3D để kiểm tra UV.',
      evidence: 'Chưa dựng mesh',
    };
  }

  // 6. Mesh Quality (Watertight Normals, Degenerate Ratio, Grounded Footprint)
  let meshCriterion: ValidationCriterionResult;
  if (telemetry.meshCount > 0 && telemetry.vertexCount > 0) {
    const degenRatio = telemetry.degenerateTriangleCount / Math.max(1, telemetry.triangleCount);
    const groundedOk = Math.abs(telemetry.groundedMinY) <= 0.03;
    let score = 1.0;
    score -= Math.min(0.45, degenRatio * 5);
    score -= Math.min(0.35, telemetry.invertedNormalCount * 0.15);
    if (!groundedOk) score -= 0.12;
    if (!telemetry.valid) score -= 0.25;
    score = Number(Math.max(0, Math.min(1, score)).toFixed(3));

    const status = statusFromScore(score);
    if (!groundedOk) issues.push(`Đáy mô hình chưa chạm phẳng y=0 (min.y=${telemetry.groundedMinY}).`);
    if (telemetry.invertedNormalCount > 0) issues.push(`Có ${telemetry.invertedNormalCount} cụm pháp tuyến lỗi.`);

    meshCriterion = {
      key: 'meshQuality',
      label: 'Mesh & Normal Quality',
      score,
      status,
      detail: `${telemetry.vertexCount} đỉnh / ${telemetry.triangleCount} tam giác • Suy biến: ${telemetry.degenerateTriangleCount} • Pháp tuyến lỗi: ${telemetry.invertedNormalCount}.`,
      evidence: groundedOk ? 'Đáy tiếp đất chuẩn (min.y ≈ 0)' : `Cảnh báo min.y = ${telemetry.groundedMinY}`,
    };
  } else {
    meshCriterion = {
      key: 'meshQuality',
      label: 'Mesh & Normal Quality',
      score: null,
      status: 'unverified',
      detail: 'Chưa có dữ liệu Mesh để kiểm tra.',
      evidence: 'Không có mesh',
    };
  }

  const criteria: ValidationCriterionResult[] = [
    silhouetteCriterion,
    shapeCriterion,
    compCriterion,
    mvCriterion,
    uvCriterion,
    meshCriterion,
  ];

  const scored = criteria.filter((c) => c.score !== null) as Array<
    ValidationCriterionResult & { score: number }
  >;
  const overallScore =
    scored.length > 0
      ? Number((scored.reduce((s, c) => s + c.score, 0) / scored.length).toFixed(3))
      : null;

  const summary =
    overallScore !== null
      ? `Đạt ${Math.round(overallScore * 100)}% trên ${scored.length}/6 tiêu chí có dữ liệu đối chiếu thực.`
      : 'Chưa đủ dữ liệu hình học/đối chiếu để chấm điểm mô hình.';

  return {
    overallScore,
    availableMetricsCount: scored.length,
    totalMetricsCount: 6,
    criteria,
    issues: Array.from(new Set(issues)),
    summary,
  };
}
