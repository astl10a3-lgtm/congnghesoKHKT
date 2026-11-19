import type { CapturedViewEntry, ViewAngleId } from '../types/reconstruction';

export interface MultiViewConsistencyReport {
  isConsistent: boolean;
  consistencyScore: number; // 0..1
  checkedPairs: number;
  warnings: string[];
  criticalConflicts: string[];
  recommendedNextAngles: {
    angle: ViewAngleId;
    label: string;
    reason: string;
  }[];
}

export const VIEW_ANGLE_META: Record<
  ViewAngleId,
  { label: string; shortDesc: string; captureTip: string }
> = {
  front: {
    label: 'Chính diện (Front)',
    shortDesc: 'Mặt trước thẳng vuông góc',
    captureTip: 'Đặt vật đứng tự nhiên, căn toàn bộ thân từ đáy đến đỉnh.',
  },
  side: {
    label: 'Mặt bên (Side)',
    shortDesc: 'Xoay 90° sang cạnh bên',
    captureTip: 'Giúp đo độ dày / chiều sâu thực tế (Depth) và độ dẹt của vật.',
  },
  three_quarter: {
    label: 'Góc nghiêng 45° (3/4)',
    shortDesc: 'Nhìn chếch 45° tổng thể',
    captureTip: 'Giúp AI hiểu cấu trúc khối 3D, vai chai, nếp gấp hoặc vết móp.',
  },
  back: {
    label: 'Mặt sau (Back)',
    shortDesc: 'Xoay 180° kiểm tra lưng',
    captureTip: 'Phát hiện vết rách, nhãn sau hoặc bề mặt mặt lưng khác màu.',
  },
  top: {
    label: 'Từ trên xuống (Top)',
    shortDesc: 'Nhìn thẳng đỉnh vật thể',
    captureTip: 'Quan sát miệng chai, nắp vặn, tiết diện vuông/tròn hoặc độ rỗng.',
  },
  bottom: {
    label: 'Đáy vật thể (Bottom)',
    shortDesc: 'Lật xem cấu tạo đáy & mã nhựa',
    captureTip: 'Kiểm tra đáy 5 múi chịu lực và ký hiệu tái chế (PET 1, HDPE 2...).',
  },
};

export function getGuidanceForCategory(hint: string): {
  angle: ViewAngleId;
  label: string;
  reason: string;
}[] {
  const lower = hint.toLowerCase();
  if (lower.includes('carton') || lower.includes('hộp') || lower.includes('paper')) {
    return [
      { angle: 'front', label: VIEW_ANGLE_META.front.label, reason: 'Đo chiều rộng & chiều cao mặt chính' },
      { angle: 'side', label: VIEW_ANGLE_META.side.label, reason: 'Đo chiều sâu (Depth) và độ dày vách carton' },
      { angle: 'top', label: VIEW_ANGLE_META.top.label, reason: 'Kiểm tra nắp gập và nếp gấp phía trên' },
    ];
  }
  if (lower.includes('vải') || lower.includes('jean') || lower.includes('fabric')) {
    return [
      { angle: 'front', label: VIEW_ANGLE_META.front.label, reason: 'Lấy hoa văn và kích thước bề mặt chính' },
      { angle: 'back', label: VIEW_ANGLE_META.back.label, reason: 'Kiểm tra mặt sau có túi/khuy/vết sờn khác không' },
      { angle: 'three_quarter', label: VIEW_ANGLE_META.three_quarter.label, reason: 'Quan sát độ rủ, nếp gấp và độ dày vải' },
    ];
  }
  return [
    { angle: 'front', label: VIEW_ANGLE_META.front.label, reason: 'Trích xuất biên dạng thân, vai và cổ vật thể' },
    { angle: 'three_quarter', label: VIEW_ANGLE_META.three_quarter.label, reason: 'Nhận diện độ cong, vết móp và chiều sâu' },
    { angle: 'top', label: VIEW_ANGLE_META.top.label, reason: 'Xác định tiết diện tròn/vuông và cấu tạo nắp/miệng' },
  ];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load error'));
    img.src = src;
  });
}

async function computeColorHistogram(view: CapturedViewEntry): Promise<Float32Array | null> {
  try {
    const src = view.croppedObjectUrl || view.originalImage;
    const img = await loadImage(src);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    if (view.croppedObjectUrl) {
      ctx.drawImage(img, 0, 0, size, size);
    } else if (view.boundingBox) {
      const sx = view.boundingBox.xMin * img.naturalWidth;
      const sy = view.boundingBox.yMin * img.naturalHeight;
      const sw = (view.boundingBox.xMax - view.boundingBox.xMin) * img.naturalWidth;
      const sh = (view.boundingBox.yMax - view.boundingBox.yMin) * img.naturalHeight;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    } else {
      ctx.drawImage(img, 0, 0, size, size);
    }

    const px = ctx.getImageData(0, 0, size, size).data;
    // 4x4x4 = 64 quantized RGB bins ignoring transparent background pixels
    const hist = new Float32Array(64);
    let total = 0;
    for (let i = 0; i < size * size; i++) {
      const p = i * 4;
      if (px[p + 3] < 80) continue;
      const rBin = px[p] >> 6;
      const gBin = px[p + 1] >> 6;
      const bBin = px[p + 2] >> 6;
      hist[rBin * 16 + gBin * 4 + bBin] += 1;
      total++;
    }
    if (total < 15) return null;
    for (let i = 0; i < 64; i++) hist[i] /= total;
    return hist;
  } catch {
    return null;
  }
}

function bhattacharyyaSimilarity(h1: Float32Array, h2: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < h1.length; i++) {
    sum += Math.sqrt(h1[i] * h2[i]);
  }
  return Math.max(0, Math.min(1, sum));
}

/**
 * Checks whether multiple captured views belong to the same object,
 * have no REJECTED blur/quality shots, and suggests missing angles.
 */
export async function checkMultiViewConsistency(
  views: CapturedViewEntry[],
  materialHint: string = ''
): Promise<MultiViewConsistencyReport> {
  const warnings: string[] = [];
  const criticalConflicts: string[] = [];

  const capturedAngles = new Set(views.map((v) => v.angle));
  const guided = getGuidanceForCategory(materialHint);
  const recommendedNextAngles = guided.filter((g) => !capturedAngles.has(g.angle));

  if (views.length === 0) {
    return {
      isConsistent: false,
      consistencyScore: 0,
      checkedPairs: 0,
      warnings: ['Chưa có ảnh nào được chụp.'],
      criticalConflicts: [],
      recommendedNextAngles,
    };
  }

  for (const v of views) {
    if (v.quality?.status === 'REJECTED') {
      criticalConflicts.push(
        `Góc "${VIEW_ANGLE_META[v.angle]?.label || v.angle}" không đạt chất lượng: ${v.quality.reasons[0] || 'Ảnh bị mờ/tối'}.`
      );
    } else if (v.quality?.status === 'WARNING') {
      warnings.push(
        `Góc "${VIEW_ANGLE_META[v.angle]?.label || v.angle}" có cảnh báo: ${v.quality.reasons[0] || ''}.`
      );
    }
  }

  if (views.length === 1) {
    warnings.push(
      'Mới có 1 góc ảnh — có thể phân tích cơ bản nhưng thiếu thông tin chiều sâu (Depth) và mặt sau.'
    );
    return {
      isConsistent: criticalConflicts.length === 0,
      consistencyScore: criticalConflicts.length === 0 ? 0.65 : 0.3,
      checkedPairs: 0,
      warnings,
      criticalConflicts,
      recommendedNextAngles,
    };
  }

  // Compare color histograms across views
  const hists = await Promise.all(views.map(computeColorHistogram));
  let simSum = 0;
  let pairs = 0;

  for (let i = 0; i < views.length; i++) {
    for (let j = i + 1; j < views.length; j++) {
      const hA = hists[i];
      const hB = hists[j];
      if (!hA || !hB) continue;
      const sim = bhattacharyyaSimilarity(hA, hB);
      simSum += sim;
      pairs++;

      if (sim < 0.36) {
        criticalConflicts.push(
          `Màu sắc/đặc trưng giữa góc "${VIEW_ANGLE_META[views[i].angle].label}" và "${VIEW_ANGLE_META[views[j].angle].label}" khác biệt rất lớn (${Math.round(sim * 100)}%) — có thể không phải cùng 1 vật thể.`
        );
      } else if (sim < 0.55) {
        warnings.push(
          `Góc "${VIEW_ANGLE_META[views[i].angle].label}" và "${VIEW_ANGLE_META[views[j].angle].label}" có sự khác biệt ánh sáng hoặc mặt nhãn (${Math.round(sim * 100)}%).`
        );
      }
    }
  }

  const avgSim = pairs > 0 ? simSum / pairs : 0.75;
  const score = Number(Math.max(0, Math.min(1, avgSim - criticalConflicts.length * 0.25)).toFixed(2));

  return {
    isConsistent: criticalConflicts.length === 0,
    consistencyScore: score,
    checkedPairs: pairs,
    warnings,
    criticalConflicts,
    recommendedNextAngles,
  };
}
