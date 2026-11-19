import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Box,
  Layers,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Coins,
  XCircle,
  FileCheck2,
} from 'lucide-react';
import type {
  CapturedViewEntry,
  GlbInspectionReport,
  ProfilePoint,
  ReconstructionResult,
} from '../../types/reconstruction';
import { evaluateSilhouetteOverlap } from '../../vision/textureExtractor';
import { checkMultiViewConsistency } from '../../vision/multiViewConsistency';
import {
  buildParametricReconstructionMesh,
  disposeObject3D,
  type GeometryRefinementReport,
} from '../../three/GeometryReconstructionEngine';
import {
  validateModelQualityPhase6,
  type Phase6QualityValidationReport,
} from '../../three/ModelQualityValidator';

interface EvaluatedProviderDto {
  id: string;
  serverProviderKey: string | null;
  name: string;
  apiAvailability: string;
  imageInputRequirements: string;
  outputFormats: string[];
  meshQuality: string;
  textureQuality: string;
  processingTime: string;
  pricing: string;
  licenseAndRestrictions: string;
  multiView: boolean;
  configured: boolean;
  recommended: boolean;
  roleInProject: string;
}

interface QuotaDto {
  usedToday: number;
  dailyLimit: number;
  remainingToday: number;
  totalCreditsEstimated: number;
}

interface ReconstructionResultPanelProps {
  reconstruction: ReconstructionResult;
  views: CapturedViewEntry[];
  maskProfile: ProfilePoint[];
  onGlbAttached?: (glbUrl: string, provider: string) => void;
}

const STEP_LABELS: Record<string, string> = {
  submit_image: '1. Gửi ảnh đã tách nền',
  receive_job_id: '2. Nhận Job ID',
  track_status: '3. Đang tái tạo 3D',
  handle_completion: '4. Hoàn tất xử lý',
  download_model: '5. Tải tệp GLB',
  validate_output: '6. Kiểm chứng cấu trúc GLB',
};

export const ReconstructionResultPanel: React.FC<ReconstructionResultPanelProps> = ({
  reconstruction,
  views,
  maskProfile,
  onGlbAttached,
}) => {
  const [multiViewReport, setMultiViewReport] = useState<
    Awaited<ReturnType<typeof checkMultiViewConsistency>> | null
  >(null);
  const [capabilities, setCapabilities] = useState<{
    hasImageTo3D: boolean;
    activeProvider: string;
    quota?: QuotaDto;
    evaluatedProviders?: EvaluatedProviderDto[];
  } | null>(null);
  const [preferProvider, setPreferProvider] = useState<string>('auto');
  const [showResearchTable, setShowResearchTable] = useState<boolean>(false);
  const [phase6Report, setPhase6Report] = useState<Phase6QualityValidationReport | null>(null);
  const [refinementDiff, setRefinementDiff] = useState<GeometryRefinementReport | null>(null);

  const [jobState, setJobState] = useState<{
    status: 'idle' | 'queued' | 'processing' | 'succeeded' | 'unavailable' | 'failed';
    jobId?: string;
    progressPercent?: number;
    currentStep?: string;
    message?: string;
    glbUrl?: string;
    glbByteLength?: number;
    elapsedMs?: number;
    estimatedCredits?: number;
    deduplicatedFromCache?: boolean;
    glbInspection?: GlbInspectionReport | null;
    provider?: string;
  }>({ status: 'idle' });

  const abortPollRef = useRef<boolean>(false);

  useEffect(() => {
    let active = true;
    checkMultiViewConsistency(views)
      .then((res) => {
        if (active) setMultiViewReport(res);
      })
      .catch(() => {});

    fetch('/api/status')
      .then((r) => r.json())
      .then((json) => {
        if (active && json?.imageTo3D) {
          setCapabilities(json.imageTo3D);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      abortPollRef.current = true;
    };
  }, [views]);

  // Phase 6 Geometry Refinement & 6-Criterion Honest Validation
  useEffect(() => {
    let cancelled = false;
    let builtRoot: any = null;

    const syntheticMaterial: any = {
      id: reconstruction.analysisId || 'scan_preview',
      name: reconstruction.object.name,
      category:
        reconstruction.object.category === 'metal' ||
        reconstruction.object.category === 'paper' ||
        reconstruction.object.category === 'glass' ||
        reconstruction.object.category === 'fabric'
          ? reconstruction.object.category
          : 'plastic',
      color: reconstruction.appearance.primaryColor,
      images: [],
      dimensions: {
        shapeType: reconstruction.object.shapeType === 'box' ? 'box' : 'cylinder',
        lengthCm: reconstruction.dimensions.lengthCm || reconstruction.dimensions.heightCm || 20,
        widthCm: reconstruction.dimensions.widthCm || 7,
        heightCm: reconstruction.dimensions.heightCm || 20,
      },
      reconstruction,
    };

    buildParametricReconstructionMesh({
      material: syntheticMaterial,
      isSoftwareGl: true,
      usePhotoTexture: false,
      qualityMode: 'optimized',
    })
      .then((built) => {
        builtRoot = built.group;
        if (cancelled) {
          disposeObject3D(built.group);
          return;
        }
        const report = validateModelQualityPhase6({
          root: built.group,
          recon: built.reconstruction,
          telemetry: built.telemetry,
          parts: built.parts,
          maskProfile,
          multiViewReport,
          hasPhotoTexture: Boolean(
            reconstruction.segmentation.croppedObjectUrl || views[0]?.croppedObjectUrl
          ),
          refinementReport: built.refinementReport,
          uvMetrics: built.uvMetrics,
        });
        setPhase6Report(report);
        setRefinementDiff(built.refinementReport || null);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (builtRoot) disposeObject3D(builtRoot);
    };
  }, [reconstruction, maskProfile, multiViewReport, views]);

  const silhouetteEval = evaluateSilhouetteOverlap(
    reconstruction.geometry.profilePoints || [],
    maskProfile
  );

  // Cancel an active async Image-to-3D job
  const handleCancelJob = async () => {
    abortPollRef.current = true;
    if (jobState.jobId) {
      try {
        await fetch(`/api/reconstruction/${encodeURIComponent(jobState.jobId)}`, {
          method: 'DELETE',
        });
      } catch {
        // Ignore network error on cancel
      }
    }
    setJobState({
      status: 'failed',
      message: 'Đã hủy tác vụ Image-to-3D. Mô hình Parametric 3D (Phase 4) tiếp tục được sử dụng.',
    });
  };

  // Trigger 6-step async Image-to-3D GLB backend job and poll until settled
  const handleStartImageTo3D = async () => {
    abortPollRef.current = false;
    setJobState({
      status: 'queued',
      progressPercent: 8,
      currentStep: 'submit_image',
      message: 'Đang gửi ảnh đã tách nền & ngữ cảnh hình học lên máy chủ...',
    });

    try {
      const processedImages = views
        .map((v) => v.croppedObjectUrl || v.processedImageUrl || v.bboxCroppedUrl || v.originalImage)
        .filter((x): x is string => Boolean(x))
        .slice(0, 4);
      const primaryMask = views[0]?.maskDataUrl || reconstruction.segmentation.maskUrl || null;

      const res = await fetch('/api/reconstruct-3d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisId: reconstruction.analysisId,
          image: processedImages[0],
          images: processedImages,
          maskDataUrl: primaryMask,
          preferProvider: preferProvider === 'auto' ? undefined : preferProvider,
          objectName: reconstruction.object.name,
          category: reconstruction.object.category,
          material: reconstruction.object.material,
          shapeType: reconstruction.object.shapeType,
          dimensions: {
            heightCm: reconstruction.dimensions.heightCm,
            widthCm: reconstruction.dimensions.widthCm,
            depthCm: reconstruction.dimensions.depthCm,
          },
        }),
      });
      const data = await res.json();
      if (data?.capabilities) {
        setCapabilities(data.capabilities);
      } else if (data?.quota) {
        setCapabilities((prev) => (prev ? { ...prev, quota: data.quota } : prev));
      }

      if (!data.success && data.status === 'unavailable') {
        setJobState({
          status: 'unavailable',
          message:
            data.message ||
            'Chưa cấu hình TRIPO_API_KEY / MESHY_API_KEY / IMAGE_TO_3D_ENDPOINT trên máy chủ. Đang dùng mô hình Parametric 3D.',
        });
        return;
      }

      if (!data.success) {
        setJobState({
          status: 'failed',
          message: data.error || 'Không thể khởi tạo tác vụ dựng 3D.',
        });
        return;
      }

      const job = data.job || data.data;
      if (!job || job.status === 'unavailable') {
        setJobState({
          status: 'unavailable',
          message:
            job?.message ||
            'Chưa cấu hình khóa API Image-to-3D trên máy chủ. Đang dùng Parametric 3D Engine (Phase 4).',
        });
        return;
      }

      if ((job.status === 'completed' || job.status === 'succeeded') && job.glbUrl) {
        setJobState({
          status: 'succeeded',
          jobId: job.id,
          progressPercent: 100,
          glbUrl: job.glbUrl,
          glbByteLength: job.glbByteLength,
          elapsedMs: job.elapsedMs,
          estimatedCredits: job.estimatedCredits,
          deduplicatedFromCache: job.deduplicatedFromCache,
          glbInspection: job.glbInspection,
          provider: job.provider,
          message: job.message || 'Đã dựng & kiểm chứng Mesh GLB hoàn tất!',
        });
        onGlbAttached?.(job.glbUrl, job.provider || 'image_to_3d');
        return;
      }

      const jobId = job.id || job.jobId;
      if (!jobId) {
        setJobState({ status: 'failed', message: 'Không nhận được mã tác vụ dựng 3D từ máy chủ.' });
        return;
      }

      setJobState({
        status: 'processing',
        jobId,
        progressPercent: job.progressPercent || 20,
        currentStep: job.currentStep || 'receive_job_id',
        estimatedCredits: job.estimatedCredits,
        message: job.message || `Đang xử lý Job ${jobId}...`,
        provider: job.provider,
      });

      // Poll GET /api/reconstruction/:id up to 30 times (~75s)
      for (let i = 0; i < 30; i++) {
        if (abortPollRef.current) return;
        await new Promise((r) => setTimeout(r, 2500));
        if (abortPollRef.current) return;

        const pollRes = await fetch(`/api/reconstruction/${encodeURIComponent(jobId)}`);
        const pollJson = await pollRes.json();
        const st = pollJson?.job || pollJson?.data;
        if (!st) break;

        if ((st.status === 'completed' || st.status === 'succeeded') && st.glbUrl) {
          setJobState({
            status: 'succeeded',
            jobId,
            progressPercent: 100,
            currentStep: 'validate_output',
            glbUrl: st.glbUrl,
            glbByteLength: st.glbByteLength,
            elapsedMs: st.elapsedMs,
            estimatedCredits: st.estimatedCredits,
            glbInspection: st.glbInspection,
            provider: st.provider,
            message: st.message || 'Đã tải & kiểm chứng Mesh GLB thành công!',
          });
          onGlbAttached?.(st.glbUrl, st.provider || 'image_to_3d');
          return;
        }
        if (st.status === 'failed' || st.status === 'unavailable') {
          setJobState({
            status: st.status,
            jobId,
            elapsedMs: st.elapsedMs,
            message: st.error || st.message || 'Không thể hoàn tất dựng GLB. Đang fallback về Parametric 3D.',
          });
          return;
        }
        setJobState((prev) => ({
          ...prev,
          status: 'processing',
          progressPercent: st.progressPercent ?? prev.progressPercent,
          currentStep: st.currentStep ?? prev.currentStep,
          message: st.message ?? prev.message,
        }));
      }

      setJobState({
        status: 'failed',
        jobId,
        message: 'Hết thời gian chờ tác vụ Image-to-3D. Hệ thống tiếp tục dùng mô hình Parametric 3D.',
      });
    } catch (err: any) {
      setJobState({
        status: 'failed',
        message: err?.message || 'Lỗi kết nối máy chủ Image-to-3D. Đang dùng mô hình Parametric 3D.',
      });
    }
  };

  const quota = capabilities?.quota;
  const isBusy = jobState.status === 'queued' || jobState.status === 'processing';

  return (
    <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div>
          <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
            <Box className="w-3.5 h-3.5" />
            <span>Kiểm chứng & Đánh giá độ khớp 3D</span>
          </span>
          <h4 className="text-base sm:text-lg font-extrabold text-slate-900 mt-0.5">
            Đối chiếu Silhouette, Đa góc chụp & Dịch vụ Image-to-3D (.GLB)
          </h4>
        </div>

        <span className="px-3 py-1 rounded-xl bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 self-start sm:self-auto">
          Phương pháp: {reconstruction.reconstructionMethod === 'image_to_3d' ? 'Image-to-3D GLB' : 'Parametric 3D (Phase 4)'}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
          <span className="font-bold text-slate-500 uppercase text-[10px]">
            Độ khớp đường bao 2D ↔ 3D (IoU)
          </span>
          {silhouetteEval.iou !== null ? (
            <>
              <p className="text-2xl font-black text-emerald-700">
                {Math.round(silhouetteEval.iou * 100)}%
              </p>
              <p className="text-[11px] text-slate-600">
                Sai số bán kính TB: <strong>{Math.round((silhouetteEval.meanRadiusError || 0) * 100)}%</strong>
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500 italic">
              Chưa có đường bao từ mask tách nền để đối chiếu tự động.
            </p>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
          <span className="font-bold text-slate-500 uppercase text-[10px]">
            Nhất quán đa góc nhìn ({views.length} ảnh)
          </span>
          {multiViewReport && multiViewReport.checkedPairs > 0 ? (
            <>
              <p
                className={`text-2xl font-black ${
                  multiViewReport.isConsistent ? 'text-emerald-700' : 'text-amber-600'
                }`}
              >
                {Math.round(multiViewReport.consistencyScore * 100)}%
              </p>
              <p className="text-[11px] text-slate-600">
                {multiViewReport.isConsistent
                  ? `Khớp qua ${multiViewReport.checkedPairs} cặp góc chụp.`
                  : 'Phát hiện khác biệt màu/nền giữa các góc.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500 italic">
              Chưa có đủ ≥ 2 góc chụp để kiểm chứng nhất quán đa góc (không tự suy đoán điểm).
            </p>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5">
          <span className="font-bold text-slate-500 uppercase text-[10px]">
            Độ tin cậy kích thước thực
          </span>
          <p className="text-2xl font-black text-blue-700">
            {Math.round((reconstruction.dimensions.confidence || 0.5) * 100)}%
          </p>
          <p className="text-[11px] text-slate-600">
            Nguồn đo: <strong>{reconstruction.dimensions.measurementMethod}</strong>
          </p>
        </div>
      </div>

      {/* Phase 6: 6-Criterion Honest Validation & Before/After Geometry Refinement Diff */}
      {phase6Report && (
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-slate-900">
                Phase 6 — Kiểm định Chất lượng & Tinh chỉnh Lưới 3D (6 tiêu chí)
              </span>
              <p className="text-[11px] text-slate-600 mt-0.5">{phase6Report.summary}</p>
            </div>
            {phase6Report.overallScore !== null && (
              <span className="px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-800 font-extrabold text-[11px]">
                Điểm thực tế: {Math.round(phase6Report.overallScore * 100)}% ({phase6Report.availableMetricsCount}/6)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {phase6Report.criteria.map((c) => (
              <div
                key={c.key}
                className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-800 text-[11px]">{c.label}</span>
                  {c.score !== null ? (
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                        c.status === 'passed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : c.status === 'warning'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {Math.round(c.score * 100)}%
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold text-[10px]">
                      Chưa đối chiếu
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-600 leading-relaxed">{c.detail}</p>
                <p className="text-[9px] text-slate-400">{c.evidence}</p>
              </div>
            ))}
          </div>

          {refinementDiff && (
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-teal-900">
              <span className="font-bold text-teal-800">Trước ↔ Sau tinh chỉnh:</span>
              <span>
                Tam giác suy biến: <strong>{refinementDiff.before.degenerateTriangles} → {refinementDiff.after.degenerateTriangles}</strong>
              </span>
              <span>
                Phủ UV [0..1]: <strong>{Math.round(refinementDiff.before.uvCoverageRatio * 100)}% → {Math.round(refinementDiff.after.uvCoverageRatio * 100)}%</strong>
              </span>
              <span>
                Bảo toàn tỷ lệ: <strong>{Math.round(refinementDiff.proportionsPreservedRatio * 100)}%</strong>
              </span>
              <span>
                Vật liệu PBR: <strong>{refinementDiff.materialsEnhanced}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Warnings & Critical Conflicts */}
      {multiViewReport &&
        (multiViewReport.criticalConflicts.length > 0 || multiViewReport.warnings.length > 0) && (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-1.5 text-xs text-amber-900">
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Lưu ý chất lượng & góc chụp còn thiếu:</span>
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
              {multiViewReport.criticalConflicts.map((c, idx) => (
                <li key={`c-${idx}`} className="font-semibold text-rose-800">
                  {c}
                </li>
              ))}
              {multiViewReport.warnings.map((w, idx) => (
                <li key={`w-${idx}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}

      {/* Phase 5: Image-to-3D AI GLB Pipeline & Provider Research */}
      <div className="p-4 sm:p-5 rounded-2xl bg-indigo-50/60 border border-indigo-200 space-y-3.5 text-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="font-bold text-indigo-950 flex items-center gap-1.5 flex-wrap">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <span>Phase 5: Tích hợp AI Image-to-3D (.GLB PBR Bổ trợ)</span>
              {quota && (
                <span className="px-2 py-0.5 rounded-md bg-white border border-indigo-200 text-indigo-700 text-[10px] font-semibold flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  <span>
                    Hạn mức hôm nay: {quota.remainingToday}/{quota.dailyLimit} lượt
                  </span>
                </span>
              )}
            </div>
            <p className="text-indigo-900/80 text-[11px]">
              Gửi ảnh đã tách nền kèm kích thước & phân loại Phase 3 để dựng lưới <code>.GLB</code>, so sánh song song với Parametric 3D Engine. Nếu chưa cấu hình khóa hoặc lỗi API, hệ thống giữ nguyên Parametric 3D.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={preferProvider}
              onChange={(e) => setPreferProvider(e.target.value)}
              disabled={isBusy}
              className="px-2.5 py-2 rounded-xl bg-white border border-indigo-200 text-indigo-900 font-semibold text-[11px] cursor-pointer"
              title="Chọn dịch vụ Image-to-3D trên máy chủ"
            >
              <option value="auto">
                Tự động ({capabilities?.activeProvider === 'none' ? 'Chưa có key' : capabilities?.activeProvider || 'Tripo3D'})
              </option>
              <option value="tripo3d">Tripo3D API v2 (Khuyên dùng)</option>
              <option value="meshy">Meshy Image-to-3D</option>
              <option value="custom_endpoint">Custom HTTPS (Hunyuan3D / InstantMesh)</option>
            </select>

            {isBusy ? (
              <button
                type="button"
                onClick={handleCancelJob}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Hủy</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartImageTo3D}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
              >
                {jobState.status === 'failed' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Thử lại GLB</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Dựng Mesh GLB 3D</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Live Async Pipeline Progress & Telemetry */}
        {jobState.status !== 'idle' && (
          <div className="p-3 rounded-xl bg-white border border-indigo-100 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span
                className={`text-[11px] font-bold flex items-center gap-1.5 ${
                  jobState.status === 'succeeded'
                    ? 'text-emerald-700'
                    : jobState.status === 'unavailable'
                    ? 'text-amber-800'
                    : jobState.status === 'failed'
                    ? 'text-rose-700'
                    : 'text-indigo-700'
                }`}
              >
                {jobState.status === 'succeeded' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : jobState.status === 'unavailable' || jobState.status === 'failed' ? (
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{jobState.message}</span>
              </span>
              {jobState.jobId && (
                <span className="text-[10px] font-mono text-slate-500">
                  ID: {jobState.jobId}
                  {typeof jobState.elapsedMs === 'number' ? ` • ${(jobState.elapsedMs / 1000).toFixed(1)}s` : ''}
                </span>
              )}
            </div>

            {isBusy && (
              <div className="space-y-1">
                <div className="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${Math.max(10, jobState.progressPercent || 15)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-600">
                  <span>{STEP_LABELS[jobState.currentStep || 'submit_image'] || 'Đang xử lý...'}</span>
                  <span>{Math.round(jobState.progressPercent || 15)}%</span>
                </div>
              </div>
            )}

            {jobState.status === 'succeeded' && jobState.glbInspection && (
              <div className="pt-1.5 border-t border-slate-100 flex flex-wrap items-center gap-2 text-[10px] text-slate-700">
                <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  GLB hợp lệ:
                </span>
                <span>{jobState.glbInspection.meshCount} mesh</span>
                <span>•</span>
                <span>{jobState.glbInspection.materialCount} material PBR</span>
                <span>•</span>
                <span>{jobState.glbInspection.textureCount} texture</span>
                {typeof jobState.glbByteLength === 'number' && (
                  <>
                    <span>•</span>
                    <span>{(jobState.glbByteLength / 1024).toFixed(1)} KB</span>
                  </>
                )}
                {jobState.deduplicatedFromCache && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
                    Cache (0 credit)
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Collapsible 6-Provider Research Comparison Matrix */}
        <div>
          <button
            type="button"
            onClick={() => setShowResearchTable((s) => !s)}
            className="text-[11px] font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 cursor-pointer"
          >
            {showResearchTable ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>Xem bảng đánh giá 6 công nghệ Image-to-3D (Tripo3D, Meshy, Rodin, Hunyuan3D, InstantMesh, TripoSR)</span>
          </button>

          {showResearchTable && capabilities?.evaluatedProviders && (
            <div className="mt-2 overflow-x-auto rounded-xl border border-indigo-200 bg-white">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="p-2 font-bold">Nền tảng</th>
                    <th className="p-2 font-bold">API & Đầu vào</th>
                    <th className="p-2 font-bold">Định dạng & Mesh/Texture</th>
                    <th className="p-2 font-bold">Thời gian & Giá</th>
                    <th className="p-2 font-bold">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {capabilities.evaluatedProviders.map((p) => (
                    <tr key={p.id} className={p.recommended ? 'bg-emerald-50/40' : ''}>
                      <td className="p-2 font-bold text-slate-900 align-top">
                        <div>{p.name}</div>
                        <div className="text-[9px] font-normal text-slate-500 mt-0.5">{p.roleInProject}</div>
                      </td>
                      <td className="p-2 text-slate-700 align-top">
                        <div>{p.apiAvailability}</div>
                        <div className="text-slate-500 mt-0.5">{p.imageInputRequirements}</div>
                      </td>
                      <td className="p-2 text-slate-700 align-top">
                        <div>{p.outputFormats.join(', ')}</div>
                        <div className="text-slate-500 mt-0.5">
                          {p.meshQuality} • {p.textureQuality}
                        </div>
                      </td>
                      <td className="p-2 text-slate-700 align-top">
                        <div>{p.processingTime}</div>
                        <div className="text-slate-500 mt-0.5">{p.pricing}</div>
                        <div className="text-slate-400 mt-0.5">{p.licenseAndRestrictions}</div>
                      </td>
                      <td className="p-2 align-top whitespace-nowrap">
                        {p.configured ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                            Đã cấu hình
                          </span>
                        ) : p.recommended ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                            Cần API Key
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">Tham khảo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
