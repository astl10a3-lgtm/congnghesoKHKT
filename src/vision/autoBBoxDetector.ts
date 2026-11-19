import { type NormalizedBoundingBox, validateNormalizedBBox } from '../types/reconstruction';

export interface AutoBBoxResult {
  bbox: NormalizedBoundingBox;
  confidence: number;
  method: 'saliency_edge_v1' | 'fallback_center';
}

const FALLBACK_BBOX: NormalizedBoundingBox = {
  xMin: 0.14,
  yMin: 0.08,
  xMax: 0.86,
  yMax: 0.92,
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể tải ảnh để tự động gợi ý khung vật thể.'));
    img.src = src;
  });
}

/**
 * Pure pixel-based saliency + edge density bounding box detector.
 * Samples border pixels as background reference, then locates the core connected
 * region with strong perceptual color difference or Sobel edge activity.
 */
export function computeSaliencyBBoxFromPixels(
  rgba: Uint8ClampedArray,
  w: number,
  h: number
): AutoBBoxResult {
  if (w < 16 || h < 16 || rgba.length < w * h * 4) {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.1, method: 'fallback_center' };
  }

  // 1. Estimate background color median/mean from outer 6% ring
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgCnt = 0;

  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const p = idx * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      lum[idx] = 0.299 * r + 0.587 * g + 0.114 * b;

      if (x < ring || x >= w - ring || y < ring || y >= h - ring) {
        bgR += r;
        bgG += g;
        bgB += b;
        bgCnt++;
      }
    }
  }

  if (bgCnt === 0) {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.1, method: 'fallback_center' };
  }
  bgR /= bgCnt;
  bgG /= bgCnt;
  bgB /= bgCnt;

  // 2. Compute background color variance on border ring to set adaptive threshold
  let bgVar = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < ring || x >= w - ring || y < ring || y >= h - ring) {
        const p = (y * w + x) * 4;
        const dr = rgba[p] - bgR;
        const dg = rgba[p + 1] - bgG;
        const db = rgba[p + 2] - bgB;
        bgVar += Math.sqrt(dr * dr + dg * dg + db * db);
      }
    }
  }
  const bgNoise = bgVar / bgCnt;
  const colorThreshold = Math.max(24, Math.min(72, bgNoise * 1.85 + 16));

  // 3. Score each interior pixel via border color distance + Sobel edge strength
  const colActivity = new Float32Array(w);
  const rowActivity = new Float32Array(h);
  let activeTotal = 0;

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x;
      const p = idx * 4;
      const dr = rgba[p] - bgR;
      const dg = rgba[p + 1] - bgG;
      const db = rgba[p + 2] - bgB;
      const colorDist = Math.sqrt(dr * dr + dg * dg + db * db);

      const gx =
        -lum[idx - w - 1] +
        lum[idx - w + 1] -
        2 * lum[idx - 1] +
        2 * lum[idx + 1] -
        lum[idx + w - 1] +
        lum[idx + w + 1];
      const gy =
        -lum[idx - w - 1] -
        2 * lum[idx - w] -
        lum[idx - w + 1] +
        lum[idx + w - 1] +
        2 * lum[idx + w] +
        lum[idx + w + 1];
      const edgeMag = Math.sqrt(gx * gx + gy * gy);

      if (colorDist > colorThreshold || edgeMag > 65) {
        const weight = colorDist > colorThreshold ? 1.0 : 0.6;
        colActivity[x] += weight;
        rowActivity[y] += weight;
        activeTotal += weight;
      }
    }
  }

  const totalArea = Math.max(1, (w - 4) * (h - 4));
  const fillFraction = activeTotal / totalArea;
  if (fillFraction < 0.018 || fillFraction > 0.94) {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.2, method: 'fallback_center' };
  }

  // 4. Trim isolated single-pixel outliers using 2% / 98% activity quantiles on X and Y projections
  const findBounds = (proj: Float32Array, len: number): [number, number] | null => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += proj[i];
    if (sum <= 1) return null;
    const lowTarget = sum * 0.015;
    const highTarget = sum * 0.985;
    let acc = 0;
    let minIdx = 0;
    let maxIdx = len - 1;
    for (let i = 0; i < len; i++) {
      acc += proj[i];
      if (acc >= lowTarget) {
        minIdx = i;
        break;
      }
    }
    acc = 0;
    for (let i = len - 1; i >= 0; i--) {
      acc += proj[i];
      if (acc >= sum - highTarget) {
        maxIdx = i;
        break;
      }
    }
    if (maxIdx <= minIdx) return null;
    return [minIdx, maxIdx];
  };

  const xBounds = findBounds(colActivity, w);
  const yBounds = findBounds(rowActivity, h);
  if (!xBounds || !yBounds) {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.2, method: 'fallback_center' };
  }

  // Add 3% padding so edges of caps/corners are cleanly enclosed
  const pad = 0.03;
  const candidate = validateNormalizedBBox({
    xMin: Number(Math.max(0.02, xBounds[0] / w - pad).toFixed(4)),
    yMin: Number(Math.max(0.02, yBounds[1] / h - pad).toFixed(4)),
    xMax: Number(Math.min(0.98, xBounds[1] / w + pad).toFixed(4)),
    yMax: Number(Math.min(0.98, yBounds[1] / h + pad).toFixed(4)),
  });

  if (!candidate) {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.2, method: 'fallback_center' };
  }

  const areaRatio = (candidate.xMax - candidate.xMin) * (candidate.yMax - candidate.yMin);
  if (areaRatio < 0.03 || areaRatio > 0.96) {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.25, method: 'fallback_center' };
  }

  const confidence = Number(Math.min(0.92, Math.max(0.45, 0.5 + (bgNoise < 28 ? 0.3 : 0.1))).toFixed(2));
  return {
    bbox: candidate,
    confidence,
    method: 'saliency_edge_v1',
  };
}

/**
 * Estimates an initial tight normalized bounding box [0..1] for an uploaded/captured image.
 */
export async function suggestInitialBoundingBox(imageUrl: string): Promise<AutoBBoxResult> {
  try {
    const img = await loadImage(imageUrl);
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;
    const scale = Math.min(1, 160 / Math.max(origW, origH, 1));
    const w = Math.max(24, Math.round(origW * scale));
    const h = Math.max(24, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { bbox: { ...FALLBACK_BBOX }, confidence: 0.15, method: 'fallback_center' };

    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    return computeSaliencyBBoxFromPixels(data, w, h);
  } catch {
    return { bbox: { ...FALLBACK_BBOX }, confidence: 0.15, method: 'fallback_center' };
  }
}
