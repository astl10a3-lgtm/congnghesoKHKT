import type { NormalizedBoundingBox } from '../types/reconstruction';

export type QualityStatus = 'GOOD' | 'WARNING' | 'REJECTED';

export interface QualityThresholdsConfig {
  /** Minimum full image width or height (px) */
  minImagePx: number;
  /** Minimum cropped ROI width or height (px) for edge/shape analysis */
  minRoiPx: number;
  /** Laplacian variance below this on 320px normalized grid triggers REJECTED (severe motion/focus blur) */
  minLaplacianVarReject: number;
  /** Laplacian variance below this triggers sharpness WARNING */
  minLaplacianVarWarn: number;
  /** Mean ROI luma (0..255) below this triggers dark REJECTED */
  minBrightnessReject: number;
  /** Mean ROI luma (0..255) below this triggers low-light WARNING */
  minBrightnessWarn: number;
  /** Mean ROI luma above this triggers overexposure WARNING */
  maxBrightnessWarn: number;
  /** Fraction of clipped highlight pixels (>246) triggering glare WARNING */
  maxGlareRatioWarn: number;
  /** Normalized RMS luminance std-dev below this triggers flat contrast WARNING */
  minContrastWarn: number;
  /** Foreground border-clipping score (0..1, 1=clean) below this warns of frame clipping */
  minEdgeClippingWarn: number;
  /** Minimum BBox area fraction of frame; below this rejects because object is too tiny/distant */
  minBBoxAreaRatioReject: number;
  /** BBox area fraction below this warns object is small in frame */
  minBBoxAreaRatioWarn: number;
  /** BBox area fraction above this warns of missing background margin for GrabCut */
  maxBBoxAreaRatioWarn: number;
  /** BBox area fraction above this rejects because selection covers entire image with zero background margin */
  maxBBoxAreaRatioReject: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholdsConfig = {
  minImagePx: 240,
  minRoiPx: 100,
  minLaplacianVarReject: 22,
  minLaplacianVarWarn: 60,
  minBrightnessReject: 38,
  minBrightnessWarn: 65,
  maxBrightnessWarn: 232,
  maxGlareRatioWarn: 0.35,
  minContrastWarn: 0.18,
  minEdgeClippingWarn: 0.62,
  minBBoxAreaRatioReject: 0.03,
  minBBoxAreaRatioWarn: 0.08,
  maxBBoxAreaRatioWarn: 0.94,
  maxBBoxAreaRatioReject: 0.985,
};

export interface ImageQualityMetrics {
  blurScore: number; // Laplacian variance normalized 0..1 (higher = sharper)
  rawLaplacianVar: number;
  brightness: number; // 0..255
  contrast: number; // 0..1 normalized std-dev
  glareRatio: number; // 0..1 fraction of clipped highlights
  resolutionPx: { width: number; height: number };
  roiResolutionPx: { width: number; height: number };
  bboxAreaRatio: number; // (xMax - xMin) * (yMax - yMin) in [0..1]
  bboxEdgeTouchCount: number; // how many of 4 bbox sides flush with image border (<=0.015 or >=0.985)
  backgroundComplexity: number; // 0..1 (higher = cluttered background)
  foregroundSeparation: number; // 0..1 color separation between ROI and outside
  edgeClippingScore: number; // 0..1 (1 = cleanly inside frame, 0 = heavily clipped)
  segmentationFillRatio: number | null;
  occlusionRisk: number; // 0..1
}

export interface ImageQualityReport {
  status: QualityStatus;
  overallScore: number; // 0..1
  metrics: ImageQualityMetrics;
  reasons: string[];
  recommendations: string[];
  thresholdsUsed: QualityThresholdsConfig;
}

export function evaluateQualityMetrics(
  metrics: ImageQualityMetrics,
  customThresholds?: Partial<QualityThresholdsConfig>
): ImageQualityReport {
  const t: QualityThresholdsConfig = {
    ...DEFAULT_QUALITY_THRESHOLDS,
    ...(customThresholds || {}),
  };

  const reasons: string[] = [];
  const recommendations: string[] = [];
  let status: QualityStatus = 'GOOD';

  const markWarning = (msg: string, tip: string) => {
    reasons.push(msg);
    recommendations.push(tip);
    if (status === 'GOOD') status = 'WARNING';
  };

  const markRejected = (msg: string, tip: string) => {
    reasons.push(msg);
    recommendations.push(tip);
    status = 'REJECTED';
  };

  const {
    rawLaplacianVar,
    blurScore,
    brightness,
    contrast,
    glareRatio,
    resolutionPx,
    roiResolutionPx,
    bboxAreaRatio,
    bboxEdgeTouchCount,
    backgroundComplexity,
    foregroundSeparation,
    edgeClippingScore,
    segmentationFillRatio,
  } = metrics;

  // 1. Image & ROI Resolution
  if (resolutionPx.width < t.minImagePx || resolutionPx.height < t.minImagePx) {
    markRejected(
      `Độ phân giải ảnh gốc quá nhỏ (${resolutionPx.width}×${resolutionPx.height} px, tối thiểu ${t.minImagePx} px).`,
      'Chụp lại bằng camera chính hoặc chọn ảnh gốc độ phân giải cao hơn.'
    );
  } else if (roiResolutionPx.width < t.minRoiPx || roiResolutionPx.height < t.minRoiPx) {
    markRejected(
      `Độ phân giải vùng vật thể trong khung quá thấp (${roiResolutionPx.width}×${roiResolutionPx.height} px, tối thiểu ${t.minRoiPx} px).`,
      'Đưa camera lại gần vật thể hơn hoặc nới rộng khung khoanh cho vừa đối tượng.'
    );
  }

  // 2. Bounding Box Area Ratio (too small or too large)
  const pct = Math.round(bboxAreaRatio * 100);
  if (bboxAreaRatio < t.minBBoxAreaRatioReject) {
    markRejected(
      `Vùng chọn quá nhỏ (${pct}% diện tích ảnh, ngưỡng tối thiểu ${Math.round(t.minBBoxAreaRatioReject * 100)}%).`,
      'Kéo rộng khung khoanh cho khớp vật thể hoặc đưa camera lại gần vật thể hơn.'
    );
  } else if (bboxAreaRatio < t.minBBoxAreaRatioWarn) {
    markWarning(
      `Vật thể chiếm diện tích hơi nhỏ trong khung hình (${pct}%).`,
      'Đưa vật lại gần hơn để nhìn rõ chi tiết gân, nhãn và kích thước.'
    );
  } else if (bboxAreaRatio > t.maxBBoxAreaRatioReject) {
    markRejected(
      `Vùng chọn đang bao trùm gần như toàn bộ ảnh (${pct}% diện tích), thiếu khoảng nền biên để tách vật thể.`,
      'Chụp lùi xa một chút để vật thể nằm trọn bên trong khung với khoảng trống xung quanh.'
    );
  } else if (bboxAreaRatio > t.maxBBoxAreaRatioWarn) {
    markWarning(
      `Vùng chọn rất lớn (${pct}% ảnh), khoảng nền tham chiếu xung quanh hơi ít.`,
      'Thu gọn khung khoanh sát vật thể hơn nếu có nền trống xung quanh.'
    );
  }

  // 3. Blur (Laplacian Variance)
  if (rawLaplacianVar < t.minLaplacianVarReject) {
    markRejected(
      `Ảnh đang bị mờ nhòe do rung tay hoặc mất nét (Laplacian=${Math.round(rawLaplacianVar)} < ${t.minLaplacianVarReject}).`,
      'Giữ điện thoại cố định 1-2 giây cho camera lấy nét rồi chụp lại.'
    );
  } else if (rawLaplacianVar < t.minLaplacianVarWarn) {
    markWarning(
      `Độ nét ảnh ở mức trung bình (Laplacian=${Math.round(rawLaplacianVar)}), chi tiết nhỏ có thể bị mờ.`,
      'Chạm vào màn hình để khóa nét vào bề mặt vật thể nếu muốn mô hình rõ nét hơn.'
    );
  }

  // 4. Brightness & Glare
  if (brightness < t.minBrightnessReject) {
    markRejected(
      `Ảnh quá tối (độ sáng=${Math.round(brightness)}/255 < ${t.minBrightnessReject}), không nhìn rõ biên dạng vật thể.`,
      'Bật thêm đèn hoặc đưa vật liệu ra nơi có ánh sáng tự nhiên đều hơn.'
    );
  } else if (brightness < t.minBrightnessWarn) {
    markWarning(
      `Ánh sáng hơi yếu (độ sáng=${Math.round(brightness)}/255), vùng tối dễ lẫn vào nền.`,
      'Tăng ánh sáng môi trường để thuật toán tách nền chính xác hơn.'
    );
  } else if (brightness > t.maxBrightnessWarn || glareRatio > t.maxGlareRatioWarn) {
    markWarning(
      `Ảnh bị lóa sáng mạnh (sáng=${Math.round(brightness)}, vùng cháy=${Math.round(glareRatio * 100)}%).`,
      'Tránh chiếu đèn trực diện vào nhựa trong/kim loại, nên chụp dưới ánh sáng tán xạ dịu.'
    );
  }

  // 5. Contrast
  if (contrast < t.minContrastWarn) {
    markWarning(
      `Độ tương phản thấp (${Math.round(contrast * 100)}% < ${Math.round(t.minContrastWarn * 100)}%), vật thể khó tách khỏi nền.`,
      'Đặt vật thể lên nền đơn sắc tương phản (chai trong trên nền sẫm, vật sẫm trên nền sáng).'
    );
  }

  // 6. Frame Completeness / Edge Clipping
  if (edgeClippingScore < t.minEdgeClippingWarn || bboxEdgeTouchCount >= 2) {
    markWarning(
      'Vật thể hoặc khung chọn đang chạm sát mép ảnh, có nguy cơ bị cắt mất một phần đối tượng.',
      'Lùi camera ra một chút để toàn bộ vật thể nằm trọn hoàn toàn bên trong khung hình.'
    );
  }

  // 7. Segmentation Mask & Background Clutter
  if (segmentationFillRatio !== null && segmentationFillRatio < 0.12) {
    markRejected(
      'Vùng tách nền quá nhỏ hoặc đối tượng bị che khuất trong khung khoanh.',
      'Khoanh lại khung chọn vừa khít vật thể hoặc dùng cọ chỉnh sửa vùng chọn.'
    );
  } else if (backgroundComplexity > 0.72 && foregroundSeparation < 0.25) {
    markWarning(
      'Nền phía sau nhiều chi tiết gây nhiễu biên dạng vật thể.',
      'Đặt vật thể ở nơi trống trải, trên mặt bàn trơn hoặc tờ giấy/vải đơn sắc.'
    );
  }

  const brightScore =
    brightness >= 75 && brightness <= 210
      ? 1
      : brightness < 75
      ? Math.max(0, brightness / 75)
      : Math.max(0, 1 - (brightness - 210) / 45);

  const overallScore = Number(
    Math.max(
      0,
      Math.min(
        1,
        0.32 * blurScore +
          0.2 * brightScore +
          0.16 * contrast +
          0.16 * foregroundSeparation +
          0.16 * edgeClippingScore
      )
    ).toFixed(3)
  );

  if (reasons.length === 0) {
    reasons.push('Ảnh rõ nét, đủ sáng, vật thể nằm gọn trong khung và tách biệt tốt với nền.');
  }

  return {
    status,
    overallScore,
    metrics,
    reasons,
    recommendations,
    thresholdsUsed: t,
  };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể tải ảnh để đánh giá chất lượng.'));
    img.src = src;
  });
}

/**
 * Computes Image Quality Assessment directly from pixels using:
 * - Resolution, ROI dimensions & normalized BBox area coverage
 * - Brightness & highlight glare ratio
 * - RMS contrast
 * - Resolution-adaptive Laplacian variance for blur detection
 * - Foreground vs Background separability & background edge clutter
 * - Segmentation mask integrity & border clipping check
 */
export async function assessImageQuality(params: {
  imageUrl: string;
  boundingBox?: NormalizedBoundingBox | null;
  maskDataUrl?: string | null;
  thresholds?: Partial<QualityThresholdsConfig>;
}): Promise<ImageQualityReport> {
  const img = await loadImageElement(params.imageUrl);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // Work on a standardized analysis grid (~320px max dim) so Laplacian thresholds are resolution-independent
  const maxGrid = 320;
  const scale = Math.min(1, maxGrid / Math.max(origW, origH));
  const w = Math.max(32, Math.round(origW * scale));
  const h = Math.max(32, Math.round(origH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Trình duyệt không hỗ trợ Canvas 2D context.');
  }
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h).data;

  // Optional segmentation mask overlay
  let maskAlpha: Uint8ClampedArray | null = null;
  if (params.maskDataUrl) {
    try {
      const maskImg = await loadImageElement(params.maskDataUrl);
      const mCanvas = document.createElement('canvas');
      mCanvas.width = w;
      mCanvas.height = h;
      const mCtx = mCanvas.getContext('2d', { willReadFrequently: true });
      if (mCtx) {
        mCtx.drawImage(maskImg, 0, 0, w, h);
        maskAlpha = mCtx.getImageData(0, 0, w, h).data;
      }
    } catch {
      maskAlpha = null;
    }
  }

  const bbox: NormalizedBoundingBox = params.boundingBox || {
    xMin: 0.08,
    yMin: 0.08,
    xMax: 0.92,
    yMax: 0.92,
  };

  const rx0 = Math.max(0, Math.floor(bbox.xMin * w));
  const ry0 = Math.max(0, Math.floor(bbox.yMin * h));
  const rx1 = Math.min(w - 1, Math.ceil(bbox.xMax * w));
  const ry1 = Math.min(h - 1, Math.ceil(bbox.yMax * h));

  const roiOrigW = Math.round((bbox.xMax - bbox.xMin) * origW);
  const roiOrigH = Math.round((bbox.yMax - bbox.yMin) * origH);
  const bboxAreaRatio = Number(
    Math.max(0, Math.min(1, (bbox.xMax - bbox.xMin) * (bbox.yMax - bbox.yMin))).toFixed(4)
  );
  const bboxEdgeTouchCount =
    (bbox.xMin <= 0.015 ? 1 : 0) +
    (bbox.xMax >= 0.985 ? 1 : 0) +
    (bbox.yMin <= 0.015 ? 1 : 0) +
    (bbox.yMax >= 0.985 ? 1 : 0);

  // Convert to grayscale luminance & accumulate ROI vs Background statistics
  const luma = new Float32Array(w * h);
  let roiCount = 0;
  let bgCount = 0;
  let roiSumR = 0,
    roiSumG = 0,
    roiSumB = 0;
  let bgSumR = 0,
    bgSumG = 0,
    bgSumB = 0;
  let lumaSum = 0;
  let lumaSqSum = 0;
  let glareCount = 0;
  let maskFgCount = 0;
  let borderFgHits = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const p = idx * 4;
      const r = imageData[p];
      const g = imageData[p + 1];
      const b = imageData[p + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[idx] = lum;

      const inBox = x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
      const isFg = maskAlpha ? maskAlpha[p + 3] > 128 : inBox;

      if (inBox) {
        roiCount++;
        lumaSum += lum;
        lumaSqSum += lum * lum;
        if (lum > 246) glareCount++;
      }

      if (isFg) {
        roiSumR += r;
        roiSumG += g;
        roiSumB += b;
        maskFgCount++;

        const nearImgBorder = x <= 2 || x >= w - 3 || y <= 2 || y >= h - 3;
        if (nearImgBorder) borderFgHits++;
      } else {
        bgSumR += r;
        bgSumG += g;
        bgSumB += b;
        bgCount++;
      }
    }
  }

  const safeRoi = Math.max(1, roiCount);
  const brightness = lumaSum / safeRoi;
  const variance = Math.max(0, lumaSqSum / safeRoi - brightness * brightness);
  const contrast = Math.min(1, Math.sqrt(variance) / 72);
  const glareRatio = glareCount / safeRoi;

  // Laplacian Variance inside ROI + Background edge complexity outside ROI
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  let bgEdgeSum = 0;
  let bgLapCount = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        luma[idx - w] +
        luma[idx + w] +
        luma[idx - 1] +
        luma[idx + 1] -
        4 * luma[idx];

      if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) {
        lapSum += lap;
        lapSqSum += lap * lap;
        lapCount++;
      } else {
        bgEdgeSum += Math.abs(lap);
        bgLapCount++;
      }
    }
  }

  const safeLap = Math.max(1, lapCount);
  const lapMean = lapSum / safeLap;
  const rawLaplacianVar = Math.max(0, lapSqSum / safeLap - lapMean * lapMean);

  const blurScore = Math.min(1, Math.max(0, (rawLaplacianVar - 18) / 220));
  const bgComplexity = bgLapCount > 0 ? Math.min(1, bgEdgeSum / bgLapCount / 22) : 0.2;

  let fgSep = 0.6;
  if (bgCount > 20 && maskFgCount > 20) {
    const dR = roiSumR / maskFgCount - bgSumR / bgCount;
    const dG = roiSumG / maskFgCount - bgSumG / bgCount;
    const dB = roiSumB / maskFgCount - bgSumB / bgCount;
    const dist = Math.sqrt(dR * dR + dG * dG + dB * dB);
    fgSep = Math.min(1, dist / 140);
  }

  const segmentationFillRatio = maskAlpha ? Number((maskFgCount / safeRoi).toFixed(3)) : null;
  const borderClipRatio = borderFgHits / Math.max(1, maskFgCount * 0.15);
  const edgeClippingScore = Math.max(0, Math.min(1, 1 - borderClipRatio));

  let occlusionRisk = 0.1;
  if (segmentationFillRatio !== null) {
    if (segmentationFillRatio < 0.14 || segmentationFillRatio > 0.97) occlusionRisk += 0.45;
  }
  if (edgeClippingScore < 0.7) occlusionRisk += 0.25;
  if (fgSep < 0.18) occlusionRisk += 0.2;
  occlusionRisk = Math.min(1, occlusionRisk);

  const metrics: ImageQualityMetrics = {
    blurScore: Number(blurScore.toFixed(3)),
    rawLaplacianVar: Math.round(rawLaplacianVar),
    brightness: Math.round(brightness),
    contrast: Number(contrast.toFixed(3)),
    glareRatio: Number(glareRatio.toFixed(3)),
    resolutionPx: { width: origW, height: origH },
    roiResolutionPx: { width: roiOrigW, height: roiOrigH },
    bboxAreaRatio,
    bboxEdgeTouchCount,
    backgroundComplexity: Number(bgComplexity.toFixed(3)),
    foregroundSeparation: Number(fgSep.toFixed(3)),
    edgeClippingScore: Number(edgeClippingScore.toFixed(3)),
    segmentationFillRatio,
    occlusionRisk: Number(occlusionRisk.toFixed(3)),
  };

  return evaluateQualityMetrics(metrics, params.thresholds);
}

/**
 * Lightweight real-time check directly on a live <video> element for viewfinder HUD.
 */
export function sampleLiveVideoQuality(video: HTMLVideoElement): {
  brightness: number;
  sharpnessScore: number;
  statusLabel: string;
  isTooDark: boolean;
  isTooBlurry: boolean;
  isGlaring: boolean;
} {
  const vw = video.videoWidth || 320;
  const vh = video.videoHeight || 240;
  const w = 160;
  const h = Math.max(90, Math.round((vh / vw) * w));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      brightness: 128,
      sharpnessScore: 0.7,
      statusLabel: 'Sẵn sàng chụp',
      isTooDark: false,
      isTooBlurry: false,
      isGlaring: false,
    };
  }
  ctx.drawImage(video, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const luma = new Float32Array(w * h);
  let sum = 0;
  let glare = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    luma[i] = lum;
    sum += lum;
    if (lum > 246) glare++;
  }
  const brightness = sum / (w * h);
  const glareRatio = glare / (w * h);

  let lapSum = 0;
  let lapSq = 0;
  let cnt = 0;
  const x0 = Math.floor(w * 0.2);
  const x1 = Math.floor(w * 0.8);
  const y0 = Math.floor(h * 0.15);
  const y1 = Math.floor(h * 0.85);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * w + x;
      const lap = luma[idx - w] + luma[idx + w] + luma[idx - 1] + luma[idx + 1] - 4 * luma[idx];
      lapSum += lap;
      lapSq += lap * lap;
      cnt++;
    }
  }
  const meanLap = lapSum / Math.max(1, cnt);
  const lapVar = Math.max(0, lapSq / Math.max(1, cnt) - meanLap * meanLap);
  const sharpnessScore = Math.min(1, lapVar / 180);

  const isTooDark = brightness < 45;
  const isGlaring = glareRatio > 0.35 || brightness > 235;
  const isTooBlurry = lapVar < 22;

  let statusLabel = 'Ánh sáng & độ nét tốt';
  if (isTooDark) statusLabel = 'Thiếu sáng — hãy thêm đèn';
  else if (isTooBlurry) statusLabel = 'Giữ chắc tay để lấy nét';
  else if (isGlaring) statusLabel = 'Bị lóa — đổi góc tránh đèn chiếu thẳng';

  return {
    brightness: Math.round(brightness),
    sharpnessScore: Number(sharpnessScore.toFixed(2)),
    statusLabel,
    isTooDark,
    isTooBlurry,
    isGlaring,
  };
}
