import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  CheckCircle2,
  AlertTriangle,
  Ruler,
  Wrench,
  Layers,
  Bookmark,
  Share2,
  ChevronLeft,
  ChevronRight,
  Camera,
  Award,
  Check,
  ShieldAlert,
  ShieldCheck,
  Info,
  ClipboardCheck,
  Droplets,
  Sparkles,
  Box,
} from 'lucide-react';
import type { CraftProduct, CraftStep, MaterialItem } from '../../server/db';
import {
  CONCEPT_3D_PREVIEW_DISCLAIMER,
  PROHIBITED_METHODS_NOTICE,
  type CraftPreparationSpec,
  type ExpectedResultSpec,
  type FinalInspectionItem,
  type MaterialReusabilityAnalysis,
} from '../types/recycling';
import type { InteractiveComponent3D } from '../types/assembly';
import { CraftViewer3D } from '../three/CraftViewer3D';

interface InteractiveCraftGuideProps {
  craft: CraftProduct;
  sourceMaterial?: MaterialItem | null;
  availableIdeas?: CraftProduct[];
  reusabilityAnalysis?: MaterialReusabilityAnalysis | null;
  onSelectIdea?: (craft: CraftProduct) => void;
  initialStepIndex?: number;
  focusAssemblySection?: boolean;
  onSaveToProjects: (
    craft: CraftProduct,
    completedStepIndices: number[],
    finishedPhoto?: string | null
  ) => void;
  onPublishToCommunity: (craft: CraftProduct, finishedPhoto?: string | null) => void;
  onBackToRecommendations: () => void;
}

export const InteractiveCraftGuide: React.FC<InteractiveCraftGuideProps> = ({
  craft,
  sourceMaterial = null,
  availableIdeas = [],
  reusabilityAnalysis = null,
  onSelectIdea,
  initialStepIndex = 0,
  focusAssemblySection = false,
  onSaveToProjects,
  onPublishToCommunity,
  onBackToRecommendations,
}) => {
  const safeSteps: CraftStep[] =
    craft.steps && craft.steps.length > 0
      ? craft.steps
      : [
          {
            stepNumber: 1,
            title: 'Chưa cập nhật cách làm chi tiết',
            description:
              'Mục này hiện chưa có danh sách các bước thực hiện. Bạn có thể tự bổ sung hoặc quay lại chọn sản phẩm khác.',
            materialsNeeded: craft.materialsUsed.map((m) => m.name),
            toolsNeeded: craft.toolsRequired,
            highlightPart: 'body',
          },
        ];

  const [currentStepIndex, setCurrentStepIndex] = useState(initialStepIndex);
  const [completedSteps, setCompletedSteps] = useState<number[]>(
    safeSteps.map((s, idx) => (s.isCompleted ? idx : -1)).filter((x) => x !== -1)
  );
  const [checkedInspections, setCheckedInspections] = useState<string[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [userFinishedPhoto, setUserFinishedPhoto] = useState<string | null>(null);
  const [activeGuideTab, setActiveGuideTab] = useState<'steps' | 'prep_materials' | 'result_inspection'>('steps');
  const [selected3DComponent, setSelected3DComponent] = useState<InteractiveComponent3D | null>(null);

  useEffect(() => {
    setCurrentStepIndex(initialStepIndex);
    setCompletedSteps(
      safeSteps.map((s, idx) => (s.isCompleted ? idx : -1)).filter((x) => x !== -1)
    );
    setCheckedInspections([]);
    setIsSaved(false);
    setUserFinishedPhoto(null);
    setSelected3DComponent(null);
  }, [craft.id, initialStepIndex]);

  useEffect(() => {
    if (focusAssemblySection) {
      const el = document.getElementById('craft-assembly-stage');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [focusAssemblySection]);

  const activeStep: CraftStep = safeSteps[currentStepIndex] || safeSteps[0];
  const isAllCompleted = completedSteps.length === safeSteps.length;

  const preparation: CraftPreparationSpec = craft.preparation || {
    hygieneSteps: sourceMaterial?.cleaningInstructions?.length
      ? sourceMaterial.cleaningInstructions
      : [
          'Rửa sạch bụi bẩn bên trong và bên ngoài vật liệu, sau đó lau hoặc phơi khô hoàn toàn.',
          'Kiểm tra vật liệu không còn nứt vỡ hoặc tồn dư hóa chất trước khi thao tác.',
        ],
    sortingAndMarking: [
      'Đối chiếu kích thước thực tế và dùng bút dạ + thước kẻ đánh dấu rõ đường cắt.',
      'Tách riêng các phần tận dụng được (thân, đáy, nắp) theo cấu tạo sản phẩm.',
    ],
    workspaceSetup: [
      'Chuẩn bị bàn làm việc phẳng, đủ ánh sáng, lót bìa cứng bảo vệ mặt bàn.',
      ...(craft.adultSupervisionRequired
        ? ['Đảm bảo có người lớn giám sát trước khi dùng dao rọc giấy, kéo cắt kim loại hoặc keo nến.']
        : []),
    ],
  };

  const expectedResult: ExpectedResultSpec = craft.expectedResult || {
    summary: `Hoàn thiện "${craft.title}" gọn gàng, sạch sẽ từ vật liệu tái chế.`,
    functionalPurpose: craft.whySuitable || craft.description,
    estimatedDimensionsText: `${craft.dimensionsFinished.lengthCm} × ${craft.dimensionsFinished.widthCm} × ${craft.dimensionsFinished.heightCm} cm`,
    durabilityNote: 'Phù hợp sử dụng hằng ngày đúng công năng thiết kế, tránh nguồn nhiệt cao hoặc lửa.',
    previewDisclaimer: CONCEPT_3D_PREVIEW_DISCLAIMER,
  };

  const finalInspection: FinalInspectionItem[] =
    craft.finalInspection && craft.finalInspection.length > 0
      ? craft.finalInspection
      : [
          {
            id: 'insp_edges',
            criterion: 'Mép cắt an toàn, không sắc bén',
            checkMethod: 'Kiểm tra kỹ toàn bộ viền cắt đã được mài nhẵn hoặc bọc băng keo bảo vệ.',
            criticalSafety: true,
          },
          {
            id: 'insp_stability',
            criterion: 'Độ vững chắc & liên kết khớp nối',
            checkMethod: 'Đặt sản phẩm lên mặt phẳng, thử lắc nhẹ xem kết cấu có đứng vững hay không.',
          },
          {
            id: 'insp_clean',
            criterion: 'Sạch sẽ và sẵn sàng sử dụng',
            checkMethod: 'Lau sạch vết bút mực thừa, vụn vật liệu và thử đặt vật dụng mẫu vào kiểm tra.',
          },
        ];

  const safetyNotes =
    craft.safetyNotes && craft.safetyNotes.length > 0
      ? craft.safetyNotes
      : [
          ...(craft.adultSupervisionRequired
            ? ['Cần người lớn giám sát hoặc hỗ trợ trực tiếp ở các bước cắt cứng/dùi lỗ.']
            : []),
          PROHIBITED_METHODS_NOTICE,
        ];

  const toggleStepCompleted = (stepIdx: number) => {
    setCompletedSteps((prev) => {
      const exists = prev.includes(stepIdx);
      let updated: number[];
      if (exists) {
        updated = prev.filter((i) => i !== stepIdx);
      } else {
        updated = [...prev, stepIdx];
        if (updated.length === safeSteps.length) {
          confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
        }
      }
      return updated;
    });
  };

  const toggleInspection = (id: string) => {
    setCheckedInspections((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    onSaveToProjects(craft, completedSteps, userFinishedPhoto);
    setIsSaved(true);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setUserFinishedPhoto(event.target.result as string);
        confetti({ particleCount: 50 });
      }
    };
    reader.readAsDataURL(file);
  };

  const progressPercent = Math.round((completedSteps.length / safeSteps.length) * 100);

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      {/* Top Header & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToRecommendations}
            className="p-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer"
            title="Quay lại danh sách đề xuất"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                HƯỚNG DẪN CHẾ TÁC 6 GIAI ĐOẠN & 3D (PHASE 7)
              </span>
              <span className="text-xs text-slate-600">
                • Độ khó: <strong>{craft.difficulty}</strong> • {craft.estimatedTime} •{' '}
                {craft.recycledMaterialRatio}% Tái chế
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5">
              {craft.title}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaved}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
              isSaved
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 shadow-xs'
            }`}
          >
            <Bookmark className="w-4 h-4 text-emerald-600" />
            <span>{isSaved ? 'Đã lưu dự án' : 'Lưu vào Dự án'}</span>
          </button>

          <button
            onClick={() => onPublishToCommunity(craft, userFinishedPhoto)}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>Chia sẻ Cộng đồng</span>
          </button>
        </div>
      </div>

      {/* Ideas Switcher when multiple ideas are available for the analyzed object */}
      {availableIdeas.length > 1 && onSelectIdea && (
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>Chuyển nhanh giữa các ý tưởng tái chế cho cùng vật liệu ({availableIdeas.length}):</span>
            </span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {availableIdeas.map((idea) => {
              const active = idea.id === craft.id;
              return (
                <button
                  key={idea.id}
                  onClick={() => onSelectIdea(idea)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition border cursor-pointer ${
                    active
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {idea.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Material Reusability & Product Details Summary Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Chi tiết sản phẩm & Lý do phù hợp</span>
            </span>
            <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
              Dự kiến: {craft.dimensionsFinished.lengthCm} × {craft.dimensionsFinished.widthCm} ×{' '}
              {craft.dimensionsFinished.heightCm} cm
            </span>
          </div>
          <p className="text-slate-600 leading-relaxed">{craft.description}</p>
          <p className="text-emerald-800 bg-emerald-50/70 px-3 py-2 rounded-xl border border-emerald-100 font-medium">
            <strong>Phù hợp vì:</strong> {craft.whySuitable}
          </p>

          {reusabilityAnalysis && (
            <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="font-bold text-slate-700 block">Vật liệu gốc & Tình trạng:</span>
                <span className="text-slate-600">
                  {reusabilityAnalysis.materialType} — {reusabilityAnalysis.objectCondition}
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-700 block">Bộ phận tái sử dụng:</span>
                <span className="text-slate-600">
                  {reusabilityAnalysis.reusableComponents.join(', ') || 'Thân chính'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Safety Notes & Supervision Banner */}
        <div className="lg:col-span-5 p-4 rounded-2xl bg-amber-50/80 border border-amber-200 shadow-xs space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-extrabold text-amber-950 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Quy tắc An toàn Thủ công</span>
            </span>
            {craft.adultSupervisionRequired && (
              <span className="px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-bold">
                Cần người lớn giám sát
              </span>
            )}
          </div>
          <ul className="space-y-1 text-[11px] text-amber-950">
            {safetyNotes.slice(0, 3).map((note, idx) => (
              <li key={idx} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Main 3D Concept Preview + 6-Stage Interactive Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: 3D Concept Preview & Step Timeline (7 Cols) */}
        <div
          id="craft-assembly-stage"
          className={`lg:col-span-7 space-y-4 transition rounded-2xl ${
            focusAssemblySection ? 'ring-2 ring-emerald-500/40 p-2 bg-emerald-50/30' : ''
          }`}
        >
          <div className="p-3 rounded-2xl bg-indigo-50/80 border border-indigo-200 text-xs text-indigo-950 flex items-start gap-2">
            <Box className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block">Mô hình 3D minh họa & Tương tác lắp ráp các bộ phận</span>
              <span className="text-[11px] text-indigo-900">{CONCEPT_3D_PREVIEW_DISCLAIMER}</span>
            </div>
          </div>

          <CraftViewer3D
            craft={craft}
            sourceMaterial={sourceMaterial}
            currentStepIndex={currentStepIndex}
            onStepChange={setCurrentStepIndex}
            activeGuideStep={activeStep}
            onComponentSelect={setSelected3DComponent}
            height="480px"
          />

          {selected3DComponent && (
            <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 text-xs text-sky-950 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-extrabold block truncate">
                  Đang chọn trên 3D: {selected3DComponent.name}
                </span>
                <span className="text-[11px] text-sky-800 block truncate">
                  {selected3DComponent.connectionInfo}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected3DComponent(null)}
                className="px-2 py-1 rounded-lg bg-white border border-sky-200 text-[10px] font-bold text-sky-800 cursor-pointer shrink-0"
              >
                Đóng
              </button>
            </div>
          )}

          {/* Step Timeline */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-700">
                Tiến độ thực hiện: {completedSteps.length} / {safeSteps.length} bước hoàn tất
              </span>
              <span className="text-emerald-700 font-bold">{progressPercent}%</span>
            </div>

            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between gap-1 overflow-x-auto no-scrollbar pt-1">
              {safeSteps.map((step, idx) => {
                const isActive = idx === currentStepIndex;
                const isDone = completedSteps.includes(idx);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveGuideTab('steps');
                      setCurrentStepIndex(idx);
                    }}
                    className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-xl text-center text-xs font-bold transition border cursor-pointer ${
                      isActive
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : isDone
                        ? 'border-slate-200 bg-emerald-500/10 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {isDone && <Check className="w-3 h-3 text-emerald-600" />}
                      <span>Bước {idx + 1}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Structured 6-Stage Guide Workspace (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* 6-Stage Section Switcher */}
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 border border-slate-200 text-xs font-bold">
            <button
              onClick={() => setActiveGuideTab('prep_materials')}
              className={`py-2 px-2 rounded-xl transition cursor-pointer ${
                activeGuideTab === 'prep_materials'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              1–3. Chuẩn bị & Đồ dùng
            </button>
            <button
              onClick={() => setActiveGuideTab('steps')}
              className={`py-2 px-2 rounded-xl transition cursor-pointer ${
                activeGuideTab === 'steps'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              4. Từng bước ({currentStepIndex + 1}/{safeSteps.length})
            </button>
            <button
              onClick={() => setActiveGuideTab('result_inspection')}
              className={`py-2 px-2 rounded-xl transition cursor-pointer ${
                activeGuideTab === 'result_inspection'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              5–6. Kết quả & Kiểm tra
            </button>
          </div>

          {/* TAB A: Stages 1-3 (Preparation, Required Materials, Required Tools) */}
          {activeGuideTab === 'prep_materials' && (
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-5 text-xs">
              {/* 1. Preparation */}
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Droplets className="w-4 h-4 text-sky-600" />
                  <span>1. Giai đoạn Chuẩn bị (Preparation)</span>
                </h3>
                <div className="space-y-2 bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                  <div>
                    <span className="font-bold text-slate-700 block mb-0.5">Vệ sinh & phân loại:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                      {preparation.hygieneSteps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="font-bold text-slate-700 block mb-0.5">Đo vẽ & đánh dấu:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                      {preparation.sortingAndMarking.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="font-bold text-slate-700 block mb-0.5">Không gian thao tác:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                      {preparation.workspaceSetup.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* 2. Required Materials */}
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span>2. Vật liệu cần dùng (Required Materials)</span>
                </h3>
                <div className="space-y-1.5">
                  {craft.materialsUsed.map((m, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100 flex items-center justify-between gap-2"
                    >
                      <span className="font-bold text-emerald-950">{m.name}</span>
                      <span className="text-[11px] text-emerald-700">{m.role}</span>
                    </div>
                  ))}
                  {craft.materialsNeededExtra.map((ex, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-indigo-950 block">{ex.name}</span>
                        <span className="text-[11px] text-indigo-700">{ex.purpose}</span>
                      </div>
                      <span className="text-[11px] font-bold text-indigo-800 shrink-0">
                        ~{ex.estimatedCostVnd.toLocaleString('vi-VN')} đ
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Required Tools */}
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-slate-700" />
                  <span>3. Dụng cụ thủ công an toàn (Required Tools)</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {craft.toolsRequired.map((tool, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 font-semibold text-[11px]"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setActiveGuideTab('steps')}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer"
              >
                Bắt đầu Sang Giai đoạn 4: Thực hiện từng bước →
              </button>
            </div>
          )}

          {/* TAB B: Stage 4 (Interactive Step-by-Step Instructions) */}
          {activeGuideTab === 'steps' && (
            <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-5">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded-md">
                      BƯỚC {activeStep.stepNumber} / {safeSteps.length}
                    </span>
                    {activeStep.needsAdultSupervision && (
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                        Cần người lớn hỗ trợ
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-900 leading-snug">
                    {activeStep.title}
                  </h3>
                </div>

                <button
                  onClick={() => toggleStepCompleted(currentStepIndex)}
                  className={`p-2 rounded-xl border flex items-center gap-1.5 text-xs font-bold transition shrink-0 cursor-pointer ${
                    completedSteps.includes(currentStepIndex)
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {completedSteps.includes(currentStepIndex) ? 'Đã xong' : 'Đánh dấu xong'}
                  </span>
                </button>
              </div>

              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed bg-slate-50/80 p-3.5 rounded-2xl border border-slate-100">
                {activeStep.description}
              </p>

              <div className="space-y-3 pt-1 text-xs">
                {activeStep.materialsNeeded && activeStep.materialsNeeded.length > 0 && (
                  <div className="space-y-1">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Vật liệu cho bước này:</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {activeStep.materialsNeeded.map((m, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 font-medium"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {activeStep.toolsNeeded && activeStep.toolsNeeded.length > 0 && (
                  <div className="space-y-1">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-slate-600" />
                      <span>Dụng cụ bước này:</span>
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {activeStep.toolsNeeded.map((t, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {activeStep.dimensionsNotice && (
                  <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 text-blue-900 flex items-start gap-2">
                    <Ruler className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Kích thước chú ý:</span>
                      <span>{activeStep.dimensionsNotice}</span>
                    </div>
                  </div>
                )}

                {activeStep.safetyWarning && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Lưu ý an toàn:</span>
                      <span>{activeStep.safetyWarning}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  disabled={currentStepIndex === 0}
                  onClick={() => setCurrentStepIndex((prev) => Math.max(0, prev - 1))}
                  className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-30 text-xs font-bold text-slate-700 flex items-center gap-1 transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Bước trước</span>
                </button>

                {currentStepIndex < safeSteps.length - 1 ? (
                  <button
                    onClick={() =>
                      setCurrentStepIndex((prev) => Math.min(safeSteps.length - 1, prev + 1))
                    }
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs transition cursor-pointer"
                  >
                    <span>Bước tiếp theo</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setActiveGuideTab('result_inspection')}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1 shadow-xs transition cursor-pointer"
                  >
                    <span>Sang Kiểm tra hoàn thiện</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* TAB C: Stages 5-6 (Expected Result & Final Inspection Checklist) */}
          {activeGuideTab === 'result_inspection' && (
            <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-xs space-y-5 text-xs">
              {/* 5. Expected Result */}
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>5. Kết quả dự kiến (Expected Result)</span>
                </h3>
                <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-100 space-y-1.5 text-slate-700">
                  <p className="font-semibold text-slate-900">{expectedResult.summary}</p>
                  <p>
                    <strong>Công năng:</strong> {expectedResult.functionalPurpose}
                  </p>
                  <p>
                    <strong>Kích thước ước tính:</strong> {expectedResult.estimatedDimensionsText}
                  </p>
                  <p>
                    <strong>Độ bền & sử dụng:</strong> {expectedResult.durabilityNote}
                  </p>
                  <p className="text-[11px] text-indigo-800 bg-white/80 p-2 rounded-xl border border-indigo-100 flex items-start gap-1.5 mt-1">
                    <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
                    <span>{expectedResult.previewDisclaimer}</span>
                  </p>
                </div>
              </div>

              {/* 6. Final Inspection Checklist */}
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-indigo-600" />
                  <span>
                    6. Kiểm tra hoàn thiện ({checkedInspections.length}/{finalInspection.length})
                  </span>
                </h3>
                <div className="space-y-2">
                  {finalInspection.map((item) => {
                    const checked = checkedInspections.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleInspection(item.id)}
                        className={`w-full text-left p-3 rounded-2xl border transition flex items-start gap-2.5 cursor-pointer ${
                          checked
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 border ${
                            checked
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'bg-white border-slate-300'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <div className="space-y-0.5">
                          <div className="font-bold flex items-center gap-1.5">
                            <span>{item.criterion}</span>
                            {item.criticalSafety && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">
                                Quan trọng
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600">{item.checkMethod}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Completion Milestone Card */}
          {isAllCompleted && (
            <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center font-bold">
                  <Award className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h4 className="font-black text-base">Hoàn thành tất cả công đoạn!</h4>
                  <p className="text-xs text-emerald-100">
                    Hãy kiểm tra lại mục "6. Kiểm tra hoàn thiện" và chụp ảnh thành phẩm thật của bạn.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/10 border border-white/20 space-y-2">
                <span className="text-xs font-bold block">Tải ảnh sản phẩm thực tế sau khi làm:</span>
                {userFinishedPhoto ? (
                  <div className="relative rounded-xl overflow-hidden aspect-video">
                    <img
                      src={userFinishedPhoto}
                      alt="Thành quả thực tế của bạn"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-md">
                      Ảnh sản phẩm thật của bạn
                    </span>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-white/40 hover:bg-white/10 cursor-pointer text-xs font-semibold transition">
                    <Camera className="w-4 h-4" />
                    <span>Chọn ảnh thành phẩm thực tế</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoUpload}
                    />
                  </label>
                )}
              </div>

              <button
                onClick={() => onPublishToCommunity(craft, userFinishedPhoto)}
                className="w-full py-2.5 rounded-xl bg-white text-emerald-800 font-extrabold text-xs shadow-sm hover:bg-emerald-50 transition cursor-pointer"
              >
                Đăng lên Cộng Đồng Sáng Tạo Ngay
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
