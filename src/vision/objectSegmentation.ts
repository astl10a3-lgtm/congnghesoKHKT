import type {
  CapturedViewEntry,
  ContourPoint,
  NormalizedBoundingBox,
  ProfilePoint,
} from '../types/reconstruction';

export interface SegmentationOutput {
  maskDataUrl: string;
  bboxCroppedUrl: string; // rectangular crop strictly by bbox without mask applied
  croppedObjectUrl: string; // transparent cutout cropped by bbox
  processedImageUrl: string; // centered cutout on clean #f8fafc studio canvas
  boundingBox: NormalizedBoundingBox;
  foregroundRatio: number;
  silhouetteProfile: ProfilePoint[];
  contourPoints: ContourPoint[];
  imageWidth: number;
  imageHeight: number;
  engineUsed: 'client_grabcut_v1' | 'remote_sam_api';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể tải ảnh để phân đoạn.'));
    img.src = src;
  });
}

/**
 * Compresses & optimizes uploaded or captured image before storage / network transfer.
 */
export async function optimizeImageForUpload(
  src: string,
  maxDimension: number = 1440,
  quality: number = 0.88
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;
  const ratio = Math.min(1, maxDimension / Math.max(origW, origH));
  const targetW = Math.max(64, Math.round(origW * ratio));
  const targetH = Math.max(64, Math.round(origH * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo Canvas tối ưu ảnh.');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    width: targetW,
    height: targetH,
  };
}

/**
 * Computes color distance in perceptual weighted RGB space (approx Lab-like perceptual sensitivity).
 */
function colorDistSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const rMean = (r1 + r2) * 0.5;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}

/**
 * Produces a rectangular crop directly matching the normalized bounding box [0..1]
 * WITHOUT applying any foreground mask (preserves natural object edges & immediate margin).
 */
export async function cropImageByBoundingBox(
  imageUrl: string,
  bbox: NormalizedBoundingBox,
  maxDimension: number = 1024
): Promise<{ bboxCroppedUrl: string; width: number; height: number }> {
  const img = await loadImage(imageUrl);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  const sx = Math.max(0, Math.floor(bbox.xMin * origW));
  const sy = Math.max(0, Math.floor(bbox.yMin * origH));
  const sw = Math.max(16, Math.min(origW - sx, Math.ceil((bbox.xMax - bbox.xMin) * origW)));
  const sh = Math.max(16, Math.min(origH - sy, Math.ceil((bbox.yMax - bbox.yMin) * origH)));

  const scale = Math.min(1, maxDimension / Math.max(sw, sh));
  const cw = Math.max(32, Math.round(sw * scale));
  const ch = Math.max(32, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không thể khởi tạo Canvas để crop ảnh theo vùng chọn.');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);

  return {
    bboxCroppedUrl: canvas.toDataURL('image/jpeg', 0.92),
    width: cw,
    height: ch,
  };
}

/**
 * Client-side iterative Foreground/Background Segmentation (GrabCut-inspired) + optional remote SAM proxy:
 * 1. Always creates clean rectangular BBox crop (bboxCroppedUrl) separately from mask & original.
 * 2. If useRemoteSam is enabled, queries /api/segment-object and uses returned mask when available.
 * 3. Otherwise builds Background appearance palette from outside BBox & Foreground core palette,
 *    combining color log-likelihood + Sobel edge barrier + spatial center prior across 3 iterations.
 * 4. Extracts dominant connected component inside bbox and builds anti-aliased mask & clean cutout.
 */
export async function segmentObjectFromBBox(
  imageUrl: string,
  bbox: NormalizedBoundingBox,
  options?: { isTransparentObjectHint?: boolean; useRemoteSam?: boolean }
): Promise<SegmentationOutput> {
  const img = await loadImage(imageUrl);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // Always extract rectangular BBox crop first so it stays independent of mask edits
  const { bboxCroppedUrl } = await cropImageByBoundingBox(imageUrl, bbox, 1024);

  // Try optional remote SAM endpoint when explicitly configured & requested
  if (options?.useRemoteSam) {
    try {
      const res = await fetch('/api/segment-object', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageUrl, boundingBox: bbox }),
      });
      if (res.ok) {
        const json = await res.json();
        const remoteMaskUrl =
          json?.data?.maskDataUrl || json?.data?.maskUrl || json?.data?.mask || null;
        if (typeof remoteMaskUrl === 'string' && remoteMaskUrl.startsWith('data:image/')) {
          const maskImg = await loadImage(remoteMaskUrl);
          const fullMaskCanvas = document.createElement('canvas');
          fullMaskCanvas.width = origW;
          fullMaskCanvas.height = origH;
          const fCtx = fullMaskCanvas.getContext('2d')!;
          fCtx.drawImage(maskImg, 0, 0, origW, origH);
          const rebuilt = await rebuildSegmentedAssets(imageUrl, fullMaskCanvas, bbox, bboxCroppedUrl);
          return {
            maskDataUrl: rebuilt.maskDataUrl,
            bboxCroppedUrl: rebuilt.bboxCroppedUrl,
            croppedObjectUrl: rebuilt.croppedObjectUrl,
            processedImageUrl: rebuilt.processedImageUrl,
            boundingBox: bbox,
            foregroundRatio: rebuilt.foregroundRatio,
            silhouetteProfile: rebuilt.silhouetteProfile,
            contourPoints: rebuilt.contourPoints,
            imageWidth: origW,
            imageHeight: origH,
            engineUsed: 'remote_sam_api',
          };
        }
      }
    } catch {
      // Fall back transparently to local GrabCut/Sobel engine
    }
  }

  // Compute segmentation on max 320px working grid for ~25ms responsiveness
  const workMax = 300;
  const scale = Math.min(1, workMax / Math.max(origW, origH));
  const w = Math.max(48, Math.round(origW * scale));
  const h = Math.max(48, Math.round(origH * scale));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const wCtx = workCanvas.getContext('2d', { willReadFrequently: true })!;
  wCtx.drawImage(img, 0, 0, w, h);
  const px = wCtx.getImageData(0, 0, w, h).data;

  const rx0 = Math.max(0, Math.floor(bbox.xMin * w));
  const ry0 = Math.max(0, Math.floor(bbox.yMin * h));
  const rx1 = Math.min(w - 1, Math.ceil(bbox.xMax * w));
  const ry1 = Math.min(h - 1, Math.ceil(bbox.yMax * h));
  const boxW = Math.max(4, rx1 - rx0 + 1);
  const boxH = Math.max(4, ry1 - ry0 + 1);

  // Luminance & Sobel edge magnitude
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    lum[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  }
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[i - w - 1] +
        lum[i - w + 1] -
        2 * lum[i - 1] +
        2 * lum[i + 1] -
        lum[i + w - 1] +
        lum[i + w + 1];
      const gy =
        -lum[i - w - 1] -
        2 * lum[i - w] -
        lum[i - w + 1] +
        lum[i + w - 1] +
        2 * lum[i + w] +
        lum[i + w + 1];
      edge[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 180);
    }
  }

  // Sample background colors from outside bbox (or inner margin if bbox fills whole frame)
  type RGB = [number, number, number];
  const bgSamples: RGB[] = [];
  const fgSamples: RGB[] = [];

  const padX = Math.max(2, Math.round(boxW * 0.08));
  const padY = Math.max(2, Math.round(boxH * 0.08));

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const p = (y * w + x) * 4;
      const rgb: RGB = [px[p], px[p + 1], px[p + 2]];
      const inBox = x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
      if (!inBox) {
        bgSamples.push(rgb);
      } else {
        const inCore =
          x >= rx0 + boxW * 0.28 &&
          x <= rx1 - boxW * 0.28 &&
          y >= ry0 + boxH * 0.22 &&
          y <= ry1 - boxH * 0.22;
        if (inCore) {
          fgSamples.push(rgb);
        } else if (x < rx0 + padX || x > rx1 - padX || y < ry0 + padY || y > ry1 - padY) {
          // If bbox covers virtually entire image, fallback to border strips as background
          if (boxW > w * 0.92 && boxH > h * 0.92) {
            bgSamples.push(rgb);
          }
        }
      }
    }
  }

  // Fallback sample clusters using quantized color buckets (max 8 clusters each)
  const quantizePalette = (samples: RGB[], maxClusters = 8): RGB[] => {
    if (samples.length === 0) return [[240, 240, 240]];
    const buckets = new Map<string, { sumR: number; sumG: number; sumB: number; count: number }>();
    for (const [r, g, b] of samples) {
      const key = `${r >> 5}_${g >> 5}_${b >> 5}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.sumR += r;
        existing.sumG += g;
        existing.sumB += b;
        existing.count++;
      } else {
        buckets.set(key, { sumR: r, sumG: g, sumB: b, count: 1 });
      }
    }
    return Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, maxClusters)
      .map((c) => [c.sumR / c.count, c.sumG / c.count, c.sumB / c.count]);
  };

  let bgClusters = quantizePalette(bgSamples, 10);
  let fgClusters = quantizePalette(fgSamples, 10);

  const minClusterDist = (r: number, g: number, b: number, clusters: RGB[]): number => {
    let best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const d = colorDistSq(r, g, b, c[0], c[1], c[2]);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  // Mask grid: 1 = foreground, 0 = background
  let mask = new Uint8Array(w * h);
  const cx = (rx0 + rx1) * 0.5;
  const cy = (ry0 + ry1) * 0.5;
  const transparentBias = options?.isTransparentObjectHint ? 1.25 : 1.0;

  // Iterative refinement
  for (let iter = 0; iter < 3; iter++) {
    const nextMask = new Uint8Array(w * h);
    const refinedFg: RGB[] = [];
    const refinedBg: RGB[] = [];

    for (let y = ry0; y <= ry1; y++) {
      for (let x = rx0; x <= rx1; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        const r = px[p];
        const g = px[p + 1];
        const b = px[p + 2];

        const dBg = minClusterDist(r, g, b, bgClusters);
        const dFg = minClusterDist(r, g, b, fgClusters);
        const edgeBoost = edge[idx] * 95 * transparentBias;

        const nx = (x - cx) / (boxW * 0.5);
        const ny = (y - cy) / (boxH * 0.5);
        const radial = Math.sqrt(nx * nx + ny * ny);
        const spatialPrior = radial < 0.65 ? 24 : radial > 0.95 ? -26 : 0;

        // Neighbor smoothness from previous iteration
        let neighborVotes = 0;
        if (iter > 0) {
          if (x > rx0 && mask[idx - 1]) neighborVotes++;
          if (x < rx1 && mask[idx + 1]) neighborVotes++;
          if (y > ry0 && mask[idx - w]) neighborVotes++;
          if (y < ry1 && mask[idx + w]) neighborVotes++;
          neighborVotes = (neighborVotes - 2) * 18;
        }

        const scoreFg = (dBg + edgeBoost + spatialPrior + neighborVotes) - dFg * 0.85;
        const isFg = scoreFg > 10;
        nextMask[idx] = isFg ? 1 : 0;

        if ((x + y) % 2 === 0) {
          if (isFg) refinedFg.push([r, g, b]);
          else refinedBg.push([r, g, b]);
        }
      }
    }

    mask = nextMask;
    if (refinedFg.length > 40) fgClusters = quantizePalette(refinedFg, 10);
    if (refinedBg.length > 40 && bgSamples.length < 40) {
      bgClusters = quantizePalette(refinedBg, 10);
    }
  }

  // Morphological 3x3 closing to fill small internal speck gaps while preserving genuine larger holes
  const closed = new Uint8Array(mask);
  for (let y = ry0 + 1; y < ry1; y++) {
    for (let x = rx0 + 1; x < rx1; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0) {
        const cardNeighbors =
          mask[idx - 1] + mask[idx + 1] + mask[idx - w] + mask[idx + w];
        if (cardNeighbors >= 3) closed[idx] = 1;
      }
    }
  }

  // Keep largest connected component inside bbox to strip stray background flecks
  const visited = new Uint8Array(w * h);
  let bestComponent: number[] = [];
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      const start = y * w + x;
      if (closed[start] !== 1 || visited[start]) continue;
      const queue = [start];
      visited[start] = 1;
      const comp: number[] = [];
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        comp.push(cur);
        const cxP = cur % w;
        const cyP = Math.floor(cur / w);
        const neighbors = [
          cxP > rx0 ? cur - 1 : -1,
          cxP < rx1 ? cur + 1 : -1,
          cyP > ry0 ? cur - w : -1,
          cyP < ry1 ? cur + w : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && closed[n] === 1 && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }
      if (comp.length > bestComponent.length) {
        bestComponent = comp;
      }
    }
  }

  const finalMask = new Uint8Array(w * h);
  if (bestComponent.length > 20) {
    for (const idx of bestComponent) finalMask[idx] = 1;
  } else {
    // Graceful fallback: keep centered elliptical/box foreground inside ROI
    for (let y = ry0; y <= ry1; y++) {
      for (let x = rx0; x <= rx1; x++) {
        finalMask[y * w + x] = 1;
      }
    }
  }

  // Extract normalized silhouette profilePoints (yRatio 0 bottom .. 1 top) and outer 2D contourPoints ([-0.5..0.5])
  const silhouetteProfile = extractProfileFromMask(finalMask, w, h, rx0, ry0, rx1, ry1);
  const contourPoints = extractContourPointsFromMask(finalMask, w, h, rx0, ry0, rx1, ry1);

  // Build maskDataUrl at working resolution, then upscale cleanly onto full-res canvases
  const mSmall = document.createElement('canvas');
  mSmall.width = w;
  mSmall.height = h;
  const mSmallCtx = mSmall.getContext('2d')!;
  const mImg = mSmallCtx.createImageData(w, h);
  let fgTotal = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const isFg = finalMask[i] === 1;
    if (isFg) fgTotal++;
    mImg.data[p] = 255;
    mImg.data[p + 1] = 255;
    mImg.data[p + 2] = 255;
    mImg.data[p + 3] = isFg ? 255 : 0;
  }
  mSmallCtx.putImageData(mImg, 0, 0);

  // Full-resolution mask data URL (slightly feathered 1px for crisp anti-aliased edges)
  const fullMaskCanvas = document.createElement('canvas');
  fullMaskCanvas.width = origW;
  fullMaskCanvas.height = origH;
  const fMCtx = fullMaskCanvas.getContext('2d')!;
  fMCtx.imageSmoothingEnabled = true;
  fMCtx.filter = 'blur(1px)';
  fMCtx.drawImage(mSmall, 0, 0, origW, origH);
  fMCtx.filter = 'none';
  const maskDataUrl = fullMaskCanvas.toDataURL('image/png');

  // Generate cropped & transparent background object image (Cropped Object Image)
  const { croppedObjectUrl, processedImageUrl } = await applyMaskAndCrop(
    img,
    fullMaskCanvas,
    bbox
  );

  const boxArea = Math.max(1, boxW * boxH);
  return {
    maskDataUrl,
    bboxCroppedUrl,
    croppedObjectUrl,
    processedImageUrl,
    boundingBox: bbox,
    foregroundRatio: Number((fgTotal / boxArea).toFixed(3)),
    silhouetteProfile,
    contourPoints,
    imageWidth: origW,
    imageHeight: origH,
    engineUsed: 'client_grabcut_v1',
  };
}

/**
 * Segments a CapturedViewEntry cleanly using its boundingBox (or centered fallback).
 */
export async function segmentViewEntry(
  view: CapturedViewEntry,
  options?: { isTransparentObjectHint?: boolean; useRemoteSam?: boolean }
): Promise<SegmentationOutput> {
  const bbox = view.boundingBox || { xMin: 0.14, yMin: 0.08, xMax: 0.86, yMax: 0.92 };
  return segmentObjectFromBBox(view.originalImage, bbox, options);
}

/**
 * Applies an arbitrary mask canvas (e.g. after user brush edits) to produce updated
 * bboxCroppedUrl, croppedObjectUrl, processedImageUrl, foregroundRatio, and silhouette profilePoints.
 */
export async function rebuildSegmentedAssets(
  originalImageUrl: string,
  maskCanvas: HTMLCanvasElement,
  bbox: NormalizedBoundingBox,
  existingBBoxCroppedUrl?: string
): Promise<{
  maskDataUrl: string;
  bboxCroppedUrl: string;
  croppedObjectUrl: string;
  processedImageUrl: string;
  silhouetteProfile: ProfilePoint[];
  contourPoints: ContourPoint[];
  foregroundRatio: number;
}> {
  const img = await loadImage(originalImageUrl);
  const maskDataUrl = maskCanvas.toDataURL('image/png');
  const bboxCroppedUrl =
    existingBBoxCroppedUrl || (await cropImageByBoundingBox(originalImageUrl, bbox, 1024)).bboxCroppedUrl;
  const { croppedObjectUrl, processedImageUrl } = await applyMaskAndCrop(img, maskCanvas, bbox);

  // Sample mask at <= 256px for silhouette profile extraction & foregroundRatio calculation
  const sw = Math.min(256, maskCanvas.width);
  const sh = Math.max(32, Math.round((maskCanvas.height / maskCanvas.width) * sw));
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sw;
  sampleCanvas.height = sh;
  const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  sCtx.drawImage(maskCanvas, 0, 0, sw, sh);
  const alphaPx = sCtx.getImageData(0, 0, sw, sh).data;
  const bin = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    bin[i] = alphaPx[i * 4 + 3] > 120 ? 1 : 0;
  }

  const rx0 = Math.max(0, Math.floor(bbox.xMin * sw));
  const ry0 = Math.max(0, Math.floor(bbox.yMin * sh));
  const rx1 = Math.min(sw - 1, Math.ceil(bbox.xMax * sw));
  const ry1 = Math.min(sh - 1, Math.ceil(bbox.yMax * sh));
  const silhouetteProfile = extractProfileFromMask(bin, sw, sh, rx0, ry0, rx1, ry1);
  const contourPoints = extractContourPointsFromMask(bin, sw, sh, rx0, ry0, rx1, ry1);

  let fg = 0;
  let tot = 0;
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      tot++;
      if (bin[y * sw + x] === 1) fg++;
    }
  }
  const foregroundRatio = tot > 0 ? Number((fg / tot).toFixed(3)) : 0.5;

  return {
    maskDataUrl,
    bboxCroppedUrl,
    croppedObjectUrl,
    processedImageUrl,
    silhouetteProfile,
    contourPoints,
    foregroundRatio,
  };
}

async function applyMaskAndCrop(
  img: HTMLImageElement,
  fullMaskCanvas: HTMLCanvasElement,
  bbox: NormalizedBoundingBox
): Promise<{ croppedObjectUrl: string; processedImageUrl: string }> {
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // 1. Full-frame masked object (transparent outside object)
  const maskedCanvas = document.createElement('canvas');
  maskedCanvas.width = origW;
  maskedCanvas.height = origH;
  const mCtx = maskedCanvas.getContext('2d')!;
  mCtx.drawImage(img, 0, 0, origW, origH);
  mCtx.globalCompositeOperation = 'destination-in';
  mCtx.drawImage(fullMaskCanvas, 0, 0, origW, origH);
  mCtx.globalCompositeOperation = 'source-over';

  // 2. Cropped to bounding box
  const sx = Math.max(0, Math.floor(bbox.xMin * origW));
  const sy = Math.max(0, Math.floor(bbox.yMin * origH));
  const sw = Math.max(16, Math.min(origW - sx, Math.ceil((bbox.xMax - bbox.xMin) * origW)));
  const sh = Math.max(16, Math.min(origH - sy, Math.ceil((bbox.yMax - bbox.yMin) * origH)));

  const cropMax = 768;
  const cropScale = Math.min(1, cropMax / Math.max(sw, sh));
  const cw = Math.max(32, Math.round(sw * cropScale));
  const ch = Math.max(32, Math.round(sh * cropScale));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cw;
  cropCanvas.height = ch;
  const cCtx = cropCanvas.getContext('2d')!;
  cCtx.drawImage(maskedCanvas, sx, sy, sw, sh, 0, 0, cw, ch);
  const croppedObjectUrl = cropCanvas.toDataURL('image/png');

  // 3. Processed Image: centered on clean light neutral studio canvas (optimal for Gemini/Image-to-3D)
  const procSize = 640;
  const procCanvas = document.createElement('canvas');
  procCanvas.width = procSize;
  procCanvas.height = procSize;
  const pCtx = procCanvas.getContext('2d')!;
  pCtx.fillStyle = '#f8fafc';
  pCtx.fillRect(0, 0, procSize, procSize);
  const fitScale = Math.min((procSize * 0.84) / cw, (procSize * 0.84) / ch);
  const dw = Math.round(cw * fitScale);
  const dh = Math.round(ch * fitScale);
  pCtx.drawImage(cropCanvas, (procSize - dw) / 2, (procSize - dh) / 2, dw, dh);
  const processedImageUrl = procCanvas.toDataURL('image/jpeg', 0.9);

  return { croppedObjectUrl, processedImageUrl };
}

/**
 * Extracts horizontal half-width silhouette profile points along Y (bottom=0, top=1)
 * directly from the segmented foreground mask.
 */
export function extractProfileFromMask(
  mask: Uint8Array,
  w: number,
  h: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number
): ProfilePoint[] {
  let topY = ry1;
  let botY = ry0;
  const rowWidths: { y: number; width: number }[] = [];

  for (let y = ry0; y <= ry1; y++) {
    let minX = rx1 + 1;
    let maxX = rx0 - 1;
    for (let x = rx0; x <= rx1; x++) {
      if (mask[y * w + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX >= minX) {
      if (y < topY) topY = y;
      if (y > botY) botY = y;
      rowWidths.push({ y, width: maxX - minX + 1 });
    }
  }

  if (rowWidths.length < 6 || botY <= topY) return [];

  const maxSpan = Math.max(...rowWidths.map((r) => r.width), 1);
  const spanY = Math.max(1, botY - topY);

  // Sample 14 evenly spaced vertical slices from bottom (yRatio=0) to top (yRatio=1)
  const samples = 14;
  const profile: ProfilePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const yRatio = i / (samples - 1);
    const targetY = Math.round(botY - yRatio * spanY);
    // Average small window +/-2 rows to suppress jagged noise
    let sumW = 0;
    let cnt = 0;
    for (const r of rowWidths) {
      if (Math.abs(r.y - targetY) <= 2) {
        sumW += r.width;
        cnt++;
      }
    }
    const avgW = cnt > 0 ? sumW / cnt : maxSpan * 0.5;
    profile.push({
      yRatio: Number(yRatio.toFixed(3)),
      radiusRatio: Number(Math.max(0.05, Math.min(1.0, avgW / maxSpan)).toFixed(3)),
      isEstimated: false,
    });
  }

  return profile;
}

/**
 * Extracts a closed 2D outer contour polygon (centered normalized coordinates [-0.5..0.5],
 * +Y upward) by scanning horizontal silhouette spans from top-to-bottom on the right boundary
 * and bottom-to-top on the left boundary, producing a smooth, non-self-intersecting polygon.
 */
export function extractContourPointsFromMask(
  mask: Uint8Array,
  w: number,
  h: number,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number,
  slicesPerSide = 12
): ContourPoint[] {
  const rows: { y: number; minX: number; maxX: number }[] = [];
  let minXAll = rx1;
  let maxXAll = rx0;
  let minYAll = ry1;
  let maxYAll = ry0;

  for (let y = ry0; y <= ry1; y++) {
    let minX = rx1 + 1;
    let maxX = rx0 - 1;
    for (let x = rx0; x <= rx1; x++) {
      if (mask[y * w + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX >= minX) {
      rows.push({ y, minX, maxX });
      if (minX < minXAll) minXAll = minX;
      if (maxX > maxXAll) maxXAll = maxX;
      if (y < minYAll) minYAll = y;
      if (y > maxYAll) maxYAll = y;
    }
  }

  if (rows.length < 4 || maxXAll <= minXAll || maxYAll <= minYAll) {
    return [];
  }

  const midX = (minXAll + maxXAll) * 0.5;
  const midY = (minYAll + maxYAll) * 0.5;
  const spanX = Math.max(1, maxXAll - minXAll);
  const spanY = Math.max(1, maxYAll - minYAll);

  const rightSide: ContourPoint[] = [];
  const leftSide: ContourPoint[] = [];

  for (let i = 0; i < slicesPerSide; i++) {
    const t = i / (slicesPerSide - 1);
    const idx = Math.min(rows.length - 1, Math.round(t * (rows.length - 1)));
    const row = rows[idx];
    const ny = Number(((midY - row.y) / spanY).toFixed(4));
    const nxRight = Number(((row.maxX - midX) / spanX).toFixed(4));
    const nxLeft = Number(((row.minX - midX) / spanX).toFixed(4));
    rightSide.push({ x: nxRight, y: ny });
    leftSide.push({ x: nxLeft, y: ny });
  }

  // Right edge goes top -> bottom, then left edge goes bottom -> top (closed CCW loop)
  const rawLoop = [...rightSide, ...leftSide.reverse()];
  const deduped: ContourPoint[] = [];
  for (const pt of rawLoop) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 0.025) {
      deduped.push(pt);
    }
  }

  // Check closure distance against first point
  if (deduped.length >= 4) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.02) {
      deduped.pop();
    }
  }

  return deduped.length >= 4 ? deduped : [];
}
