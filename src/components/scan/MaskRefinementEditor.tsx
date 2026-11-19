import React, { useEffect, useRef, useState } from 'react';
import {
  Scissors,
  Plus,
  Eraser,
  RotateCcw,
  Sparkles,
  Eye,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import type { NormalizedBoundingBox } from '../../types/reconstruction';
import {
  rebuildSegmentedAssets,
  segmentObjectFromBBox,
  type SegmentationOutput,
} from '../../vision/objectSegmentation';

interface MaskRefinementEditorProps {
  imageUrl: string;
  bbox: NormalizedBoundingBox;
  segmentation: SegmentationOutput | null;
  isManuallyRefined?: boolean;
  hasSamEndpoint?: boolean;
  onSegmentationReady: (output: SegmentationOutput, isManual?: boolean) => void;
}

function bboxMatches(a?: NormalizedBoundingBox | null, b?: NormalizedBoundingBox | null): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.xMin - b.xMin) < 0.002 &&
    Math.abs(a.yMin - b.yMin) < 0.002 &&
    Math.abs(a.xMax - b.xMax) < 0.002 &&
    Math.abs(a.yMax - b.yMax) < 0.002
  );
}

export const MaskRefinementEditor: React.FC<MaskRefinementEditorProps> = ({
  imageUrl,
  bbox,
  segmentation,
  isManuallyRefined = false,
  hasSamEndpoint = false,
  onSegmentationReady,
}) => {
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImgRef = useRef<HTMLImageElement | null>(null);
  const activeKeyRef = useRef<string>('');

  const [previewMode, setPreviewMode] = useState<'overlay' | 'cutout' | 'bbox_crop' | 'original'>('overlay');
  const [brushMode, setBrushMode] = useState<'add' | 'erase'>('add');
  const [brushRadius, setBrushRadius] = useState<number>(22);
  const [isTransparentHint, setIsTransparentHint] = useState<boolean>(false);
  const [useRemoteSam, setUseRemoteSam] = useState<boolean>(hasSamEndpoint);
  const [isSegmenting, setIsSegmenting] = useState<boolean>(false);
  const [isPainting, setIsPainting] = useState<boolean>(false);

  const bboxKey = `${imageUrl}::${bbox.xMin.toFixed(4)}_${bbox.yMin.toFixed(4)}_${bbox.xMax.toFixed(4)}_${bbox.yMax.toFixed(4)}`;

  const drawDisplayCanvas = () => {
    const canvas = displayCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    const img = sourceImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (previewMode === 'original' || !maskCanvas) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return;
    }

    if (previewMode === 'bbox_crop') {
      const sx = Math.max(0, Math.floor(bbox.xMin * img.naturalWidth));
      const sy = Math.max(0, Math.floor(bbox.yMin * img.naturalHeight));
      const sw = Math.max(16, Math.ceil((bbox.xMax - bbox.xMin) * img.naturalWidth));
      const sh = Math.max(16, Math.ceil((bbox.yMax - bbox.yMin) * img.naturalHeight));
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / sw, canvas.height / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.drawImage(img, sx, sy, sw, sh, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      return;
    }

    if (previewMode === 'cutout') {
      const tile = 16;
      for (let y = 0; y < canvas.height; y += tile) {
        for (let x = 0; x < canvas.width; x += tile) {
          ctx.fillStyle = ((x / tile + y / tile) & 1) === 0 ? '#f1f5f9' : '#e2e8f0';
          ctx.fillRect(x, y, tile, tile);
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tCtx = tmp.getContext('2d')!;
      tCtx.drawImage(img, 0, 0, tmp.width, tmp.height);
      tCtx.globalCompositeOperation = 'destination-in';
      tCtx.drawImage(maskCanvas, 0, 0, tmp.width, tmp.height);
      ctx.drawImage(tmp, 0, 0);
      return;
    }

    // Overlay mode: dim background + highlight foreground mask
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const fg = document.createElement('canvas');
    fg.width = canvas.width;
    fg.height = canvas.height;
    const fCtx = fg.getContext('2d')!;
    fCtx.drawImage(img, 0, 0, fg.width, fg.height);
    fCtx.globalCompositeOperation = 'destination-in';
    fCtx.drawImage(maskCanvas, 0, 0, fg.width, fg.height);
    ctx.drawImage(fg, 0, 0);

    const tint = document.createElement('canvas');
    tint.width = canvas.width;
    tint.height = canvas.height;
    const tintCtx = tint.getContext('2d')!;
    tintCtx.fillStyle = 'rgba(16, 185, 129, 0.22)';
    tintCtx.fillRect(0, 0, tint.width, tint.height);
    tintCtx.globalCompositeOperation = 'destination-in';
    tintCtx.drawImage(maskCanvas, 0, 0, tint.width, tint.height);
    ctx.drawImage(tint, 0, 0);
  };

  const loadImageEl = (src: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Image load error'));
      img.src = src;
    });

  const loadMaskIntoRef = async (maskUrl: string, origW: number, origH: number) => {
    const maskImg = await loadImageEl(maskUrl);
    const mCanvas = document.createElement('canvas');
    mCanvas.width = origW;
    mCanvas.height = origH;
    const mCtx = mCanvas.getContext('2d')!;
    mCtx.drawImage(maskImg, 0, 0, origW, origH);
    maskCanvasRef.current = mCanvas;
  };

  const hydrateExistingMask = async (existing: SegmentationOutput) => {
    setIsSegmenting(true);
    try {
      const img = await loadImageEl(imageUrl);
      sourceImgRef.current = img;
      const canvas = displayCanvasRef.current;
      if (canvas) {
        const aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
        canvas.width = 560;
        canvas.height = Math.max(200, Math.round(560 * aspect));
      }
      await loadMaskIntoRef(
        existing.maskDataUrl,
        existing.imageWidth || img.naturalWidth,
        existing.imageHeight || img.naturalHeight
      );
      drawDisplayCanvas();
    } catch (err) {
      console.error('Hydrate mask error:', err);
    } finally {
      setIsSegmenting(false);
    }
  };

  const runSegmentation = async (
    forceResetManual = false,
    overrides?: { transparent?: boolean; remoteSam?: boolean }
  ) => {
    setIsSegmenting(true);
    try {
      const img = await loadImageEl(imageUrl);
      sourceImgRef.current = img;

      const output = await segmentObjectFromBBox(imageUrl, bbox, {
        isTransparentObjectHint: overrides?.transparent ?? isTransparentHint,
        useRemoteSam: (overrides?.remoteSam ?? useRemoteSam) && hasSamEndpoint,
      });

      const canvas = displayCanvasRef.current;
      if (canvas) {
        const aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
        canvas.width = 560;
        canvas.height = Math.max(200, Math.round(560 * aspect));
      }

      await loadMaskIntoRef(output.maskDataUrl, output.imageWidth, output.imageHeight);
      onSegmentationReady(output, forceResetManual ? false : undefined);
      drawDisplayCanvas();
    } catch (err) {
      console.error('Segmentation error:', err);
    } finally {
      setIsSegmenting(false);
    }
  };

  // Hydrate existing mask when returning to Step 5 or switching views, WITHOUT wiping manual brush edits
  useEffect(() => {
    activeKeyRef.current = bboxKey;
    if (
      segmentation?.maskDataUrl &&
      (bboxMatches(segmentation.boundingBox, bbox) || isManuallyRefined)
    ) {
      hydrateExistingMask(segmentation);
    } else {
      runSegmentation(true);
    }
  }, [bboxKey]);

  useEffect(() => {
    drawDisplayCanvas();
  }, [previewMode]);

  const paintAtClientPos = (clientX: number, clientY: number) => {
    const canvas = displayCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const mx = nx * maskCanvas.width;
    const my = ny * maskCanvas.height;
    const scaleRatio = maskCanvas.width / canvas.width;
    const r = Math.max(6, brushRadius * scaleRatio);

    const mCtx = maskCanvas.getContext('2d');
    if (!mCtx) return;
    mCtx.save();
    mCtx.globalCompositeOperation = brushMode === 'add' ? 'source-over' : 'destination-out';
    mCtx.fillStyle = 'rgba(255,255,255,1)';
    mCtx.beginPath();
    mCtx.arc(mx, my, r, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.restore();

    drawDisplayCanvas();
  };

  const commitManualMaskEdit = async () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !segmentation) return;
    setIsSegmenting(true);
    try {
      const rebuilt = await rebuildSegmentedAssets(
        imageUrl,
        maskCanvas,
        bbox,
        segmentation.bboxCroppedUrl
      );
      onSegmentationReady(
        {
          ...segmentation,
          maskDataUrl: rebuilt.maskDataUrl,
          bboxCroppedUrl: rebuilt.bboxCroppedUrl,
          croppedObjectUrl: rebuilt.croppedObjectUrl,
          processedImageUrl: rebuilt.processedImageUrl,
          silhouetteProfile: rebuilt.silhouetteProfile,
          foregroundRatio: rebuilt.foregroundRatio,
        },
        true
      );
    } finally {
      setIsSegmenting(false);
    }
  };

  return (
    <div className="p-4 sm:p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
            <Scissors className="w-3.5 h-3.5" />
            <span>Tách vật thể khỏi nền & Tinh chỉnh Mask</span>
            {isManuallyRefined && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold normal-case">
                Đã chỉnh cọ thủ công
              </span>
            )}
          </span>
          <p className="text-xs text-slate-500 mt-0.5">
            Dùng cọ <strong>+ Giữ lại</strong> hoặc <strong>- Xóa nền</strong> nếu còn sót bóng đổ hoặc viền nền. Mọi nét chỉnh tay được bảo toàn khi chuyển bước.
          </p>
        </div>

        {/* Preview Tabs */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
          {[
            { id: 'overlay', label: 'Lớp phủ Mask' },
            { id: 'cutout', label: 'Đã tách nền' },
            { id: 'bbox_crop', label: 'Crop theo BBox' },
            { id: 'original', label: 'Ảnh gốc' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPreviewMode(tab.id as any)}
              className={`min-h-[38px] px-2.5 py-1.5 rounded-lg font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                previewMode === tab.id ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Brush Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBrushMode('add')}
            className={`min-h-[42px] px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shrink-0 ${
              brushMode === 'add'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Giữ lại vật thể (+)</span>
          </button>

          <button
            type="button"
            onClick={() => setBrushMode('erase')}
            className={`min-h-[42px] px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap shrink-0 ${
              brushMode === 'erase'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-white text-slate-700 border border-slate-200'
            }`}
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>Xóa nền thừa (-)</span>
          </button>

          <label className="flex items-center gap-2 ml-1 text-slate-600 font-semibold min-h-[40px]">
            <span>Cỡ cọ:</span>
            <input
              type="range"
              min={8}
              max={48}
              value={brushRadius}
              onChange={(e) => setBrushRadius(parseInt(e.target.value, 10))}
              className="w-24 accent-emerald-600 cursor-pointer"
            />
            <span className="font-mono tabular-nums text-[11px]">{brushRadius}px</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="min-h-[40px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isTransparentHint}
              onChange={(e) => {
                const checked = e.target.checked;
                setIsTransparentHint(checked);
                runSegmentation(true, { transparent: checked });
              }}
              className="accent-emerald-600"
            />
            <span className="font-semibold">Vật trong suốt (PET/Thủy tinh)</span>
          </label>

          {hasSamEndpoint && (
            <label className="min-h-[40px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 cursor-pointer">
              <input
                type="checkbox"
                checked={useRemoteSam}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setUseRemoteSam(checked);
                  runSegmentation(true, { remoteSam: checked });
                }}
                className="accent-indigo-600"
              />
              <span className="font-semibold">Dùng SAM API</span>
            </label>
          )}

          <button
            type="button"
            onClick={() => runSegmentation(true)}
            disabled={isSegmenting}
            className="min-h-[42px] px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Tách lại tự động</span>
          </button>
        </div>
      </div>

      {/* Canvas Editor + Live Processed Cutout Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center">
          <canvas
            ref={displayCanvasRef}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              setIsPainting(true);
              paintAtClientPos(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => {
              if (!isPainting) return;
              paintAtClientPos(e.clientX, e.clientY);
            }}
            onPointerUp={() => {
              if (isPainting) {
                setIsPainting(false);
                commitManualMaskEdit();
              }
            }}
            onPointerCancel={() => setIsPainting(false)}
            className="max-w-full max-h-[420px] w-auto h-auto touch-none cursor-crosshair"
          />

          {isSegmenting && (
            <div className="absolute inset-0 bg-slate-950/60 text-white flex items-center justify-center gap-2 text-xs font-bold pointer-events-none">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Đang tách nền & trích xuất đường bao...</span>
            </div>
          )}
        </div>

        {/* Processed Preview & Separated Layer Cards */}
        <div className="lg:col-span-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
          <div className="font-bold text-slate-800 flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-emerald-600" />
            <span>Kết quả tách lớp gửi AI</span>
          </div>

          {segmentation ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 block">Crop theo BBox</span>
                  <div className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-white flex items-center justify-center p-1">
                    <img
                      src={segmentation.bboxCroppedUrl}
                      alt="Ảnh crop theo BBox"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-emerald-700 block">Đã tách nền sạch</span>
                  <div className="aspect-square rounded-xl overflow-hidden border border-emerald-200 bg-white flex items-center justify-center p-1">
                    <img
                      src={segmentation.processedImageUrl}
                      alt="Ảnh đã tách nền sạch"
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-600 bg-white p-3 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <span>Bộ máy tách nền:</span>
                  <strong className="text-slate-800">{segmentation.engineUsed}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Tỷ lệ phủ vật thể:</span>
                  <strong className="text-slate-900">
                    {Math.round(segmentation.foregroundRatio * 100)}%
                  </strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Điểm biên dạng (Profile):</span>
                  <strong className="text-emerald-700">
                    {segmentation.silhouetteProfile.length} lát cắt
                  </strong>
                </div>
                <div className="flex items-center gap-1 text-emerald-700 font-semibold pt-1 border-t border-slate-100">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Đã lưu tách biệt ảnh gốc, BBox & Mask</span>
                </div>
              </div>
            </>
          ) : (
            <div className="aspect-square rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-slate-400">
              <Sparkles className="w-5 h-5 mr-1.5" />
              <span>Đang xử lý...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
