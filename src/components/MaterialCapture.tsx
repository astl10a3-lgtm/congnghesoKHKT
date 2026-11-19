import React, { lazy, Suspense, useRef, useState, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  Trash2,
  Plus,
  RefreshCw,
  Ruler,
  AlertCircle,
  Sparkles,
  CheckCircle,
  Image as ImageIcon,
  SwitchCamera,
  Grid,
  X,
  Check,
  RotateCw,
  Maximize2,
  Minimize2,
  FileText,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Box,
  Bookmark,
  Focus,
  AlertTriangle,
  SlidersHorizontal,
  Scissors,
  Crop,
  Layers,
} from 'lucide-react';
import type { AnalysisInput } from '../../server/gemini';
import type { MaterialItem } from '../../server/db';
import {
  type CapturedViewEntry,
  type ContourPoint,
  type MeasurementMethod,
  type NormalizedBoundingBox,
  type ProfilePoint,
  type ReferenceObjectType,
  type ViewAngleId,
  validateNormalizedBBox,
} from '../types/reconstruction';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  assessImageQuality,
  sampleLiveVideoQuality,
  type ImageQualityReport,
  type QualityThresholdsConfig,
} from '../vision/imageQuality';
import {
  cropImageByBoundingBox,
  optimizeImageForUpload,
  segmentViewEntry,
  type SegmentationOutput,
} from '../vision/objectSegmentation';
import { suggestInitialBoundingBox } from '../vision/autoBBoxDetector';
import {
  REFERENCE_OBJECTS,
  computeCalibratedDimensions,
} from '../vision/referenceCalibration';
import {
  VIEW_ANGLE_META,
  checkMultiViewConsistency,
  getGuidanceForCategory,
  type MultiViewConsistencyReport,
} from '../vision/multiViewConsistency';
import { ObjectCropSelector, type ReferenceLinePx } from './scan/ObjectCropSelector';
import { MaskRefinementEditor } from './scan/MaskRefinementEditor';
import { ReconstructionResultPanel } from './scan/ReconstructionResultPanel';
const MaterialScanner3D = lazy(() =>
  import('../three/MaterialScanner3D').then((m) => ({ default: m.MaterialScanner3D }))
);
import { useWorkflow, type WizardStepId } from '../context/WorkflowContext';
import { validateClientImageFile } from '../lib/apiClient';
import { ErrorBanner } from './ui/StatusFeedback';

export type { WizardStepId };

const WIZARD_STEPS: { id: WizardStepId; shortLabel: string; title: string }[] = [
  { id: 1, shortLabel: '1. Chụp / Tải', title: 'Hướng dẫn, Camera & Tải ảnh vật thể' },
  { id: 2, shortLabel: '2. Xem trước', title: 'Xem trước ảnh chụp & Gán nhãn góc' },
  { id: 3, shortLabel: '3. Khoanh vùng', title: 'Khoanh vùng vật thể (Bounding Box)' },
  { id: 4, shortLabel: '4. Chất lượng', title: 'Kiểm tra chất lượng ảnh & vùng chọn' },
  { id: 5, shortLabel: '5. Tách nền', title: 'Tách vật thể khỏi nền & Chỉnh sửa Mask' },
  { id: 6, shortLabel: '6. Đa góc & cm', title: 'Đồng bộ đa góc & Hiệu chuẩn kích thước' },
  { id: 7, shortLabel: '7. Xác nhận & AI', title: 'Xác nhận dữ liệu vùng chọn & Phân tích AI' },
  { id: 8, shortLabel: '8. Dựng 3D', title: 'Mô hình 3D & Đối chiếu' },
  { id: 9, shortLabel: '9. Lưu kho', title: 'Tổng hợp kết quả & Lưu kho cá nhân' },
];

const DEFAULT_BBOX: NormalizedBoundingBox = {
  xMin: 0.14,
  yMin: 0.08,
  xMax: 0.86,
  yMax: 0.92,
};

const CAPTURE_GUIDELINES = [
  {
    num: '1',
    title: 'Đặt vật thể ở nơi trống trải',
    desc: 'Tránh để bàn làm việc bừa bộn hay nhiều đồ vật khác sát cạnh vật liệu cần quét.',
  },
  {
    num: '2',
    title: 'Sử dụng phông nền đơn giản',
    desc: 'Ưu tiên mặt bàn trơn, tường phẳng hoặc tờ giấy/vải đơn sắc có màu tương phản với vật.',
  },
  {
    num: '3',
    title: 'Đảm bảo đủ ánh sáng',
    desc: 'Chụp ở nơi sáng đều, tránh thiếu sáng hoặc rọi đèn trực diện gây lóa trên nhựa/kim loại.',
  },
  {
    num: '4',
    title: 'Đặt toàn bộ vật thể trong khung hình',
    desc: 'Giữ khoảng trống nhỏ ở cả 4 mép khung ảnh để không cắt mất đáy, nắp hoặc góc hộp.',
  },
  {
    num: '5',
    title: 'Tránh vật thể khác che khuất',
    desc: 'Không dùng tay cầm che thân vật liệu hoặc để bóng tối/vật cản đè lên biên dạng vật.',
  },
];

interface MaterialCaptureProps {
  onStartAnalysis: (input: AnalysisInput) => Promise<boolean | void> | void;
  onLocalGeometryReconstruction: (payload: {
    materialName: string;
    category: MaterialItem['category'];
    heightCm: number;
    widthCm: number;
    depthCm: number;
    silhouetteProfile: ProfilePoint[];
    contourPoints?: ContourPoint[];
    measurementMethod: MeasurementMethod;
    confidence: number;
    maskUrl?: string | null;
    croppedObjectUrl?: string;
    processedImageUrl?: string;
    boundingBox?: NormalizedBoundingBox;
    imageQualityScore?: number;
    multiViewConsistency?: number | null;
    images: string[];
    userNotes: string;
  }) => Promise<MaterialItem | null>;
  onSaveMaterialToInventory?: (mat: MaterialItem) => Promise<void> | void;
  onGlbAttached?: (glbUrl: string, provider: string) => void;
  isAnalyzing: boolean;
  hasGeminiKey: boolean;
  hasSamEndpoint?: boolean;
  confirmedMaterial?: MaterialItem | null;
  analysisError?: string | null;
}

export const MaterialCapture: React.FC<MaterialCaptureProps> = ({
  onStartAnalysis,
  onLocalGeometryReconstruction,
  onSaveMaterialToInventory,
  onGlbAttached,
  isAnalyzing,
  hasGeminiKey,
  hasSamEndpoint = false,
  confirmedMaterial,
  analysisError,
}) => {
  const {
    wizardStep,
    setWizardStep,
    categoryHint,
    setCategoryHint,
    views,
    setViews,
    activeViewIdx,
    setActiveViewIdx,
    referenceType,
    setReferenceType,
    referenceDescription,
    setReferenceDescription,
    referenceLine,
    setReferenceLine,
    qualityReportsByView,
    setQualityReportsByView,
    qualityThresholds,
    setQualityThresholds,
    manualHeightCm,
    setManualHeightCm,
    manualWidthCm,
    setManualWidthCm,
    manualDepthCm,
    setManualDepthCm,
    calibratedConf,
    setCalibratedConf,
    measurementMethod,
    setMeasurementMethod,
    focusOnSelection,
    setFocusOnSelection,
    userConfirmedSubmission,
    setUserConfirmedSubmission,
    userNotes,
    setUserNotes,
    aiEngine,
    setAiEngine,
    isSavedToInventory,
    setIsSavedToInventory,
  } = useWorkflow();

  const [isAutoDetectingBBox, setIsAutoDetectingBBox] = useState(false);
  const [isBatchSegmenting, setIsBatchSegmenting] = useState(false);
  const [showThresholdTuner, setShowThresholdTuner] = useState(false);
  const [isAssessingQuality, setIsAssessingQuality] = useState(false);
  const [multiViewReport, setMultiViewReport] = useState<MultiViewConsistencyReport | null>(null);
  const [isPreparingPayload, setIsPreparingPayload] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Camera stream state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);
  const [isVideoLive, setIsVideoLive] = useState<boolean>(false);
  const [isFullscreenCamera, setIsFullscreenCamera] = useState<boolean>(false);
  const [focusSupported, setFocusSupported] = useState<boolean>(false);
  const [liveHud, setLiveHud] = useState<{
    sharpnessScore: number;
    brightness: number;
    statusLabel: string;
  } | null>(null);
  const [activeAngleTarget, setActiveAngleTarget] = useState<ViewAngleId>('front');

  // Orientation tracking
  const [deviceOrientation, setDeviceOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [forcedOrientation, setForcedOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingNotesRef = useRef<boolean>(false);

  const primaryView = views[activeViewIdx] || views[0] || null;
  const activeBBox = primaryView?.boundingBox || DEFAULT_BBOX;
  const activeQualityReport = primaryView
    ? qualityReportsByView[primaryView.id] || null
    : null;
  const hasAnyRejectedView = views.some(
    (v) => (qualityReportsByView[v.id]?.status || v.quality?.status) === 'REJECTED'
  );
  const allViewsHaveQualityPassed =
    views.length > 0 &&
    views.every((v) => {
      const st = qualityReportsByView[v.id]?.status || v.quality?.status;
      return st === 'GOOD' || st === 'WARNING';
    });

  // Construct SegmentationOutput from active view for MaskRefinementEditor hydration
  const activeSegmentation: SegmentationOutput | null =
    primaryView && primaryView.maskDataUrl && primaryView.processedImageUrl && primaryView.croppedObjectUrl
      ? {
          maskDataUrl: primaryView.maskDataUrl,
          bboxCroppedUrl: primaryView.bboxCroppedUrl || primaryView.processedImageUrl,
          croppedObjectUrl: primaryView.croppedObjectUrl,
          processedImageUrl: primaryView.processedImageUrl,
          boundingBox: primaryView.boundingBox || activeBBox,
          foregroundRatio: 0.6,
          silhouetteProfile: primaryView.silhouetteProfile || [],
          contourPoints: primaryView.contourPoints || [],
          imageWidth: primaryView.imageWidth,
          imageHeight: primaryView.imageHeight,
          engineUsed: primaryView.segmentationEngine || 'client_grabcut_v1',
        }
      : null;

  const effectiveOrientation = forcedOrientation === 'auto' ? deviceOrientation : forcedOrientation;

  const autoGrowNotesTextarea = (el?: HTMLTextAreaElement | null) => {
    const target = el || notesTextareaRef.current;
    if (!target) return;
    target.style.height = 'auto';
    target.style.height = `${Math.max(120, target.scrollHeight)}px`;
  };

  const setUserNotesProgrammatic = (nextValue: string) => {
    setUserNotes(nextValue);
    if (notesTextareaRef.current) {
      notesTextareaRef.current.value = nextValue;
      autoGrowNotesTextarea(notesTextareaRef.current);
    }
  };

  useEffect(() => {
    if (wizardStep === 7 && notesTextareaRef.current) {
      notesTextareaRef.current.value = userNotes;
      autoGrowNotesTextarea(notesTextareaRef.current);
    }
  }, [wizardStep]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(orientation: landscape)');
    const checkOrientation = () => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'TEXTAREA' || activeTag === 'INPUT') return;
      setDeviceOrientation(mediaQuery.matches ? 'landscape' : 'portrait');
    };
    checkOrientation();
    mediaQuery.addEventListener?.('change', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      mediaQuery.removeEventListener?.('change', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  useEffect(() => {
    if (!isCameraActive) {
      setLiveHud(null);
      return;
    }
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (v && streamRef.current) {
        if (v.paused) v.play().catch(() => {});
        if (v.readyState >= 2 && v.videoWidth > 0) {
          setLiveHud(sampleLiveVideoQuality(v));
        }
      }
    }, 900);
    return () => clearInterval(interval);
  }, [isCameraActive]);

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) return;
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    el.setAttribute('muted', '');
    el.setAttribute('autoplay', '');

    if (streamRef.current) {
      if (el.srcObject !== streamRef.current) {
        el.srcObject = streamRef.current;
      }
      el.play()
        .then(() => setIsVideoLive(true))
        .catch((err) => console.warn('Video play error:', err));
    }

    el.onpause = () => {
      if (streamRef.current) {
        el.play().catch(() => {});
      }
    };
  }, []);

  const startCamera = async (fullscreen = false) => {
    setCameraError(null);
    setIsCameraActive(true);
    if (fullscreen) setIsFullscreenCamera(true);

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: cameraFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: cameraFacing },
          audio: false,
        });
      }

      streamRef.current = stream;

      try {
        const track = stream.getVideoTracks()[0];
        const caps = (track as any)?.getCapabilities?.();
        setFocusSupported(Boolean(caps?.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.length > 0));
      } catch {
        setFocusSupported(false);
      }

      if (videoRef.current) {
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        videoRef.current.autoplay = true;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        videoRef.current.srcObject = stream;
        videoRef.current
          .play()
          .then(() => setIsVideoLive(true))
          .catch((err) => console.warn('Video play error:', err));
      }
    } catch {
      setCameraError(
        'Không thể mở camera. Vui lòng cấp quyền truy cập camera trong trình duyệt hoặc sử dụng nút "Chọn ảnh từ máy".'
      );
      setIsCameraActive(false);
      setIsVideoLive(false);
      setIsFullscreenCamera(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setIsVideoLive(false);
    setIsFullscreenCamera(false);
  };

  const triggerManualFocus = async () => {
    try {
      const track = streamRef.current?.getVideoTracks()?.[0];
      if (track && typeof (track as any).applyConstraints === 'function') {
        await (track as any).applyConstraints({
          advanced: [{ focusMode: 'continuous' }],
        });
      }
    } catch {
      // Ignore unsupported focus constraint
    }
  };

  const toggleCameraFacing = () => {
    setCameraFacing((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  useEffect(() => {
    if (isCameraActive) startCamera(isFullscreenCamera);
  }, [cameraFacing]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const appendImageAsView = async (rawDataUrl: string, angle: ViewAngleId) => {
    let finalUrl = rawDataUrl;
    let width = 1000;
    let height = 1000;
    try {
      const opt = await optimizeImageForUpload(rawDataUrl, 1440, 0.88);
      finalUrl = opt.dataUrl;
      width = opt.width;
      height = opt.height;
    } catch {
      // Keep raw URL fallback if canvas re-encode fails
    }

    // Automatically estimate an initial normalized bounding box from pixels
    let initialBBox: NormalizedBoundingBox = { ...DEFAULT_BBOX };
    let bboxCroppedUrl: string | null = null;
    try {
      const detected = await suggestInitialBoundingBox(finalUrl);
      initialBBox = detected.bbox;
      const crop = await cropImageByBoundingBox(finalUrl, initialBBox, 1024);
      bboxCroppedUrl = crop.bboxCroppedUrl;
    } catch {
      // Fall back to default centered box
    }

    const nextEntry: CapturedViewEntry = {
      id: `view_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      angle,
      originalImage: finalUrl,
      imageWidth: width,
      imageHeight: height,
      boundingBox: initialBBox,
      bboxCroppedUrl,
      isManuallyRefined: false,
    };

    setViews((prev) => {
      const updated = [...prev, nextEntry];
      setActiveViewIdx(updated.length - 1);
      return updated;
    });
    setUserConfirmedSubmission(false);
    setIsSavedToInventory(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 160);

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch {
        // Ignore
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    await appendImageAsView(dataUrl, activeAngleTarget);

    const order: ViewAngleId[] = ['front', 'three_quarter', 'side', 'top', 'back', 'bottom'];
    const idx = order.indexOf(activeAngleTarget);
    if (idx >= 0 && idx < order.length - 1) {
      setActiveAngleTarget(order[idx + 1]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    const order: ViewAngleId[] = ['front', 'three_quarter', 'side', 'top', 'back', 'bottom'];
    const baseLen = views.length;

    const fileList = Array.from(files);
    e.target.value = '';

    for (let offset = 0; offset < fileList.length; offset++) {
      const file = fileList[offset];
      const check = await validateClientImageFile(file);
      if (!check.ok) {
        setUploadError(check.error);
        continue;
      }

      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = async (event) => {
          if (event.target?.result) {
            const angle = order[(baseLen + offset) % order.length];
            await appendImageAsView(event.target.result as string, angle);
          }
          resolve();
        };
        reader.onerror = () => {
          setUploadError(`Không thể đọc tệp ảnh "${file.name}".`);
          resolve();
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeView = (idx: number) => {
    setViews((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setActiveViewIdx((curr) => Math.max(0, Math.min(curr, next.length - 1)));
      return next;
    });
    setUserConfirmedSubmission(false);
  };

  const updateViewBBox = (nextBBox: NormalizedBoundingBox) => {
    const safe = validateNormalizedBBox(nextBBox) || { ...DEFAULT_BBOX };
    const targetId = views[activeViewIdx]?.id;
    setViews((prev) =>
      prev.map((v, i) =>
        i === activeViewIdx
          ? {
              ...v,
              boundingBox: safe,
              // Invalidate cached mask & quality for this view since bbox changed
              bboxCroppedUrl: null,
              maskDataUrl: null,
              croppedObjectUrl: null,
              processedImageUrl: null,
              isManuallyRefined: false,
              quality: undefined,
            }
          : v
      )
    );
    if (targetId) {
      setQualityReportsByView((prev) => {
        const copy = { ...prev };
        delete copy[targetId];
        return copy;
      });
    }
    setUserConfirmedSubmission(false);
  };

  const handleAutoDetectActiveBBox = async () => {
    if (!primaryView) return;
    setIsAutoDetectingBBox(true);
    try {
      const detected = await suggestInitialBoundingBox(primaryView.originalImage);
      updateViewBBox(detected.bbox);
    } finally {
      setIsAutoDetectingBBox(false);
    }
  };

  const updateViewAngle = (idx: number, angle: ViewAngleId) => {
    setViews((prev) => prev.map((v, i) => (i === idx ? { ...v, angle } : v)));
  };

  // Load verified local sample assets (explicit user action only; never error fallback)
  const loadBottleSample = () => {
    const sampleViews: CapturedViewEntry[] = [
      {
        id: 'sample_pet_front',
        angle: 'front',
        originalImage: '/assets/aistudio/image_9cb5bb6a.png',
        imageWidth: 800,
        imageHeight: 800,
        boundingBox: { xMin: 0.16, yMin: 0.08, xMax: 0.84, yMax: 0.92 },
      },
      {
        id: 'sample_pet_34',
        angle: 'three_quarter',
        originalImage: '/assets/aistudio/image_68495993.png',
        imageWidth: 800,
        imageHeight: 800,
        boundingBox: { xMin: 0.14, yMin: 0.1, xMax: 0.86, yMax: 0.9 },
      },
    ];
    setViews(sampleViews);
    setQualityReportsByView({});
    setActiveViewIdx(0);
    setCategoryHint('plastic');
    setUserNotesProgrammatic('Chai nhựa PET 500ml màu xanh trong còn nắp vặn');
    setReferenceType('credit_card_85mm');
    setManualHeightCm(21);
    setManualWidthCm(6.8);
    setManualDepthCm(6.8);
    setUserConfirmedSubmission(false);
    setIsSavedToInventory(false);
    setWizardStep(2);
  };

  const loadCardboardSample = () => {
    const sampleViews: CapturedViewEntry[] = [
      {
        id: 'sample_box_front',
        angle: 'front',
        originalImage: '/assets/aistudio/image_d0029fe5.png',
        imageWidth: 800,
        imageHeight: 800,
        boundingBox: { xMin: 0.12, yMin: 0.12, xMax: 0.88, yMax: 0.88 },
      },
    ];
    setViews(sampleViews);
    setQualityReportsByView({});
    setActiveViewIdx(0);
    setCategoryHint('paper');
    setUserNotesProgrammatic('Hộp bìa carton 3 lớp sạch sẽ 28x20x14cm');
    setReferenceType('ruler_30cm');
    setManualHeightCm(14);
    setManualWidthCm(28);
    setManualDepthCm(20);
    setUserConfirmedSubmission(false);
    setIsSavedToInventory(false);
    setWizardStep(2);
  };

  // Run Step 4 Quality Assessment across ALL views & persist metrics on each view
  const runAllViewsQualityCheck = useCallback(
    async (customThresholds: QualityThresholdsConfig = qualityThresholds) => {
      if (views.length === 0) return;
      setIsAssessingQuality(true);
      try {
        const results = await Promise.all(
          views.map(async (v) => {
            const rep = await assessImageQuality({
              imageUrl: v.originalImage,
              boundingBox: v.boundingBox || DEFAULT_BBOX,
              maskDataUrl: v.maskDataUrl,
              thresholds: customThresholds,
            });
            return { id: v.id, rep };
          })
        );

        const nextMap: Record<string, ImageQualityReport> = {};
        for (const item of results) {
          nextMap[item.id] = item.rep;
        }
        setQualityReportsByView(nextMap);

        setViews((prev) =>
          prev.map((v) => {
            const rep = nextMap[v.id];
            if (!rep) return v;
            return {
              ...v,
              quality: {
                status: rep.status,
                overallScore: rep.overallScore,
                blurScore: rep.metrics.blurScore,
                rawLaplacianVar: rep.metrics.rawLaplacianVar,
                brightness: rep.metrics.brightness,
                contrast: rep.metrics.contrast,
                glareRatio: rep.metrics.glareRatio,
                edgeClippingScore: rep.metrics.edgeClippingScore,
                bboxAreaRatio: rep.metrics.bboxAreaRatio,
                reasons: rep.reasons,
                recommendations: rep.recommendations,
              },
            };
          })
        );
      } catch (err) {
        console.error('Quality check error:', err);
      } finally {
        setIsAssessingQuality(false);
      }
    },
    [views, qualityThresholds]
  );

  useEffect(() => {
    if (wizardStep === 4 && views.length > 0) {
      runAllViewsQualityCheck(qualityThresholds);
    }
  }, [wizardStep, activeViewIdx]);

  // Step 5: batch segment remaining views without overwriting refined ones
  const handleBatchSegmentAllViews = async () => {
    setIsBatchSegmenting(true);
    try {
      const updated = await Promise.all(
        views.map(async (v) => {
          if (v.maskDataUrl && v.bboxCroppedUrl && v.processedImageUrl) return v;
          const out = await segmentViewEntry(v, {
            isTransparentObjectHint: categoryHint === 'plastic',
            useRemoteSam: hasSamEndpoint,
          });
          return {
            ...v,
            bboxCroppedUrl: out.bboxCroppedUrl,
            maskDataUrl: out.maskDataUrl,
            croppedObjectUrl: out.croppedObjectUrl,
            processedImageUrl: out.processedImageUrl,
            silhouetteProfile: out.silhouetteProfile,
            contourPoints: out.contourPoints,
            segmentationEngine: out.engineUsed,
          };
        })
      );
      setViews(updated);
    } finally {
      setIsBatchSegmenting(false);
    }
  };

  // Sync segmentation output onto active view (optionally marking manual brush edit)
  const handleSegmentationReady = (output: SegmentationOutput, isManual?: boolean) => {
    setViews((prev) =>
      prev.map((v, i) =>
        i === activeViewIdx
          ? {
              ...v,
              bboxCroppedUrl: output.bboxCroppedUrl,
              maskDataUrl: output.maskDataUrl,
              croppedObjectUrl: output.croppedObjectUrl,
              processedImageUrl: output.processedImageUrl,
              silhouetteProfile: output.silhouetteProfile,
              contourPoints: output.contourPoints,
              segmentationEngine: output.engineUsed,
              isManuallyRefined: isManual === undefined ? v.isManuallyRefined : isManual,
            }
          : v
      )
    );
    setUserConfirmedSubmission(false);
  };

  // Compute multi-view consistency & calibrated dimensions when entering Step 6
  useEffect(() => {
    if (wizardStep !== 6 || views.length === 0) return;
    let active = true;
    checkMultiViewConsistency(views, categoryHint)
      .then((rep) => {
        if (active) setMultiViewReport(rep);
      })
      .catch(() => {});

    if (primaryView) {
      const sideView = views.find((v) => v.angle === 'side' || v.angle === 'three_quarter');
      const cal = computeCalibratedDimensions({
        imageWidth: primaryView.imageWidth || 1000,
        imageHeight: primaryView.imageHeight || 1000,
        objectBBox: activeBBox,
        referenceType,
        referenceLinePx: referenceLine,
        sideViewBBox: sideView?.boundingBox || null,
      });

      if (cal.heightCm && cal.widthCm) {
        setManualHeightCm(cal.heightCm);
        setManualWidthCm(cal.widthCm);
        setManualDepthCm(cal.depthCm || cal.widthCm);
        setMeasurementMethod(cal.method);
        setCalibratedConf(cal.perMetric.height.confidence);
      } else {
        setMeasurementMethod('user_input');
        setCalibratedConf(0.65);
      }
    }

    return () => {
      active = false;
    };
  }, [
    wizardStep,
    views.length,
    categoryHint,
    referenceType,
    referenceLine,
    primaryView?.id,
    activeBBox.xMin,
    activeBBox.yMin,
    activeBBox.xMax,
    activeBBox.yMax,
  ]);

  // Step 7 -> Ensure every view has at least bboxCroppedUrl before sending focused payload
  const prepareSegmentedViewsForPayload = async (): Promise<CapturedViewEntry[]> => {
    const prepared = await Promise.all(
      views.map(async (v) => {
        const bbox = v.boundingBox || DEFAULT_BBOX;
        if (v.processedImageUrl && v.bboxCroppedUrl) return v;
        if (!v.bboxCroppedUrl) {
          try {
            const crop = await cropImageByBoundingBox(v.originalImage, bbox, 1024);
            return { ...v, boundingBox: bbox, bboxCroppedUrl: crop.bboxCroppedUrl };
          } catch {
            return v;
          }
        }
        return v;
      })
    );
    setViews(prepared);
    return prepared;
  };

  // Run Step 7 AI Analysis (only after explicit confirmation checkbox)
  const handleSubmitAI = async () => {
    if (views.length === 0 || !userConfirmedSubmission) return;
    setIsPreparingPayload(true);
    try {
      const preparedViews = await prepareSegmentedViewsForPayload();
      const primary = preparedViews[activeViewIdx] || preparedViews[0];
      const rawNotes = notesTextareaRef.current ? notesTextareaRef.current.value : userNotes;
      const effectiveNotes =
        rawNotes.trim().length > 0
          ? rawNotes
          : 'Vật liệu rác thải sinh hoạt đã được khoanh vùng & tách nền, cần phân tích cấu tạo và đề xuất 3 sản phẩm tái chế có mô hình 3D tương tác.';

      // When focusOnSelection is enabled, NEVER transmit raw full-scene uncropped images as primary image inputs
      const imagesToSend = preparedViews.map((v) =>
        focusOnSelection
          ? v.processedImageUrl || v.bboxCroppedUrl || v.croppedObjectUrl || v.originalImage
          : v.processedImageUrl || v.originalImage
      );

      const primaryQuality = primary ? qualityReportsByView[primary.id] || null : null;

      const ok = await onStartAnalysis({
        images: imagesToSend,
        angles: preparedViews.map((v) => v.angle),
        referenceObject: {
          type: referenceType,
          description: referenceDescription,
        },
        userNotes: effectiveNotes,
        aiEngine,
        focusOnSelection,
        boundingBox: primary?.boundingBox || activeBBox,
        bboxCroppedImageUrl: primary?.bboxCroppedUrl || null,
        segmentedImageUrl: primary?.processedImageUrl || null,
        maskUrl: primary?.maskDataUrl || null,
        croppedObjectUrl: primary?.croppedObjectUrl || null,
        silhouetteProfile: primary?.silhouetteProfile || [],
        contourPoints: primary?.contourPoints || [],
        calibratedDimensions: {
          heightCm: manualHeightCm,
          widthCm: manualWidthCm,
          depthCm: manualDepthCm,
          measurementMethod,
          confidence: calibratedConf,
        },
        qualityReport: primaryQuality
          ? {
              status: primaryQuality.status,
              overallScore: primaryQuality.overallScore,
              blurScore: primaryQuality.metrics.blurScore,
              brightness: primaryQuality.metrics.brightness,
              contrast: primaryQuality.metrics.contrast,
              bboxAreaRatio: primaryQuality.metrics.bboxAreaRatio,
              reasons: primaryQuality.reasons,
            }
          : null,
        viewsMetadata: preparedViews.map((v) => ({
          angle: v.angle,
          boundingBox: v.boundingBox || null,
          bboxCroppedUrl: v.bboxCroppedUrl || null,
          processedImageUrl: v.processedImageUrl || null,
          maskUrl: v.maskDataUrl || null,
        })),
        imageQualityScore: primaryQuality?.metrics.blurScore,
        multiViewConsistency: multiViewReport?.consistencyScore ?? null,
      });

      if (ok !== false) {
        setWizardStep(8);
      }
    } finally {
      setIsPreparingPayload(false);
    }
  };

  const handleRunLocal3DOnly = async () => {
    if (views.length === 0 || !userConfirmedSubmission) return;
    setIsPreparingPayload(true);
    try {
      const preparedViews = await prepareSegmentedViewsForPayload();
      const primary = preparedViews[activeViewIdx] || preparedViews[0];
      const rawNotes = notesTextareaRef.current ? notesTextareaRef.current.value : userNotes;
      const primaryQuality = primary ? qualityReportsByView[primary.id] || null : null;

      const mat = await onLocalGeometryReconstruction({
        materialName:
          rawNotes.trim().slice(0, 60) ||
          (categoryHint === 'paper'
            ? 'Hộp bìa carton tái chế'
            : categoryHint === 'metal'
            ? 'Lon nhôm tái chế'
            : categoryHint === 'fabric'
            ? 'Vải / Quần jean tái chế'
            : 'Chai nhựa tái chế'),
        category: categoryHint,
        heightCm: manualHeightCm,
        widthCm: manualWidthCm,
        depthCm: manualDepthCm,
        silhouetteProfile: primary?.silhouetteProfile || [],
        contourPoints: primary?.contourPoints || [],
        measurementMethod,
        confidence: calibratedConf,
        maskUrl: primary?.maskDataUrl || null,
        croppedObjectUrl: primary?.croppedObjectUrl || undefined,
        processedImageUrl: primary?.processedImageUrl || primary?.bboxCroppedUrl || undefined,
        boundingBox: primary?.boundingBox || activeBBox,
        imageQualityScore: primaryQuality?.metrics.blurScore,
        multiViewConsistency: multiViewReport?.consistencyScore ?? null,
        images: preparedViews.map((v) =>
          focusOnSelection ? v.processedImageUrl || v.bboxCroppedUrl || v.originalImage : v.originalImage
        ),
        userNotes: rawNotes,
      });
      if (mat) setWizardStep(8);
    } finally {
      setIsPreparingPayload(false);
    }
  };

  const canEnterStep = (stepId: WizardStepId) => {
    if (stepId <= 1) return true;
    if (views.length === 0) return false;
    // Enforce Quality Gate: cannot jump to Step 5+ if any view failed quality check as REJECTED
    if (stepId >= 5 && hasAnyRejectedView) return false;
    return true;
  };

  const isNextStepDisabled = () => {
    if (views.length === 0) return true;
    if (wizardStep === 4 && (isAssessingQuality || hasAnyRejectedView)) return true;
    return false;
  };

  const recommendedAngles = getGuidanceForCategory(categoryHint);

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
      {/* Compact Wizard Stepper Bar */}
      <div className="p-3 sm:p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Quy trình CV
            </span>
            <h2 className="text-sm sm:text-base font-extrabold text-slate-900">
              {WIZARD_STEPS.find((s) => s.id === wizardStep)?.title}
            </h2>
          </div>
          <span className="text-xs font-bold text-slate-500 tabular-nums">Bước {wizardStep} / 9</span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {WIZARD_STEPS.map((st) => {
            const isCurrent = st.id === wizardStep;
            const isPast = st.id < wizardStep;
            const allowed = canEnterStep(st.id);
            return (
              <button
                key={st.id}
                type="button"
                disabled={!allowed}
                onClick={() => allowed && setWizardStep(st.id)}
                className={`min-h-[40px] shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition border cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                  isCurrent
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : isPast
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {st.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* ======================================================= */}
      {/* STEP 1: GUIDELINES + OPEN CAMERA / UPLOAD */}
      {/* ======================================================= */}
      {wizardStep === 1 && (
        <div className="space-y-4">
          {/* 5 Mandatory Photography Guidelines */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                  HƯỚNG DẪN CHỤP ẢNH ĐẠT CHUẨN COMPUTER VISION
                </span>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-0.5">
                  5 nguyên tắc giúp khoanh vùng & tách nền chính xác ngay lần đầu
                </h3>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                {[
                  { id: 'plastic', label: 'Nhựa' },
                  { id: 'paper', label: 'Giấy/Carton' },
                  { id: 'metal', label: 'Kim loại' },
                  { id: 'fabric', label: 'Vải' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryHint(cat.id as any)}
                    className={`px-2.5 py-1 rounded-lg font-bold border cursor-pointer ${
                      categoryHint === cat.id
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
              {CAPTURE_GUIDELINES.map((g) => (
                <div
                  key={g.num}
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1"
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white text-[10px] font-black">
                    {g.num}
                  </span>
                  <p className="font-bold text-slate-900 leading-snug">{g.title}</p>
                  <p className="text-[11px] text-slate-600 leading-relaxed">{g.desc}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 bg-emerald-50/60 border border-emerald-200 rounded-2xl px-3.5 py-2">
              <strong className="text-emerald-900">Góc chụp đề xuất:</strong>
              {recommendedAngles.map((a) => (
                <span key={a.angle} className="px-2 py-0.5 rounded-md bg-white border border-emerald-200 font-semibold text-emerald-800">
                  {a.label}
                </span>
              ))}
            </div>
          </div>

          {cameraError && (
            <ErrorBanner
              title="Lỗi truy cập Camera"
              message={cameraError}
              onRetry={() => startCamera(false)}
              retryLabel="Thử mở lại"
            />
          )}

          {uploadError && (
            <ErrorBanner
              title="Ảnh tải lên không hợp lệ"
              message={uploadError}
              onRetry={() => {
                setUploadError(null);
                fileInputRef.current?.click();
              }}
              retryLabel="Chọn ảnh khác"
            />
          )}

          {isCameraActive ? (
            <div
              className={`transition-all duration-300 ${
                isFullscreenCamera
                  ? 'fixed inset-0 z-50 bg-black text-white flex flex-col justify-between p-3 sm:p-5'
                  : 'space-y-3'
              }`}
            >
              <div
                className={`relative rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center shadow-xl w-full ${
                  isFullscreenCamera
                    ? 'flex-1 my-2 min-h-[300px]'
                    : effectiveOrientation === 'landscape'
                    ? 'aspect-[16/9] min-h-[320px] max-h-[65vh]'
                    : 'h-[44vh] sm:h-[48vh] min-h-[320px] max-h-[500px]'
                }`}
              >
                <video
                  ref={setVideoRef}
                  playsInline
                  autoPlay
                  muted
                  webkit-playsinline="true"
                  onLoadedMetadata={() => {
                    setIsVideoLive(true);
                    videoRef.current?.play().catch(() => {});
                  }}
                  onPlay={() => setIsVideoLive(true)}
                  onClick={() => videoRef.current?.play().catch(() => {})}
                  className="w-full h-full object-cover select-none cursor-pointer"
                />

                {isFlashing && (
                  <div className="absolute inset-0 bg-white/80 pointer-events-none z-30" />
                )}

                {!isVideoLive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white gap-2 z-20 pointer-events-none">
                    <RefreshCw className="w-7 h-7 text-emerald-400 animate-spin" />
                    <span className="text-xs text-slate-300">Đang khởi động ống kính...</span>
                  </div>
                )}

                {/* Framing Guide Corners */}
                <div className="absolute inset-4 sm:inset-7 border border-white/25 rounded-2xl pointer-events-none z-10">
                  <div className="w-8 h-8 border-t-2 border-l-2 border-emerald-400 absolute -top-1 -left-1 rounded-tl-lg" />
                  <div className="w-8 h-8 border-t-2 border-r-2 border-emerald-400 absolute -top-1 -right-1 rounded-tr-lg" />
                  <div className="w-8 h-8 border-b-2 border-l-2 border-emerald-400 absolute -bottom-1 -left-1 rounded-bl-lg" />
                  <div className="w-8 h-8 border-b-2 border-r-2 border-emerald-400 absolute -bottom-1 -right-1 rounded-br-lg" />
                  {showGrid && (
                    <div className="w-full h-full grid grid-cols-3 grid-rows-3 opacity-25">
                      {Array.from({ length: 9 }).map((_, idx) => (
                        <div key={idx} className="border border-white/50" />
                      ))}
                    </div>
                  )}
                </div>

                {/* Top Viewfinder HUD */}
                <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2 z-20">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-3 py-1 rounded-full bg-black/75 border border-white/20 text-white text-xs font-semibold">
                      {VIEW_ANGLE_META[activeAngleTarget].label}
                    </span>
                    {liveHud && (
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          liveHud.sharpnessScore >= 0.35 && liveHud.brightness >= 50
                            ? 'bg-emerald-950/85 border-emerald-400/50 text-emerald-300'
                            : 'bg-amber-950/85 border-amber-400/50 text-amber-300'
                        }`}
                      >
                        {liveHud.statusLabel} (Nét {Math.round(liveHud.sharpnessScore * 100)}%)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 bg-black/75 border border-white/20 p-1 rounded-full text-white">
                    {focusSupported && (
                      <button
                        type="button"
                        onClick={triggerManualFocus}
                        className="p-1.5 rounded-full hover:bg-white/20 cursor-pointer"
                        title="Lấy nét lại"
                      >
                        <Focus className="w-3.5 h-3.5 text-emerald-300" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsFullscreenCamera((p) => !p)}
                      className="p-1.5 rounded-full hover:bg-white/20 cursor-pointer"
                    >
                      {isFullscreenCamera ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForcedOrientation((c) =>
                          c === 'auto'
                            ? deviceOrientation === 'portrait'
                              ? 'landscape'
                              : 'portrait'
                            : c === 'portrait'
                            ? 'landscape'
                            : 'portrait'
                        )
                      }
                      className="p-1.5 rounded-full hover:bg-white/20 cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowGrid((p) => !p)}
                      className={`p-1.5 rounded-full cursor-pointer ${showGrid ? 'bg-emerald-500/40 text-emerald-300' : ''}`}
                    >
                      <Grid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="p-1.5 rounded-full hover:bg-rose-500/50 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Dedicated Shutter Bar */}
              <div className="sticky bottom-2 z-40 sm:static rounded-3xl bg-slate-900 border border-slate-700 p-3 sm:p-4 text-white shadow-2xl space-y-3">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  {(Object.keys(VIEW_ANGLE_META) as ViewAngleId[]).map((angleId) => (
                    <button
                      key={angleId}
                      type="button"
                      onClick={() => setActiveAngleTarget(angleId)}
                      className={`shrink-0 px-2.5 py-1 rounded-xl text-[11px] font-semibold cursor-pointer ${
                        activeAngleTarget === angleId
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {VIEW_ANGLE_META[angleId].label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between px-2 sm:px-6">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-16 flex flex-col items-center text-slate-300 hover:text-white cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
                      <Upload className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] mt-0.5">Tải ảnh ({views.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="p-1.5 rounded-full bg-white/20 border-2 border-white active:scale-90 transition cursor-pointer"
                  >
                    <div className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center shadow-lg">
                      <Camera className="w-7 h-7 text-white" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={toggleCameraFacing}
                    className="w-16 flex flex-col items-center text-slate-300 hover:text-white cursor-pointer"
                  >
                    <div className="w-11 h-11 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
                      <SwitchCamera className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] mt-0.5">
                      {cameraFacing === 'environment' ? 'Cam sau' : 'Cam trước'}
                    </span>
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-300">Đã thu thập: {views.length} ảnh</span>
                  <button
                    type="button"
                    disabled={views.length === 0}
                    onClick={() => {
                      stopCamera();
                      if (views.length > 0) setWizardStep(2);
                    }}
                    className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold cursor-pointer"
                  >
                    Xem ảnh vừa chụp →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 sm:p-7 rounded-3xl bg-white border border-slate-200 shadow-sm text-center space-y-4">
              <div className="border-2 border-dashed border-slate-300 hover:border-emerald-400 rounded-2xl p-6 bg-slate-50/50 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Camera className="w-7 h-7" />
                </div>
                <div className="space-y-1 max-w-lg">
                  <h4 className="font-bold text-slate-900 text-base">
                    Mở Camera chụp trực tiếp hoặc Tải ảnh từ thiết bị
                  </h4>
                  <p className="text-xs text-slate-500">
                    Hệ thống tự động gợi ý khung bao quanh vật thể sau khi chụp để bạn tinh chỉnh ở bước tiếp theo.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => startCamera(false)}
                    className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center gap-2 shadow-md cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Mở Camera Chụp Ảnh</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-5 py-3 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-sm font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-slate-500" />
                    <span>Tải ảnh từ máy</span>
                  </button>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
                  <span>Thử nhanh mẫu ảnh nội bộ:</span>
                  <button
                    type="button"
                    onClick={loadBottleSample}
                    className="text-emerald-700 hover:underline font-semibold bg-emerald-50 px-2.5 py-1 rounded-md cursor-pointer"
                  >
                    Chai nhựa PET 500ml (2 góc)
                  </button>
                  <button
                    type="button"
                    onClick={loadCardboardSample}
                    className="text-emerald-700 hover:underline font-semibold bg-emerald-50 px-2.5 py-1 rounded-md cursor-pointer"
                  >
                    Hộp carton Kraft
                  </button>
                </div>
              </div>

              {views.length > 0 && (
                <div className="text-left space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-emerald-600" />
                      <span>Ảnh đã thu thập ({views.length} góc)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setViews([])}
                      className="text-xs text-rose-600 hover:underline font-semibold cursor-pointer"
                    >
                      Xóa tất cả
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                    {views.map((v, idx) => (
                      <div
                        key={v.id}
                        onClick={() => {
                          setActiveViewIdx(idx);
                          setWizardStep(2);
                        }}
                        className={`relative rounded-xl overflow-hidden aspect-square border-2 cursor-pointer ${
                          idx === activeViewIdx ? 'border-emerald-500 ring-2 ring-emerald-500/25' : 'border-slate-200'
                        }`}
                      >
                        <img src={v.originalImage} alt={VIEW_ANGLE_META[v.angle].label} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeView(idx);
                          }}
                          className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-rose-600 text-white cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <span className="absolute bottom-1 left-1 bg-black/75 text-white text-[10px] px-1.5 py-0.5 rounded-md">
                          {VIEW_ANGLE_META[v.angle].label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 2: PREVIEW & ANGLE LABELING */}
      {/* ======================================================= */}
      {wizardStep === 2 && primaryView && (
        <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                XEM TRƯỚC ẢNH ĐÃ CHỤP / TẢI LÊN
              </span>
              <h3 className="text-lg font-extrabold text-slate-900 mt-0.5">
                Kiểm tra bố cục ảnh & gán góc chụp cho từng tấm ({views.length} ảnh)
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Chụp / Tải thêm</span>
              </button>
            </div>
          </div>

          {/* Selected Large Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center p-2 max-h-[420px]">
              <img
                src={primaryView.originalImage}
                alt={VIEW_ANGLE_META[primaryView.angle].label}
                className="max-h-[390px] w-auto object-contain rounded-xl"
              />
            </div>

            <div className="lg:col-span-5 space-y-3 text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Thông tin ảnh #{activeViewIdx + 1}</span>
                  <span className="font-mono text-[11px] text-slate-600">
                    {primaryView.imageWidth} × {primaryView.imageHeight} px
                  </span>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">Góc chụp của ảnh này:</label>
                  <select
                    value={primaryView.angle}
                    onChange={(e) => updateViewAngle(activeViewIdx, e.target.value as ViewAngleId)}
                    className="w-full p-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-800"
                  >
                    {(Object.keys(VIEW_ANGLE_META) as ViewAngleId[]).map((aid) => (
                      <option key={aid} value={aid}>
                        {VIEW_ANGLE_META[aid].label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {VIEW_ANGLE_META[primaryView.angle].captureTip}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      removeView(activeViewIdx);
                      if (views.length <= 1) setWizardStep(1);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa ảnh này & chụp lại</span>
                  </button>
                </div>
              </div>

              {/* All captured thumbnails */}
              <div className="grid grid-cols-3 gap-2">
                {views.map((v, idx) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActiveViewIdx(idx)}
                    className={`relative rounded-xl overflow-hidden aspect-square border-2 cursor-pointer ${
                      idx === activeViewIdx ? 'border-emerald-500 ring-2 ring-emerald-500/25' : 'border-slate-200'
                    }`}
                  >
                    <img src={v.originalImage} alt={v.angle} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-1 bg-black/75 text-white text-[9px] px-1.5 py-0.5 rounded">
                      {VIEW_ANGLE_META[v.angle].label.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 3: BOUNDING BOX SELECTION + REFERENCE LINE */}
      {/* ======================================================= */}
      {wizardStep === 3 && primaryView && (
        <div className="space-y-4">
          {views.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {views.map((v, idx) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActiveViewIdx(idx)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer ${
                    idx === activeViewIdx
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  <span>Góc {idx + 1}: {VIEW_ANGLE_META[v.angle].label}</span>
                </button>
              ))}
            </div>
          )}

          <ObjectCropSelector
            imageUrl={primaryView.originalImage}
            imageWidth={primaryView.imageWidth}
            imageHeight={primaryView.imageHeight}
            bbox={activeBBox}
            onChangeBBox={updateViewBBox}
            referenceType={referenceType}
            onChangeReferenceType={setReferenceType}
            referenceLine={referenceLine}
            onChangeReferenceLine={setReferenceLine}
            onAutoDetectBBox={handleAutoDetectActiveBBox}
            isAutoDetecting={isAutoDetectingBBox}
            viewLabel={VIEW_ANGLE_META[primaryView.angle].label}
          />
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 4: IMAGE & SELECTION QUALITY GATE (BEFORE SEGMENTATION) */}
      {/* ======================================================= */}
      {wizardStep === 4 && primaryView && (
        <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                KIỂM TRA CHẤT LƯỢNG ẢNH & VÙNG CHỌN (QUALITY GATE)
              </span>
              <h3 className="text-lg font-extrabold text-slate-900">
                Đánh giá độ phân giải, nét, sáng, tương phản, trọn khung & kích thước vùng khoanh
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowThresholdTuner((p) => !p)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Ngưỡng kiểm tra</span>
              </button>

              {activeQualityReport && (
                <span
                  className={`px-3 py-1 rounded-full text-xs font-black ${
                    activeQualityReport.status === 'GOOD'
                      ? 'bg-emerald-100 text-emerald-800'
                      : activeQualityReport.status === 'WARNING'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {activeQualityReport.status === 'GOOD'
                    ? '✓ Đạt chuẩn (GOOD)'
                    : activeQualityReport.status === 'WARNING'
                    ? '⚠ Cảnh báo nhẹ'
                    : '✕ Không đạt (REJECTED)'}
                </span>
              )}
            </div>
          </div>

          {/* Multi-view status selector if more than 1 view */}
          {views.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {views.map((v, idx) => {
                const st = qualityReportsByView[v.id]?.status || v.quality?.status;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActiveViewIdx(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer ${
                      idx === activeViewIdx
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <span>Góc {idx + 1}: {VIEW_ANGLE_META[v.angle].label}</span>
                    {st && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          st === 'GOOD'
                            ? 'bg-emerald-500 text-white'
                            : st === 'WARNING'
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-rose-500 text-white'
                        }`}
                      >
                        {st}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Tunable CV Thresholds Panel */}
          {showThresholdTuner && (
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <strong className="text-slate-900">
                  Tinh chỉnh ngưỡng kiểm tra chất lượng CV (có thể điều chỉnh qua thử nghiệm thực tế)
                </strong>
                <button
                  type="button"
                  onClick={() => {
                    const reset = { ...DEFAULT_QUALITY_THRESHOLDS };
                    setQualityThresholds(reset);
                    runAllViewsQualityCheck(reset);
                  }}
                  className="text-emerald-700 font-bold hover:underline cursor-pointer"
                >
                  Khôi phục mặc định
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-600 block">Nét tối thiểu (Laplacian)</span>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={qualityThresholds.minLaplacianVarReject}
                    onChange={(e) =>
                      setQualityThresholds((p) => ({
                        ...p,
                        minLaplacianVarReject: Number(e.target.value) || 22,
                      }))
                    }
                    className="w-full p-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-600 block">Sáng tối thiểu (0–255)</span>
                  <input
                    type="number"
                    min={10}
                    max={120}
                    value={qualityThresholds.minBrightnessReject}
                    onChange={(e) =>
                      setQualityThresholds((p) => ({
                        ...p,
                        minBrightnessReject: Number(e.target.value) || 38,
                      }))
                    }
                    className="w-full p-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-600 block">Tương phản min (0–1)</span>
                  <input
                    type="number"
                    step="0.02"
                    min={0.05}
                    max={0.5}
                    value={qualityThresholds.minContrastWarn}
                    onChange={(e) =>
                      setQualityThresholds((p) => ({
                        ...p,
                        minContrastWarn: Number(e.target.value) || 0.18,
                      }))
                    }
                    className="w-full p-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-600 block">ROI tối thiểu (px)</span>
                  <input
                    type="number"
                    min={40}
                    max={400}
                    value={qualityThresholds.minRoiPx}
                    onChange={(e) =>
                      setQualityThresholds((p) => ({
                        ...p,
                        minRoiPx: Number(e.target.value) || 100,
                      }))
                    }
                    className="w-full p-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-600 block">Diện tích BBox min</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0.01}
                    max={0.3}
                    value={qualityThresholds.minBBoxAreaRatioReject}
                    onChange={(e) =>
                      setQualityThresholds((p) => ({
                        ...p,
                        minBBoxAreaRatioReject: Number(e.target.value) || 0.03,
                      }))
                    }
                    className="w-full p-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-600 block">Diện tích BBox max</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0.8}
                    max={0.999}
                    value={qualityThresholds.maxBBoxAreaRatioReject}
                    onChange={(e) =>
                      setQualityThresholds((p) => ({
                        ...p,
                        maxBBoxAreaRatioReject: Number(e.target.value) || 0.985,
                      }))
                    }
                    className="w-full p-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => runAllViewsQualityCheck(qualityThresholds)}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
              >
                Áp dụng ngưỡng & Kiểm tra lại
              </button>
            </div>
          )}

          {isAssessingQuality || !activeQualityReport ? (
            <div className="py-10 text-center text-xs text-slate-500">
              <RefreshCw className="w-6 h-6 animate-spin text-emerald-600 mx-auto mb-2" />
              <span>Đang tính độ nét Laplacian, độ sáng, tương phản, mép khung & kích thước BBox...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Độ phân giải ROI</span>
                  <strong className="text-sm text-slate-900">
                    {activeQualityReport.metrics.roiResolutionPx.width}×{activeQualityReport.metrics.roiResolutionPx.height} px
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Độ nét (Laplacian)</span>
                  <strong className="text-sm text-slate-900">
                    {Math.round(activeQualityReport.metrics.blurScore * 100)}% ({activeQualityReport.metrics.rawLaplacianVar})
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Độ sáng TB (0–255)</span>
                  <strong className="text-sm text-slate-900">{activeQualityReport.metrics.brightness}</strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Tương phản (RMS)</span>
                  <strong className="text-sm text-slate-900">
                    {Math.round(activeQualityReport.metrics.contrast * 100)}%
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Nằm trọn khung</span>
                  <strong className="text-sm text-slate-900">
                    {Math.round(activeQualityReport.metrics.edgeClippingScore * 100)}%
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Diện tích vùng chọn</span>
                  <strong className="text-sm text-slate-900">
                    {Math.round(activeQualityReport.metrics.bboxAreaRatio * 100)}% ảnh
                  </strong>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <span className="font-bold text-slate-800 block">
                  Kết luận kiểm tra ({Math.round(activeQualityReport.overallScore * 100)} điểm):
                </span>
                <ul className="space-y-1 text-slate-700 list-disc pl-5">
                  {activeQualityReport.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                {activeQualityReport.recommendations.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 text-slate-600 space-y-1">
                    <span className="font-bold text-slate-800 block">Cách khắc phục đề xuất:</span>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {activeQualityReport.recommendations.map((tip, i) => (
                        <li key={i}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {hasAnyRejectedView && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                    <div>
                      <strong className="block">
                        Ảnh hoặc vùng chọn chưa đạt chuẩn tối thiểu — Chặn chuyển sang bước Tách nền & AI
                      </strong>
                      <span>
                        Vui lòng chụp/tải lại ảnh rõ sáng hơn hoặc quay lại Bước 3 chỉnh lại khung khoanh vùng BBox.
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
                    >
                      Chụp / Tải lại ảnh
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardStep(3)}
                      className="px-3.5 py-2 rounded-xl bg-white border border-rose-300 text-rose-800 font-bold cursor-pointer"
                    >
                      Chỉnh lại BBox
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 5: SEGMENTATION & MANUAL MASK REFINEMENT */}
      {/* ======================================================= */}
      {wizardStep === 5 && primaryView && (
        <div className="space-y-4">
          {views.length > 1 && (
            <div className="p-3 rounded-2xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {views.map((v, idx) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActiveViewIdx(idx)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer ${
                      idx === activeViewIdx
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}
                  >
                    <span>Góc {idx + 1}: {VIEW_ANGLE_META[v.angle].label}</span>
                    {v.maskDataUrl && <Check className="w-3.5 h-3.5" />}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={isBatchSegmenting}
                onClick={handleBatchSegmentAllViews}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>{isBatchSegmenting ? 'Đang tách nền...' : 'Tách nền tất cả góc'}</span>
              </button>
            </div>
          )}

          <MaskRefinementEditor
            imageUrl={primaryView.originalImage}
            bbox={activeBBox}
            segmentation={activeSegmentation}
            isManuallyRefined={primaryView.isManuallyRefined}
            hasSamEndpoint={hasSamEndpoint}
            onSegmentationReady={handleSegmentationReady}
          />
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 6: MULTI-VIEW CONSISTENCY & DIMENSION CALIBRATION */}
      {/* ======================================================= */}
      {wizardStep === 6 && (
        <div className="space-y-5">
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                  ĐỒNG BỘ ĐA GÓC CHỤP (MULTI-VIEW CONSISTENCY)
                </span>
                <h3 className="text-lg font-extrabold text-slate-900">
                  Xem lại các góc đã tách nền & Kiểm tra thiếu góc
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="px-4 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                <span>Chụp / Tải thêm góc</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {views.map((v, idx) => (
                <div
                  key={v.id}
                  className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs"
                >
                  <div className="aspect-video rounded-xl overflow-hidden bg-white border border-slate-200">
                    <img
                      src={v.processedImageUrl || v.bboxCroppedUrl || v.originalImage}
                      alt={VIEW_ANGLE_META[v.angle].label}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-700">Ảnh #{idx + 1}</span>
                    <select
                      value={v.angle}
                      onChange={(e) => updateViewAngle(idx, e.target.value as ViewAngleId)}
                      className="p-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                    >
                      {(Object.keys(VIEW_ANGLE_META) as ViewAngleId[]).map((aid) => (
                        <option key={aid} value={aid}>
                          {VIEW_ANGLE_META[aid].label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {multiViewReport && (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    Độ nhất quán giữa các góc: {Math.round(multiViewReport.consistencyScore * 100)}%
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-md font-bold ${
                      multiViewReport.isConsistent ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {multiViewReport.isConsistent ? 'Nhất quán tốt' : 'Cần kiểm tra lại'}
                  </span>
                </div>
                {multiViewReport.recommendedNextAngles.length > 0 && (
                  <p className="text-slate-600">
                    Góc nên bổ sung để 3D chính xác hơn:{' '}
                    <strong>
                      {multiViewReport.recommendedNextAngles.map((a) => a.label).join(', ')}
                    </strong>
                  </p>
                )}
                {multiViewReport.warnings.map((w, idx) => (
                  <p key={idx} className="text-amber-800">
                    • {w}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-5">
            <div className="pb-3 border-b border-slate-100">
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5" />
                <span>HIỆU CHUẨN KÍCH THƯỚC THỰC (SCALE CALIBRATION)</span>
              </span>
              <h3 className="text-lg font-extrabold text-slate-900 mt-0.5">
                Quy đổi kích thước từ vật chuẩn hoặc nhập tay chính xác (cm)
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block">Loại vật tham chiếu trong ảnh:</label>
                <select
                  value={referenceType}
                  onChange={(e) => setReferenceType(e.target.value as ReferenceObjectType)}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-medium text-slate-800"
                >
                  {Object.values(REFERENCE_OBJECTS).map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">{REFERENCE_OBJECTS[referenceType].description}</p>
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-800 block">Ghi chú thêm về vật chuẩn (tùy chọn):</label>
                <input
                  type="text"
                  value={referenceDescription}
                  onChange={(e) => setReferenceDescription(e.target.value)}
                  placeholder="Ví dụ: Đặt thẻ ATM nằm dọc ngay bên trái chai..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white text-slate-800"
                />
                <span className="text-[11px] text-slate-500 block">
                  Nguồn đo hiện tại: <strong>{measurementMethod}</strong> (tin cậy{' '}
                  {Math.round(calibratedConf * 100)}%)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Chiều cao (H - cm)</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="300"
                  value={manualHeightCm}
                  onChange={(e) => {
                    setManualHeightCm(parseFloat(e.target.value) || 1);
                    setMeasurementMethod('user_input');
                  }}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Chiều rộng / Ø (W - cm)</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="300"
                  value={manualWidthCm}
                  onChange={(e) => {
                    setManualWidthCm(parseFloat(e.target.value) || 1);
                    setMeasurementMethod('user_input');
                  }}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">Chiều sâu (D - cm)</label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="300"
                  value={manualDepthCm}
                  onChange={(e) => {
                    setManualDepthCm(parseFloat(e.target.value) || 1);
                    setMeasurementMethod('user_input');
                  }}
                  className="w-full p-2.5 rounded-xl border border-slate-300 bg-white font-bold text-slate-900"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 7: EXPLICIT CONFIRMATION & STRUCTURED AI SUBMISSION */}
      {/* ======================================================= */}
      {wizardStep === 7 && primaryView && (
        <div className="space-y-5">
          {analysisError && (
            <ErrorBanner
              title="Phân tích AI đám mây không khả dụng hoặc lỗi kết nối"
              message={`${analysisError} — Hệ thống không thay thế bằng dữ liệu giả. Bạn có thể thử lại hoặc bấm "Dựng mô hình 3D cục bộ ngay".`}
              onRetry={handleSubmitAI}
              retryLabel="Thử lại AI"
            />
          )}

          {/* Separated Layers Inspection Card */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>XÁC NHẬN GÓI DỮ LIỆU ĐẦU VÀO TRƯỚC KHI GỬI AI</span>
                </span>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-0.5">
                  Kiểm tra lại Ảnh gốc, Vùng chọn BBox, Mask tách nền & Ảnh sạch gửi AI
                </h3>
              </div>

              {allViewsHaveQualityPassed ? (
                <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                  ✓ Đã qua kiểm tra chất lượng CV
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setWizardStep(4)}
                  className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold cursor-pointer"
                >
                  Kiểm tra chất lượng ảnh →
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span>1. Ảnh gốc</span>
                  <span className="text-[10px] text-slate-400">Lưu cục bộ</span>
                </div>
                <div className="aspect-square rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center p-1">
                  <img src={primaryView.originalImage} alt="Ảnh gốc" className="w-full h-full object-contain" />
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {primaryView.imageWidth}×{primaryView.imageHeight} px
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span className="flex items-center gap-1">
                    <Crop className="w-3.5 h-3.5 text-emerald-600" />
                    <span>2. Crop theo BBox</span>
                  </span>
                  <span className="text-[10px] text-emerald-700 font-bold">Gửi AI</span>
                </div>
                <div className="aspect-square rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center p-1">
                  <img
                    src={primaryView.bboxCroppedUrl || primaryView.originalImage}
                    alt="Crop theo BBox"
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="font-mono text-[10px] text-slate-600 block truncate">
                  [{activeBBox.xMin.toFixed(2)}, {activeBBox.yMin.toFixed(2)}, {activeBBox.xMax.toFixed(2)}, {activeBBox.yMax.toFixed(2)}]
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span>3. Mask tách nền</span>
                  <span className="text-[10px] text-emerald-700 font-bold">Gửi AI</span>
                </div>
                <div className="aspect-square rounded-xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center p-1">
                  {primaryView.maskDataUrl ? (
                    <img src={primaryView.maskDataUrl} alt="Mask tách nền" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-slate-400 text-center px-2">Chưa tách mask (sẽ dùng ảnh Crop BBox)</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 block">
                  {primaryView.isManuallyRefined ? 'Đã chỉnh cọ thủ công' : primaryView.segmentationEngine || 'GrabCut'}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-50/50 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between font-bold text-emerald-900">
                  <span>4. Ảnh sạch tách nền</span>
                  <span className="text-[10px] text-emerald-700 font-bold">Ưu tiên #1</span>
                </div>
                <div className="aspect-square rounded-xl overflow-hidden bg-white border border-emerald-200 flex items-center justify-center p-1">
                  <img
                    src={primaryView.processedImageUrl || primaryView.bboxCroppedUrl || primaryView.originalImage}
                    alt="Ảnh đã tách nền gửi AI"
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="text-[10px] text-emerald-800 block">
                  {views.length} góc • {manualHeightCm}×{manualWidthCm}×{manualDepthCm} cm
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={focusOnSelection}
                  onChange={(e) => setFocusOnSelection(e.target.checked)}
                  className="mt-0.5 accent-emerald-600"
                />
                <span>
                  <strong className="text-slate-900 block">
                    Chỉ gửi vùng đã khoanh BBox & ảnh tách nền sang AI (Khuyên dùng)
                  </strong>
                  <span className="text-[11px] text-slate-600">
                    Không gửi toàn bộ ảnh thô chứa bối cảnh xung quanh để AI tập trung 100% vào vật thể bạn đã chọn.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 pt-2 border-t border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={userConfirmedSubmission}
                  onChange={(e) => setUserConfirmedSubmission(e.target.checked)}
                  className="mt-0.5 accent-emerald-600"
                />
                <span>
                  <strong className="text-emerald-900 block">
                    Tôi xác nhận vùng chọn BBox, mask tách nền và kích thước đã chính xác để gửi AI phân tích
                  </strong>
                  <span className="text-[11px] text-slate-600">
                    Bắt buộc xác nhận trước khi gửi yêu cầu sang hệ thống AI Vision.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* IME-safe Notes Card */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
                  Mô tả thành phần & Mục tiêu tái chế
                </h3>
                <p className="text-xs text-slate-500">
                  Mô tả chất liệu, độ sạch, phụ kiện (nắp, quai...) để AI nhận diện đúng vật liệu và gợi ý sản phẩm phù hợp.
                </p>
              </div>
            </div>

            <textarea
              ref={notesTextareaRef}
              rows={4}
              defaultValue={userNotes}
              onCompositionStart={() => {
                isComposingNotesRef.current = true;
              }}
              onCompositionEnd={(e) => {
                isComposingNotesRef.current = false;
                setUserNotes(e.currentTarget.value);
                autoGrowNotesTextarea(e.currentTarget);
              }}
              onInput={(e) => {
                autoGrowNotesTextarea(e.currentTarget);
                if (!isComposingNotesRef.current) {
                  setUserNotes(e.currentTarget.value);
                }
              }}
              onBlur={(e) => setUserNotes(e.currentTarget.value)}
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck={true}
              enterKeyHint="enter"
              inputMode="text"
              placeholder="Ví dụ: Chai nhựa PET 500ml màu xanh trong suốt đã rửa sạch, còn nắp. Muốn làm chậu cây tự tưới hoặc đèn lồng..."
              className="w-full min-h-[120px] p-3.5 rounded-2xl border border-slate-300 text-base sm:text-sm text-slate-800 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden leading-relaxed resize-y"
            />

            <div className="flex flex-wrap gap-1.5">
              {[
                'Chai nhựa PET 500ml đã rửa sạch, còn nắp',
                'Hộp carton sóng 3 lớp sạch sẽ',
                'Vỏ lon nhôm 330ml nguyên vẹn',
                'Quần jean cũ vải denim dày',
                'Muốn làm chậu cây tự dưỡng hoặc ống cắm bút',
              ].map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    const current = notesTextareaRef.current ? notesTextareaRef.current.value : userNotes;
                    if (current.includes(chip)) return;
                    setUserNotesProgrammatic(current ? `${current} ${chip}` : chip);
                  }}
                  className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-emerald-50 border border-slate-200 text-[11px] text-slate-700 cursor-pointer"
                >
                  + {chip}
                </button>
              ))}
            </div>
          </div>

          {/* AI Engine Selector & Submit */}
          <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3">
            <h4 className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>Công cụ AI Vision & Dựng Hình</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {[
                {
                  id: 'gemini',
                  title: 'Google Gemini 4 Hydrogen',
                  desc: 'Nhận diện vật liệu, tọa độ mặt cắt & tính thể tích chuẩn xác.',
                  badge: hasGeminiKey ? 'API Sẵn sàng' : 'Cần GEMINI_API_KEY',
                },
                {
                  id: 'chatgpt',
                  title: 'OpenAI ChatGPT-4o',
                  desc: 'Phân tích trực quan và đề xuất ý tưởng thủ công sáng tạo.',
                  badge: 'Tùy chọn OPENAI_API_KEY',
                },
                {
                  id: 'dual',
                  title: 'AI Song Mã (Gemini + GPT)',
                  desc: 'Kết hợp đo đạc hình học Gemini và gợi ý đa dạng.',
                  badge: 'Đa mô hình',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAiEngine(opt.id as any)}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    aiEngine === opt.id
                      ? 'border-emerald-500 bg-emerald-50/70 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-slate-900">
                    <span>{opt.title}</span>
                    {aiEngine === opt.id && <Check className="w-4 h-4 text-emerald-600" />}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">{opt.desc}</p>
                  <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                    {opt.badge}
                  </span>
                </button>
              ))}
            </div>

            <div className="pt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                disabled={views.length === 0 || !userConfirmedSubmission || isAnalyzing || isPreparingPayload}
                onClick={handleSubmitAI}
                className="w-full sm:w-auto px-7 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-45 text-white font-extrabold text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer"
              >
                {isAnalyzing || isPreparingPayload ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang gửi dữ liệu vùng chọn & phân tích...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Xác nhận & Gửi AI phân tích</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={views.length === 0 || !userConfirmedSubmission || isAnalyzing || isPreparingPayload}
                onClick={handleRunLocal3DOnly}
                className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:opacity-45 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <Box className="w-4 h-4 text-emerald-400" />
                <span>Dựng mô hình 3D cục bộ ngay</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 8: 3D RECONSTRUCTION */}
      {/* ======================================================= */}
      {wizardStep === 8 && (
        <div className="space-y-5">
          {confirmedMaterial ? (
            <>
              <Suspense
                fallback={
                  <div className="h-[450px] rounded-3xl bg-slate-900/95 text-slate-200 flex items-center justify-center text-sm font-medium">
                    Đang tải trình xem 3D tương tác...
                  </div>
                }
              >
                <MaterialScanner3D material={confirmedMaterial} height="450px" />
              </Suspense>
              {confirmedMaterial.reconstruction && (
                <ReconstructionResultPanel
                  reconstruction={confirmedMaterial.reconstruction}
                  views={views}
                  maskProfile={primaryView?.silhouetteProfile || []}
                  onGlbAttached={onGlbAttached}
                />
              )}
            </>
          ) : (
            <div className="p-8 rounded-3xl bg-white border border-slate-200 text-center space-y-3">
              <Box className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-slate-800">
                Chưa có mô hình 3D cho phiên quét hiện tại.
              </p>
              <button
                type="button"
                onClick={() => setWizardStep(7)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs cursor-pointer"
              >
                Quay lại Bước 7 xác nhận & dựng 3D
              </button>
            </div>
          )}
        </div>
      )}

      {/* ======================================================= */}
      {/* STEP 9: SUMMARY & SAVE TO INVENTORY */}
      {/* ======================================================= */}
      {wizardStep === 9 && (
        <div className="space-y-5">
          {confirmedMaterial && (
            <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                <ShieldCheck className="w-4 h-4" />
                <span>TỔNG HỢP KẾT QUẢ PHÂN TÍCH & DỰNG 3D</span>
              </div>
              <h3 className="text-xl font-black text-slate-900">{confirmedMaterial.name}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Chất liệu chi tiết</span>
                  <strong className="text-slate-900">
                    {confirmedMaterial.reconstruction?.object.material || confirmedMaterial.categoryLabel}
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Kích thước 3D (cm)</span>
                  <strong className="text-slate-900">
                    {confirmedMaterial.dimensions.widthCm} × {confirmedMaterial.dimensions.lengthCm} ×{' '}
                    {confirmedMaterial.dimensions.heightCm}
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Thể tích / Diện tích</span>
                  <strong className="text-emerald-700">
                    {confirmedMaterial.dimensions.volumeMl} ml • {confirmedMaterial.dimensions.usableSurfaceCm2} cm²
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">Kiểu dựng 3D</span>
                  <strong className="text-indigo-700">
                    {confirmedMaterial.reconstruction?.geometry.geometryType || 'parametric'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-sm text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <Bookmark className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">
              Lưu vật liệu & dữ liệu 3D vào Kho vật liệu cá nhân
            </h3>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Lưu lại vật liệu đã tách nền, thông số kích thước và mô hình Parametric 3D để phối hợp làm các dự án thủ công về sau.
            </p>
            {confirmedMaterial ? (
              <button
                type="button"
                disabled={isSavedToInventory}
                onClick={async () => {
                  if (onSaveMaterialToInventory && confirmedMaterial) {
                    await onSaveMaterialToInventory(confirmedMaterial);
                    setIsSavedToInventory(true);
                  }
                }}
                className={`px-6 py-3 rounded-2xl font-bold text-xs inline-flex items-center gap-2 cursor-pointer transition ${
                  isSavedToInventory
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                <span>{isSavedToInventory ? 'Đã lưu vào Kho vật liệu!' : 'Lưu vật liệu ngay'}</span>
              </button>
            ) : (
              <p className="text-xs text-amber-700 font-semibold">
                Vui lòng hoàn tất Bước 7 trước khi lưu vào kho.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bottom Wizard Navigation Bar */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          disabled={wizardStep === 1}
          onClick={() => setWizardStep((s) => Math.max(1, s - 1) as WizardStepId)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Bước trước</span>
        </button>

        {wizardStep < 9 && (
          <button
            type="button"
            disabled={isNextStepDisabled()}
            onClick={() => setWizardStep((s) => Math.min(9, s + 1) as WizardStepId)}
            className="min-h-[44px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <span>Bước tiếp theo</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
