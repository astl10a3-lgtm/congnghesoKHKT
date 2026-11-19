import type {
  MeasurementMethod,
  MetricEstimate,
  NormalizedBoundingBox,
  ReferenceObjectType,
} from '../types/reconstruction';

export interface ReferenceObjectSpec {
  id: ReferenceObjectType;
  label: string;
  knownLengthCm: number; // primary reference dimension
  knownWidthCm: number;
  description: string;
}

export const REFERENCE_OBJECTS: Record<ReferenceObjectType, ReferenceObjectSpec> = {
  credit_card_85mm: {
    id: 'credit_card_85mm',
    label: 'Thẻ ngân hàng / Thẻ học sinh (8.56 × 5.40 cm)',
    knownLengthCm: 8.56,
    knownWidthCm: 5.398,
    description: 'Kích thước chuẩn ISO/IEC 7810 ID-1: 85.60 × 53.98 mm.',
  },
  ruler_30cm: {
    id: 'ruler_30cm',
    label: 'Thước kẻ học sinh 30cm',
    knownLengthCm: 30.0,
    knownWidthCm: 3.0,
    description: 'Đặt thước thẳng đứng hoặc nằm ngang cạnh vật thể.',
  },
  ruler_15cm: {
    id: 'ruler_15cm',
    label: 'Thước kẻ mini 15cm',
    knownLengthCm: 15.0,
    knownWidthCm: 2.5,
    description: 'Thước kẻ 15cm đặt trên cùng mặt phẳng với vật thể.',
  },
  a4_paper: {
    id: 'a4_paper',
    label: 'Tờ giấy A4 chuẩn (21.0 × 29.7 cm)',
    knownLengthCm: 29.7,
    knownWidthCm: 21.0,
    description: 'Đặt vật thể lên trên hoặc ngay cạnh tờ giấy A4 trắng.',
  },
  aruco_50mm: {
    id: 'aruco_50mm',
    label: 'ArUco Marker chuẩn 5.0 × 5.0 cm',
    knownLengthCm: 5.0,
    knownWidthCm: 5.0,
    description: 'Marker in trên giấy kích thước đúng 50 × 50 mm đặt cạnh vật thể.',
  },
  coin_25mm: {
    id: 'coin_25mm',
    label: 'Đồng xu / Nắp chai chuẩn (2.5 cm)',
    knownLengthCm: 2.5,
    knownWidthCm: 2.5,
    description: 'Đường kính xấp xỉ 25 mm dùng làm chuẩn gần đúng.',
  },
  none: {
    id: 'none',
    label: 'Không có vật tham chiếu (Ước lượng tương đối)',
    knownLengthCm: 0,
    knownWidthCm: 0,
    description: 'Độ tin cậy kích thước tuyệt đối sẽ thấp hơn khi không có vật chuẩn.',
  },
};

export interface PixelMeasurementInput {
  imageWidth: number;
  imageHeight: number;
  objectBBox: NormalizedBoundingBox;
  referenceType: ReferenceObjectType;
  referenceLinePx?: { x1: number; y1: number; x2: number; y2: number } | null;
  referenceBox?: NormalizedBoundingBox | null;
  sideViewBBox?: NormalizedBoundingBox | null;
  perspectiveTiltDetected?: boolean;
}

export interface CalibratedDimensionResult {
  heightCm: number | null;
  widthCm: number | null;
  depthCm: number | null;
  scaleCmPerPx: number | null;
  method: MeasurementMethod;
  perMetric: {
    height: MetricEstimate;
    width: MetricEstimate;
    depth: MetricEstimate;
  };
  notes: string[];
}

/**
 * Computes real-world dimensions from image pixel measurements and reference calibration.
 * Avoids blindly asserting precision when perspective tilt is severe or reference is missing.
 */
export function computeCalibratedDimensions(
  input: PixelMeasurementInput
): CalibratedDimensionResult {
  const refSpec = REFERENCE_OBJECTS[input.referenceType];
  const objPxW = (input.objectBBox.xMax - input.objectBBox.xMin) * input.imageWidth;
  const objPxH = (input.objectBBox.yMax - input.objectBBox.yMin) * input.imageHeight;
  const notes: string[] = [];

  let refPxLength = 0;
  let refKnownCm = refSpec.knownLengthCm;
  let method: MeasurementMethod = 'unknown';
  let baseConf = 0;

  if (input.referenceType !== 'none' && input.referenceLinePx) {
    const dx = (input.referenceLinePx.x2 - input.referenceLinePx.x1) * input.imageWidth;
    const dy = (input.referenceLinePx.y2 - input.referenceLinePx.y1) * input.imageHeight;
    refPxLength = Math.sqrt(dx * dx + dy * dy);
    method = 'reference_object';
    baseConf = input.perspectiveTiltDetected ? 0.72 : 0.91;
    notes.push(
      `Đo bằng đoạn chuẩn do người dùng đánh dấu (${Math.round(refPxLength)} px ≈ ${refKnownCm} cm).`
    );
  } else if (input.referenceType !== 'none' && input.referenceBox) {
    const rw = (input.referenceBox.xMax - input.referenceBox.xMin) * input.imageWidth;
    const rh = (input.referenceBox.yMax - input.referenceBox.yMin) * input.imageHeight;
    refPxLength = Math.max(rw, rh);
    method = 'reference_object';
    baseConf = input.perspectiveTiltDetected ? 0.68 : 0.85;
    notes.push(
      `Đo bằng khung vật chuẩn (${Math.round(refPxLength)} px ≈ ${refKnownCm} cm).`
    );
  } else {
    notes.push(
      'Chưa đánh dấu trực tiếp vật chuẩn trên ảnh; kích thước tuyệt đối sẽ cần AI Vision hoặc người dùng hiệu chuẩn.'
    );
  }

  if (input.perspectiveTiltDetected) {
    notes.push('Phát hiện góc nghiêng phối cảnh, độ tin cậy kích thước đã được hạ xuống tương ứng.');
  }

  if (refPxLength < 12 || refKnownCm <= 0) {
    return {
      heightCm: null,
      widthCm: null,
      depthCm: null,
      scaleCmPerPx: null,
      method,
      perMetric: {
        height: { valueCm: null, method: 'unknown', confidence: 0 },
        width: { valueCm: null, method: 'unknown', confidence: 0 },
        depth: { valueCm: null, method: 'unknown', confidence: 0 },
      },
      notes,
    };
  }

  const scaleCmPerPx = refKnownCm / refPxLength;
  const heightCm = Number((objPxH * scaleCmPerPx).toFixed(2));
  const widthCm = Number((objPxW * scaleCmPerPx).toFixed(2));

  let depthCm: number | null = null;
  let depthMethod: MeasurementMethod = 'unknown';
  let depthConf = 0;

  if (input.sideViewBBox) {
    const sidePxW = (input.sideViewBBox.xMax - input.sideViewBBox.xMin) * input.imageWidth;
    const sidePxH = (input.sideViewBBox.yMax - input.sideViewBBox.yMin) * input.imageHeight;
    if (sidePxH > 20) {
      // Scale side view height to front view height
      const sideRatio = sidePxW / sidePxH;
      depthCm = Number((heightCm * sideRatio).toFixed(2));
      depthMethod = 'multi_view_estimation';
      depthConf = Number((baseConf * 0.88).toFixed(2));
      notes.push(`Chiều sâu ước lượng từ ảnh góc bên / 45° (${depthCm} cm).`);
    }
  }

  return {
    heightCm,
    widthCm,
    depthCm,
    scaleCmPerPx: Number(scaleCmPerPx.toFixed(5)),
    method,
    perMetric: {
      height: { valueCm: heightCm, method, confidence: Number(baseConf.toFixed(2)) },
      width: { valueCm: widthCm, method, confidence: Number(baseConf.toFixed(2)) },
      depth: { valueCm: depthCm, method: depthMethod, confidence: depthConf },
    },
    notes,
  };
}

/**
 * Generates an SVG data URL for a standard 4x4 ArUco Marker (ID 0, 50x50mm calibration card)
 * so users can display/print it without needing external asset downloads.
 */
export function generateArucoMarkerSvgDataUrl(markerId: number = 0): string {
  // 6x6 grid (1-cell black border + 4x4 inner bit pattern for ArUco DICT_4X4 ID=0)
  const bits =
    markerId === 0
      ? [
          [1, 0, 1, 1],
          [0, 1, 0, 1],
          [1, 1, 0, 0],
          [0, 0, 1, 1],
        ]
      : [
          [1, 1, 0, 1],
          [1, 0, 1, 0],
          [0, 1, 1, 0],
          [1, 0, 0, 1],
        ];

  const cell = 30;
  const size = 6 * cell;
  let rects = `<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>`;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const isBorder = r === 0 || r === 5 || c === 0 || c === 5;
      const isBlack = isBorder || bits[r - 1][c - 1] === 1;
      if (isBlack) {
        rects += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#000000"/>`;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 28}" viewBox="0 0 ${size} ${size + 28}">${rects}<text x="${size / 2}" y="${size + 19}" font-family="monospace" font-size="12" font-weight="bold" text-anchor="middle" fill="#0f172a">ArUco 4x4 ID:${markerId} (50×50mm)</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
