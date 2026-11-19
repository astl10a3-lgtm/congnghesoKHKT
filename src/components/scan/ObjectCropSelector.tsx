import React, { useRef, useState } from 'react';
import {
  Crop,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Ruler,
  QrCode,
  Check,
  Move,
  Info,
  Scan,
} from 'lucide-react';
import {
  type NormalizedBoundingBox,
  type ReferenceObjectType,
  validateNormalizedBBox,
} from '../../types/reconstruction';
import {
  REFERENCE_OBJECTS,
  generateArucoMarkerSvgDataUrl,
} from '../../vision/referenceCalibration';
import { ModalDialog } from '../ui/ModalDialog';

export interface ReferenceLinePx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface ObjectCropSelectorProps {
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  bbox: NormalizedBoundingBox;
  onChangeBBox: (next: NormalizedBoundingBox) => void;
  referenceType: ReferenceObjectType;
  onChangeReferenceType?: (next: ReferenceObjectType) => void;
  referenceLine: ReferenceLinePx | null;
  onChangeReferenceLine: (next: ReferenceLinePx | null) => void;
  onAutoDetectBBox?: () => Promise<void> | void;
  isAutoDetecting?: boolean;
  viewLabel?: string;
}

type DragMode =
  | { type: 'move'; startX: number; startY: number; orig: NormalizedBoundingBox }
  | { type: 'handle'; handle: string; startX: number; startY: number; orig: NormalizedBoundingBox }
  | { type: 'refline'; startX: number; startY: number };

export const ObjectCropSelector: React.FC<ObjectCropSelectorProps> = ({
  imageUrl,
  imageWidth = 0,
  imageHeight = 0,
  bbox,
  onChangeBBox,
  referenceType,
  onChangeReferenceType,
  referenceLine,
  onChangeReferenceLine,
  onAutoDetectBBox,
  isAutoDetecting = false,
  viewLabel = 'Ảnh chính',
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number }>({
    w: imageWidth,
    h: imageHeight,
  });
  const [zoom, setZoom] = useState<number>(1);
  const [toolMode, setToolMode] = useState<'bbox' | 'refline'>('bbox');
  const [dragState, setDragState] = useState<DragMode | null>(null);
  const [showArucoModal, setShowArucoModal] = useState(false);

  // Compute normalized [0..1] strictly from the rendered <img> rect so resize/zoom never skews coordinates
  const getNormalizedPoint = (clientX: number, clientY: number) => {
    const rect = imgRef.current?.getBoundingClientRect() || stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handlePointerDownMove = (e: React.PointerEvent) => {
    if (toolMode !== 'bbox') return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    setDragState({ type: 'move', startX: pt.x, startY: pt.y, orig: bbox });
  };

  const handlePointerDownHandle = (handle: string, e: React.PointerEvent) => {
    if (toolMode !== 'bbox') return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    setDragState({ type: 'handle', handle, startX: pt.x, startY: pt.y, orig: bbox });
  };

  const handleStagePointerDown = (e: React.PointerEvent) => {
    if (toolMode !== 'refline') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e.clientX, e.clientY);
    onChangeReferenceLine({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
    setDragState({ type: 'refline', startX: pt.x, startY: pt.y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const pt = getNormalizedPoint(e.clientX, e.clientY);

    if (dragState.type === 'refline') {
      onChangeReferenceLine({
        x1: dragState.startX,
        y1: dragState.startY,
        x2: pt.x,
        y2: pt.y,
      });
      return;
    }

    const dx = pt.x - dragState.startX;
    const dy = pt.y - dragState.startY;
    const o = dragState.orig;

    if (dragState.type === 'move') {
      const w = o.xMax - o.xMin;
      const h = o.yMax - o.yMin;
      const nxMin = Math.max(0, Math.min(1 - w, o.xMin + dx));
      const nyMin = Math.max(0, Math.min(1 - h, o.yMin + dy));
      const validatedMove = validateNormalizedBBox({
        xMin: Number(nxMin.toFixed(4)),
        yMin: Number(nyMin.toFixed(4)),
        xMax: Number((nxMin + w).toFixed(4)),
        yMax: Number((nyMin + h).toFixed(4)),
      });
      if (validatedMove) onChangeBBox(validatedMove);
      return;
    }

    if (dragState.type === 'handle') {
      const minSize = 0.06;
      let { xMin, yMin, xMax, yMax } = o;
      const h = dragState.handle;
      if (h.includes('w')) xMin = Math.max(0, Math.min(xMax - minSize, o.xMin + dx));
      if (h.includes('e')) xMax = Math.min(1, Math.max(xMin + minSize, o.xMax + dx));
      if (h.includes('n')) yMin = Math.max(0, Math.min(yMax - minSize, o.yMin + dy));
      if (h.includes('s')) yMax = Math.min(1, Math.max(yMin + minSize, o.yMax + dy));
      const validatedHandle = validateNormalizedBBox({
        xMin: Number(xMin.toFixed(4)),
        yMin: Number(yMin.toFixed(4)),
        xMax: Number(xMax.toFixed(4)),
        yMax: Number(yMax.toFixed(4)),
      });
      if (validatedHandle) onChangeBBox(validatedHandle);
    }
  };

  const handlePointerUp = () => {
    setDragState(null);
  };

  const resetBBox = () => {
    onChangeBBox({ xMin: 0.14, yMin: 0.08, xMax: 0.86, yMax: 0.92 });
  };

  const handles = [
    { id: 'nw', cls: 'top-0 left-0 cursor-nwse-resize' },
    { id: 'n', cls: 'top-0 left-1/2 cursor-ns-resize' },
    { id: 'ne', cls: 'top-0 left-full cursor-nesw-resize' },
    { id: 'e', cls: 'top-1/2 left-full cursor-ew-resize' },
    { id: 'se', cls: 'top-full left-full cursor-nwse-resize' },
    { id: 's', cls: 'top-full left-1/2 cursor-ns-resize' },
    { id: 'sw', cls: 'top-full left-0 cursor-nesw-resize' },
    { id: 'w', cls: 'top-1/2 left-0 cursor-ew-resize' },
  ];

  const refSpec = REFERENCE_OBJECTS[referenceType];
  const arucoUrl = generateArucoMarkerSvgDataUrl(0);

  const effectiveW = naturalDims.w || imageWidth;
  const effectiveH = naturalDims.h || imageHeight;
  const roiPxW = effectiveW ? Math.round((bbox.xMax - bbox.xMin) * effectiveW) : null;
  const roiPxH = effectiveH ? Math.round((bbox.yMax - bbox.yMin) * effectiveH) : null;
  const areaPct = Math.round((bbox.xMax - bbox.xMin) * (bbox.yMax - bbox.yMin) * 100);

  return (
    <div className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
            <Crop className="w-3.5 h-3.5" />
            <span>Khoanh vùng vật thể ({viewLabel})</span>
          </span>
          <p className="text-xs text-slate-500 mt-0.5">
            Kéo 8 điểm neo hoặc di chuyển khung xanh để ôm trọn vật thể. Tọa độ lưu chuẩn hóa [0..1] theo ảnh gốc.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Mode Toggle: Crop Box vs Reference Line */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setToolMode('bbox')}
              className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer ${
                toolMode === 'bbox' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-600'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>Khung vật thể</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (referenceType === 'none' && onChangeReferenceType) {
                  onChangeReferenceType('credit_card_85mm');
                }
                setToolMode('refline');
              }}
              className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer ${
                toolMode === 'refline' ? 'bg-amber-600 text-white shadow-2xs' : 'text-slate-600'
              }`}
              title="Kéo đường thẳng dọc theo vật tham chiếu (thẻ ATM / thước) trong ảnh"
            >
              <Ruler className="w-3.5 h-3.5" />
              <span>Kẻ vật chuẩn</span>
            </button>
          </div>

          {onAutoDetectBBox && (
            <button
              type="button"
              disabled={isAutoDetecting}
              onClick={onAutoDetectBBox}
              className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Scan className="w-3.5 h-3.5" />
              <span>{isAutoDetecting ? 'Đang tìm...' : 'Tự gợi ý khung'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
            aria-label="Thu nhỏ ảnh"
            className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
            title="Thu nhỏ"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono tabular-nums font-bold text-slate-600 min-w-[40px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
            aria-label="Phóng to ảnh"
            className="min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
            title="Phóng to"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={resetBBox}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Mặc định</span>
          </button>

          <button
            type="button"
            onClick={() => setShowArucoModal(true)}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>In ArUco 50mm</span>
          </button>
        </div>
      </div>

      {/* Inline Reference Picker when in refline mode */}
      {toolMode === 'refline' && onChangeReferenceType && (
        <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-3.5 py-2.5 text-xs">
          <span className="font-bold text-amber-900">Vật tham chiếu:</span>
          <select
            value={referenceType}
            onChange={(e) => onChangeReferenceType(e.target.value as ReferenceObjectType)}
            className="px-2.5 py-1 rounded-lg border border-amber-300 bg-white text-slate-800 font-semibold"
          >
            {Object.values(REFERENCE_OBJECTS).map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.label}
              </option>
            ))}
          </select>
          <span className="text-amber-800">Kéo giữ trên ảnh để kẻ đoạn thẳng dọc theo vật chuẩn.</span>
        </div>
      )}

      {/* Interactive Image + Overlay Canvas */}
      <div className="overflow-auto max-h-[460px] rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center p-2">
        <div
          ref={stageRef}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: zoom === 1 ? '540px' : 'none' }}
          className={`relative select-none touch-none ${
            toolMode === 'refline' ? 'cursor-crosshair' : 'cursor-default'
          }`}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Ảnh vật thể đang chọn vùng"
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setNaturalDims({ w: el.naturalWidth, h: el.naturalHeight });
              }
            }}
            className="w-full h-auto block rounded-xl pointer-events-none"
          />

          {/* Dimmed Outside Mask via SVG */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none rounded-xl"
          >
            <defs>
              <mask id="crop-hole-mask">
                <rect x="0" y="0" width="100" height="100" fill="white" />
                <rect
                  x={bbox.xMin * 100}
                  y={bbox.yMin * 100}
                  width={(bbox.xMax - bbox.xMin) * 100}
                  height={(bbox.yMax - bbox.yMin) * 100}
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              fill="rgba(15,23,42,0.52)"
              mask="url(#crop-hole-mask)"
            />
            {referenceLine && (
              <g>
                <line
                  x1={referenceLine.x1 * 100}
                  y1={referenceLine.y1 * 100}
                  x2={referenceLine.x2 * 100}
                  y2={referenceLine.y2 * 100}
                  stroke="#f59e0b"
                  strokeWidth="0.9"
                  strokeDasharray="1.5,1"
                />
                <circle cx={referenceLine.x1 * 100} cy={referenceLine.y1 * 100} r="1.2" fill="#f59e0b" />
                <circle cx={referenceLine.x2 * 100} cy={referenceLine.y2 * 100} r="1.2" fill="#f59e0b" />
              </g>
            )}
          </svg>

          {/* Interactive Draggable Bounding Box */}
          <div
            onPointerDown={handlePointerDownMove}
            style={{
              left: `${bbox.xMin * 100}%`,
              top: `${bbox.yMin * 100}%`,
              width: `${(bbox.xMax - bbox.xMin) * 100}%`,
              height: `${(bbox.yMax - bbox.yMin) * 100}%`,
            }}
            className={`absolute border-2 border-emerald-400 shadow-lg ${
              toolMode === 'bbox' ? 'cursor-move' : 'pointer-events-none opacity-75'
            }`}
          >
            {/* Rule of thirds guide inside crop */}
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-30">
              <div className="border-r border-b border-emerald-200" />
              <div className="border-r border-b border-emerald-200" />
              <div className="border-b border-emerald-200" />
              <div className="border-r border-b border-emerald-200" />
              <div className="border-r border-b border-emerald-200" />
              <div className="border-b border-emerald-200" />
              <div className="border-r border-emerald-200" />
              <div className="border-r border-emerald-200" />
              <div />
            </div>

            {toolMode === 'bbox' &&
              handles.map((h) => (
                <div
                  key={h.id}
                  onPointerDown={(e) => handlePointerDownHandle(h.id, e)}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center touch-none z-10 ${h.cls}`}
                >
                  <span className="w-4 h-4 rounded-full bg-white border-2 border-emerald-600 shadow-md pointer-events-none" />
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Info Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 px-3.5 py-2.5 rounded-2xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <Info className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Vùng chọn:{' '}
            <strong className="font-mono text-slate-800">
              {Math.round((bbox.xMax - bbox.xMin) * 100)}% × {Math.round((bbox.yMax - bbox.yMin) * 100)}%
            </strong>{' '}
            ({areaPct}% ảnh)
            {roiPxW && roiPxH ? ` • ${roiPxW}×${roiPxH} px` : ''}
          </span>
          <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded-md border border-slate-200 text-slate-500">
            [{bbox.xMin.toFixed(2)}, {bbox.yMin.toFixed(2)}, {bbox.xMax.toFixed(2)}, {bbox.yMax.toFixed(2)}]
          </span>
        </div>

        {referenceType !== 'none' && (
          <div className="flex items-center gap-2">
            {referenceLine ? (
              <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-lg font-semibold">
                <Check className="w-3.5 h-3.5" />
                <span>Đã kẻ vật chuẩn ({refSpec.knownLengthCm} cm)</span>
                <button
                  type="button"
                  onClick={() => onChangeReferenceLine(null)}
                  className="ml-1 underline text-[11px] cursor-pointer"
                >
                  Xóa
                </button>
              </span>
            ) : (
              <span className="text-slate-500">
                Mẹo: Chọn "Kẻ vật chuẩn" rồi kéo dọc cạnh {refSpec.label.split('(')[0].trim()}.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Printable ArUco Marker Modal */}
      <ModalDialog
        open={showArucoModal}
        title="Marker ArUco Chuẩn 50 × 50 mm"
        onClose={() => setShowArucoModal(false)}
        maxWidthClass="max-w-sm"
      >
        <div className="space-y-4 text-center">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex justify-center">
            <img src={arucoUrl} alt="ArUco 4x4 Marker" className="w-44 h-auto" />
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            In thẻ này ở tỷ lệ 100% (50×50 mm) và đặt cạnh vật thể khi chụp để calib kích thước tuyệt đối chính xác.
          </p>
          <a
            href={arucoUrl}
            download="aruco_50mm_marker.svg"
            className="min-h-[44px] flex items-center justify-center w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition"
          >
            Tải SVG Marker (50×50 mm)
          </a>
        </div>
      </ModalDialog>
    </div>
  );
};
