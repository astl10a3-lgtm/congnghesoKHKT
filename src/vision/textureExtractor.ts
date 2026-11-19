import * as THREE from 'three';
import type { ProfilePoint } from '../types/reconstruction';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không thể tải ảnh để tách texture.'));
    img.src = src;
  });
}

export type TextureProjectionMode = 'cylindrical_body' | 'label_band' | 'planar_face';

export interface UvAlignmentMetrics {
  hasValidUv: boolean;
  uvCoverageRatio: number; // fraction of valid [0..1] vertices
  stretchDistortionScore: number; // 0..1 (higher = less distortion)
  uvBounds: { uMin: number; uMax: number; vMin: number; vMax: number } | null;
  degenerateUvTriangles: number;
}

/**
 * Extracts a clean power-of-2 sRGB diffuse albedo texture from the segmented object photo.
 * Prevents background bleed & extreme stretching by tailoring extraction to component role:
 * - label_band: crops tightly around labelBandY [yMin..yMax] for crisp bottle/can label wrap
 * - planar_face: samples centered foreground interior aspect-preserving for boxes/extrudes
 * - cylindrical_body: smooths horizontal foreground span with rear mirror-seam blend
 */
export async function extractObjectTextureCanvas(
  croppedObjectUrl: string,
  options?: {
    size?: 256 | 512 | 1024;
    mode?: TextureProjectionMode;
    labelBandOnly?: boolean;
    labelBandY?: [number, number] | null;
    fallbackTintHex?: string;
  }
): Promise<HTMLCanvasElement> {
  const size = options?.size || 512;
  const mode: TextureProjectionMode =
    options?.mode || (options?.labelBandOnly ? 'label_band' : 'cylindrical_body');
  const img = await loadImage(croppedObjectUrl);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const fallbackHex = options?.fallbackTintHex || '#cbd5e1';
  ctx.fillStyle = fallbackHex;
  ctx.fillRect(0, 0, size, size);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  // Source Y crop window depending on projection mode
  let sy = 0;
  let sh = ih;
  if (mode === 'label_band') {
    const band = options?.labelBandY;
    const topFrac = band ? Math.max(0.05, Math.min(0.8, 1 - band[1])) : 0.28;
    const botFrac = band ? Math.max(topFrac + 0.12, Math.min(0.95, 1 - band[0])) : 0.7;
    sy = Math.round(ih * topFrac);
    sh = Math.max(16, Math.round(ih * (botFrac - topFrac)));
  } else if (mode === 'planar_face') {
    sy = Math.round(ih * 0.08);
    sh = Math.max(16, Math.round(ih * 0.84));
  }

  // Draw segmented image into temporary buffer to inspect alpha and bleed edges cleanly
  const tmp = document.createElement('canvas');
  tmp.width = size;
  tmp.height = size;
  const tCtx = tmp.getContext('2d', { willReadFrequently: true })!;
  tCtx.drawImage(img, 0, sy, iw, sh, 0, 0, size, size);
  const srcPx = tCtx.getImageData(0, 0, size, size).data;

  // Parse fallback color RGB
  const fbRgb = new THREE.Color(fallbackHex);
  const fbR = Math.round(fbRgb.r * 255);
  const fbG = Math.round(fbRgb.g * 255);
  const fbB = Math.round(fbRgb.b * 255);

  const outData = ctx.createImageData(size, size);
  const out = outData.data;

  if (mode === 'planar_face') {
    // Aspect-preserving interior sample: find tight opaque foreground box first
    let fgMinX: number = size;
    let fgMaxX: number = -1;
    let fgMinY: number = size;
    let fgMaxY: number = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (srcPx[(y * size + x) * 4 + 3] > 120) {
          if (x < fgMinX) fgMinX = x;
          if (x > fgMaxX) fgMaxX = x;
          if (y < fgMinY) fgMinY = y;
          if (y > fgMaxY) fgMaxY = y;
        }
      }
    }
    if (fgMaxX > fgMinX + 8 && fgMaxY > fgMinY + 8) {
      // Trim 6% edge margin to avoid background halo fringe on flat box faces
      const padX = Math.round((fgMaxX - fgMinX) * 0.06);
      const padY = Math.round((fgMaxY - fgMinY) * 0.06);
      const cropX = fgMinX + padX;
      const cropY = fgMinY + padY;
      const cropW = Math.max(8, fgMaxX - fgMinX - padX * 2);
      const cropH = Math.max(8, fgMaxY - fgMinY - padY * 2);
      ctx.drawImage(tmp, cropX, cropY, cropW, cropH, 0, 0, size, size);
      return canvas;
    }
  }

  // Row-by-row foreground extraction with seamless mirrored wrap + edge bleed
  for (let y = 0; y < size; y++) {
    let minX: number = size;
    let maxX: number = -1;
    for (let x = 0; x < size; x++) {
      const a = srcPx[(y * size + x) * 4 + 3];
      if (a > 115) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }

    if (maxX > minX + 6) {
      // Trim 4% outer silhouette edge to eliminate halo fringe on cylinder wrap
      const inset = Math.floor((maxX - minX) * 0.04);
      const safeMin = minX + inset;
      const safeSpan = Math.max(4, maxX - minX - inset * 2);

      for (let x = 0; x < size; x++) {
        const uNorm = x / (size - 1);
        const mirroredU = uNorm <= 0.5 ? uNorm * 2 : (1 - uNorm) * 2;
        const sampleX = Math.min(size - 1, Math.max(0, Math.round(safeMin + mirroredU * safeSpan)));
        const sp = (y * size + sampleX) * 4;
        const dp = (y * size + x) * 4;
        const alpha = srcPx[sp + 3] / 255;
        // Soft blend with fallback tint when semi-transparent
        out[dp] = Math.round(srcPx[sp] * alpha + fbR * (1 - alpha));
        out[dp + 1] = Math.round(srcPx[sp + 1] * alpha + fbG * (1 - alpha));
        out[dp + 2] = Math.round(srcPx[sp + 2] * alpha + fbB * (1 - alpha));
        out[dp + 3] = 255;
      }
    } else {
      const dpBase = y * size * 4;
      for (let x = 0; x < size; x++) {
        const dp = dpBase + x * 4;
        out[dp] = fbR;
        out[dp + 1] = fbG;
        out[dp + 2] = fbB;
        out[dp + 3] = 255;
      }
    }
  }

  ctx.putImageData(outData, 0, 0);
  return canvas;
}

/**
 * Inspects UV attribute integrity, [0..1] bounds coverage, and UV-to-3D triangle stretch distortion.
 */
export function analyzeUvAndTextureAlignment(
  geometry: THREE.BufferGeometry
): UvAlignmentMetrics {
  const uv = geometry.getAttribute('uv');
  const pos = geometry.getAttribute('position');
  if (!uv || !pos || uv.count === 0) {
    return {
      hasValidUv: false,
      uvCoverageRatio: 0,
      stretchDistortionScore: 0,
      uvBounds: null,
      degenerateUvTriangles: 0,
    };
  }

  let validCount = 0;
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;

  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (Number.isFinite(u) && Number.isFinite(v)) {
      if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) {
        validCount++;
      }
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  const idx = geometry.getIndex();
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
  const step = Math.max(1, Math.floor(triCount / 2500));
  let degenerateUvTriangles = 0;
  let stretchPenaltySum = 0;
  let sampledTris = 0;

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();

  for (let t = 0; t < triCount; t += step) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

    const u0 = uv.getX(i0);
    const v0 = uv.getY(i0);
    const u1 = uv.getX(i1);
    const v1 = uv.getY(i1);
    const u2 = uv.getX(i2);
    const v2 = uv.getY(i2);

    const du1 = u1 - u0;
    const dv1 = v1 - v0;
    const du2 = u2 - u0;
    const dv2 = v2 - v0;
    const uvArea2 = Math.abs(du1 * dv2 - du2 * dv1);

    p0.fromBufferAttribute(pos, i0);
    p1.fromBufferAttribute(pos, i1);
    p2.fromBufferAttribute(pos, i2);
    const area3D = p1.clone().sub(p0).cross(p2.clone().sub(p0)).length();

    if (area3D > 1e-8 && uvArea2 < 1e-8) {
      degenerateUvTriangles++;
    } else if (area3D > 1e-7 && uvArea2 > 1e-8) {
      // Check anisotropy between U edge ratio and V edge ratio
      const len3d = p1.distanceTo(p0) + p2.distanceTo(p0) + 1e-5;
      const lenUv = Math.hypot(du1, dv1) + Math.hypot(du2, dv2) + 1e-5;
      const ratio = Math.min(len3d / lenUv, lenUv / len3d);
      stretchPenaltySum += 1 - Math.min(1, ratio * 2.5);
    }
    sampledTris++;
  }

  const uvCoverageRatio = Number((validCount / Math.max(1, uv.count)).toFixed(3));
  const avgDistortion = sampledTris > 0 ? stretchPenaltySum / sampledTris : 0;
  const degenPenalty = sampledTris > 0 ? Math.min(0.5, degenerateUvTriangles / sampledTris) : 0;
  const stretchDistortionScore = Number(
    Math.max(0, Math.min(1, 1 - avgDistortion * 0.65 - degenPenalty)).toFixed(3)
  );

  return {
    hasValidUv: validCount > 0 && Number.isFinite(uMin),
    uvCoverageRatio,
    stretchDistortionScore,
    uvBounds: Number.isFinite(uMin)
      ? {
          uMin: Number(uMin.toFixed(3)),
          uMax: Number(uMax.toFixed(3)),
          vMin: Number(vMin.toFixed(3)),
          vMax: Number(vMax.toFixed(3)),
        }
      : null,
    degenerateUvTriangles,
  };
}

/**
 * Evaluates real 2D silhouette overlap (IoU) between the reconstructed 3D lathe/box profile
 * and the segmented 2D mask profile — never returns a fake guessed percentage.
 */
export function evaluateSilhouetteOverlap(
  reconstructedProfile: ProfilePoint[],
  maskProfile: ProfilePoint[]
): { iou: number | null; meanRadiusError: number | null } {
  if (reconstructedProfile.length < 3 || maskProfile.length < 3) {
    return { iou: null, meanRadiusError: null };
  }

  const sampleRadiusAtY = (pts: ProfilePoint[], y: number): number => {
    if (y <= pts[0].yRatio) return pts[0].radiusRatio;
    if (y >= pts[pts.length - 1].yRatio) return pts[pts.length - 1].radiusRatio;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (y >= a.yRatio && y <= b.yRatio) {
        const t = (y - a.yRatio) / Math.max(0.0001, b.yRatio - a.yRatio);
        return a.radiusRatio + t * (b.radiusRatio - a.radiusRatio);
      }
    }
    return pts[pts.length - 1].radiusRatio;
  };

  let inter = 0;
  let union = 0;
  let errSum = 0;
  const steps = 25;

  for (let i = 0; i < steps; i++) {
    const y = i / (steps - 1);
    const rA = sampleRadiusAtY(reconstructedProfile, y);
    const rB = sampleRadiusAtY(maskProfile, y);
    inter += Math.min(rA, rB);
    union += Math.max(rA, rB);
    errSum += Math.abs(rA - rB);
  }

  return {
    iou: union > 0 ? Number((inter / union).toFixed(3)) : null,
    meanRadiusError: Number((errSum / steps).toFixed(3)),
  };
}
