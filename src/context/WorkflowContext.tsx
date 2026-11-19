import React, { createContext, useContext, useState } from 'react';
import type { MaterialItem, CraftProduct } from '../../server/db';
import type { AnalysisResult } from '../../server/gemini';
import type {
  CapturedViewEntry,
  MeasurementMethod,
  ReferenceObjectType,
} from '../types/reconstruction';
import type {
  MaterialReusabilityAnalysis,
  SafetyComplianceReport,
} from '../types/recycling';
import {
  DEFAULT_QUALITY_THRESHOLDS,
  type ImageQualityReport,
  type QualityThresholdsConfig,
} from '../vision/imageQuality';
import type { ReferenceLinePx } from '../components/scan/ObjectCropSelector';

export type WizardStepId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type WorkflowStageId =
  | 'capture'
  | 'select'
  | 'analyze'
  | 'model3d'
  | 'ideas'
  | 'instructions'
  | 'assembly';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncTaskState<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  updatedAt: number | null;
}

export function createIdleTask<T>(initialData: T | null = null): AsyncTaskState<T> {
  return {
    status: initialData ? 'success' : 'idle',
    data: initialData,
    error: null,
    updatedAt: initialData ? Date.now() : null,
  };
}

export interface LocalAdvisorState {
  reusability: MaterialReusabilityAnalysis;
  group100Percent: CraftProduct[];
  groupWithAddedMaterials: CraftProduct[];
  safetyCompliance: SafetyComplianceReport;
}

export interface WorkflowStageDescriptor {
  id: WorkflowStageId;
  order: number;
  label: string;
  shortLabel: string;
  description: string;
}

export const WORKFLOW_STAGES: WorkflowStageDescriptor[] = [
  {
    id: 'capture',
    order: 1,
    label: '1. Chụp ảnh',
    shortLabel: 'Chụp ảnh',
    description: 'Chụp hoặc tải ảnh nơi trống trải, đủ sáng',
  },
  {
    id: 'select',
    order: 2,
    label: '2. Chọn vật thể',
    shortLabel: 'Chọn vùng',
    description: 'Khoanh bounding box, kiểm tra nét & tách nền',
  },
  {
    id: 'analyze',
    order: 3,
    label: '3. Phân tích vật liệu',
    shortLabel: 'Phân tích AI',
    description: 'Nhận diện vật liệu, an toàn & kích thước thực',
  },
  {
    id: 'model3d',
    order: 4,
    label: '4. Dựng 3D',
    shortLabel: 'Mô hình 3D',
    description: 'Dựng hình học 3D đa bộ phận & kiểm chứng GLB',
  },
  {
    id: 'ideas',
    order: 5,
    label: '5. Chọn ý tưởng',
    shortLabel: 'Ý tưởng',
    description: 'Đánh giá tái sử dụng & chọn sản phẩm phù hợp',
  },
  {
    id: 'instructions',
    order: 6,
    label: '6. Xem hướng dẫn',
    shortLabel: 'Hướng dẫn',
    description: 'Quy trình chế tạo an toàn 6 giai đoạn',
  },
  {
    id: 'assembly',
    order: 7,
    label: '7. Tương tác lắp ráp',
    shortLabel: 'Lắp ráp 3D',
    description: 'Tách bộ phận & mô phỏng lắp ráp 3D tương tác',
  },
];

export interface WorkflowProgressInput {
  activeTab: string;
  wizardStep: WizardStepId;
  viewsCount: number;
  hasConfirmedMaterial: boolean;
  hasIdeas: boolean;
  hasActiveCraft: boolean;
  isAssemblyFocused: boolean;
}

/**
 * Pure helper computing current active workflow stage and unlocked navigation state.
 */
export function resolveActiveWorkflowStage(input: WorkflowProgressInput): WorkflowStageId {
  if (input.activeTab === 'guide' && input.hasActiveCraft) {
    return input.isAssemblyFocused ? 'assembly' : 'instructions';
  }
  if (input.hasIdeas && input.wizardStep >= 8) {
    return 'ideas';
  }
  if (input.hasConfirmedMaterial && input.wizardStep >= 8) {
    return 'model3d';
  }
  if (input.wizardStep >= 6 && input.wizardStep <= 7) {
    return 'analyze';
  }
  if (input.wizardStep >= 3 && input.wizardStep <= 5) {
    return 'select';
  }
  return 'capture';
}

export function isWorkflowStageUnlocked(
  stage: WorkflowStageId,
  input: WorkflowProgressInput
): boolean {
  switch (stage) {
    case 'capture':
      return true;
    case 'select':
      return input.viewsCount > 0;
    case 'analyze':
      return input.viewsCount > 0 || input.hasConfirmedMaterial;
    case 'model3d':
      return input.hasConfirmedMaterial;
    case 'ideas':
      return input.hasConfirmedMaterial && input.hasIdeas;
    case 'instructions':
    case 'assembly':
      return input.hasActiveCraft;
  }
}

interface WorkflowContextValue {
  // Capture & Segmentation persistent state (preserved across backward navigation)
  wizardStep: WizardStepId;
  setWizardStep: React.Dispatch<React.SetStateAction<WizardStepId>>;
  categoryHint: 'plastic' | 'paper' | 'metal' | 'fabric';
  setCategoryHint: React.Dispatch<React.SetStateAction<'plastic' | 'paper' | 'metal' | 'fabric'>>;
  views: CapturedViewEntry[];
  setViews: React.Dispatch<React.SetStateAction<CapturedViewEntry[]>>;
  activeViewIdx: number;
  setActiveViewIdx: React.Dispatch<React.SetStateAction<number>>;
  referenceType: ReferenceObjectType;
  setReferenceType: React.Dispatch<React.SetStateAction<ReferenceObjectType>>;
  referenceDescription: string;
  setReferenceDescription: React.Dispatch<React.SetStateAction<string>>;
  referenceLine: ReferenceLinePx | null;
  setReferenceLine: React.Dispatch<React.SetStateAction<ReferenceLinePx | null>>;
  qualityReportsByView: Record<string, ImageQualityReport>;
  setQualityReportsByView: React.Dispatch<React.SetStateAction<Record<string, ImageQualityReport>>>;
  qualityThresholds: QualityThresholdsConfig;
  setQualityThresholds: React.Dispatch<React.SetStateAction<QualityThresholdsConfig>>;
  manualHeightCm: number;
  setManualHeightCm: React.Dispatch<React.SetStateAction<number>>;
  manualWidthCm: number;
  setManualWidthCm: React.Dispatch<React.SetStateAction<number>>;
  manualDepthCm: number;
  setManualDepthCm: React.Dispatch<React.SetStateAction<number>>;
  calibratedConf: number;
  setCalibratedConf: React.Dispatch<React.SetStateAction<number>>;
  measurementMethod: MeasurementMethod;
  setMeasurementMethod: React.Dispatch<React.SetStateAction<MeasurementMethod>>;
  focusOnSelection: boolean;
  setFocusOnSelection: React.Dispatch<React.SetStateAction<boolean>>;
  userConfirmedSubmission: boolean;
  setUserConfirmedSubmission: React.Dispatch<React.SetStateAction<boolean>>;
  userNotes: string;
  setUserNotes: React.Dispatch<React.SetStateAction<string>>;
  aiEngine: 'gemini' | 'chatgpt' | 'dual';
  setAiEngine: React.Dispatch<React.SetStateAction<'gemini' | 'chatgpt' | 'dual'>>;
  isSavedToInventory: boolean;
  setIsSavedToInventory: React.Dispatch<React.SetStateAction<boolean>>;

  // Analysis, 3D Reconstruction & Craft Guide states
  analysisTask: AsyncTaskState<AnalysisResult>;
  setAnalysisTask: React.Dispatch<React.SetStateAction<AsyncTaskState<AnalysisResult>>>;
  ideasTask: AsyncTaskState<LocalAdvisorState>;
  setIdeasTask: React.Dispatch<React.SetStateAction<AsyncTaskState<LocalAdvisorState>>>;
  confirmedMaterial: MaterialItem | null;
  setConfirmedMaterial: React.Dispatch<React.SetStateAction<MaterialItem | null>>;
  activeCraftForGuide: CraftProduct | null;
  setActiveCraftForGuide: React.Dispatch<React.SetStateAction<CraftProduct | null>>;
  activeProjectResumeIndex: number;
  setActiveProjectResumeIndex: React.Dispatch<React.SetStateAction<number>>;
  activeProjectId: string | null;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  isAssemblyFocused: boolean;
  setIsAssemblyFocused: React.Dispatch<React.SetStateAction<boolean>>;

  resetScanWorkflow: () => void;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export const WorkflowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [wizardStep, setWizardStep] = useState<WizardStepId>(1);
  const [categoryHint, setCategoryHint] = useState<'plastic' | 'paper' | 'metal' | 'fabric'>('plastic');
  const [views, setViews] = useState<CapturedViewEntry[]>([]);
  const [activeViewIdx, setActiveViewIdx] = useState<number>(0);

  const [referenceType, setReferenceType] = useState<ReferenceObjectType>('credit_card_85mm');
  const [referenceDescription, setReferenceDescription] = useState('');
  const [referenceLine, setReferenceLine] = useState<ReferenceLinePx | null>(null);

  const [qualityReportsByView, setQualityReportsByView] = useState<
    Record<string, ImageQualityReport>
  >({});
  const [qualityThresholds, setQualityThresholds] = useState<QualityThresholdsConfig>({
    ...DEFAULT_QUALITY_THRESHOLDS,
  });

  const [manualHeightCm, setManualHeightCm] = useState<number>(21);
  const [manualWidthCm, setManualWidthCm] = useState<number>(6.8);
  const [manualDepthCm, setManualDepthCm] = useState<number>(6.8);
  const [calibratedConf, setCalibratedConf] = useState<number>(0.72);
  const [measurementMethod, setMeasurementMethod] = useState<MeasurementMethod>('user_input');

  const [focusOnSelection, setFocusOnSelection] = useState<boolean>(true);
  const [userConfirmedSubmission, setUserConfirmedSubmission] = useState<boolean>(false);
  const [userNotes, setUserNotes] = useState('');
  const [aiEngine, setAiEngine] = useState<'gemini' | 'chatgpt' | 'dual'>('gemini');
  const [isSavedToInventory, setIsSavedToInventory] = useState<boolean>(false);

  const [analysisTask, setAnalysisTask] = useState<AsyncTaskState<AnalysisResult>>(() =>
    createIdleTask<AnalysisResult>()
  );
  const [ideasTask, setIdeasTask] = useState<AsyncTaskState<LocalAdvisorState>>(() =>
    createIdleTask<LocalAdvisorState>()
  );
  const [confirmedMaterial, setConfirmedMaterial] = useState<MaterialItem | null>(null);

  const [activeCraftForGuide, setActiveCraftForGuide] = useState<CraftProduct | null>(null);
  const [activeProjectResumeIndex, setActiveProjectResumeIndex] = useState<number>(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isAssemblyFocused, setIsAssemblyFocused] = useState<boolean>(false);

  const resetScanWorkflow = () => {
    setWizardStep(1);
    setViews([]);
    setActiveViewIdx(0);
    setReferenceLine(null);
    setQualityReportsByView({});
    setUserConfirmedSubmission(false);
    setIsSavedToInventory(false);
    setUserNotes('');
    setAnalysisTask(createIdleTask<AnalysisResult>());
    setIdeasTask(createIdleTask<LocalAdvisorState>());
    setConfirmedMaterial(null);
    setActiveCraftForGuide(null);
    setIsAssemblyFocused(false);
  };

  return (
    <WorkflowContext.Provider
      value={{
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
        analysisTask,
        setAnalysisTask,
        ideasTask,
        setIdeasTask,
        confirmedMaterial,
        setConfirmedMaterial,
        activeCraftForGuide,
        setActiveCraftForGuide,
        activeProjectResumeIndex,
        setActiveProjectResumeIndex,
        activeProjectId,
        setActiveProjectId,
        isAssemblyFocused,
        setIsAssemblyFocused,
        resetScanWorkflow,
      }}
    >
      {children}
    </WorkflowContext.Provider>
  );
};

export function useWorkflow() {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    throw new Error('useWorkflow must be used inside <WorkflowProvider>');
  }
  return ctx;
}
