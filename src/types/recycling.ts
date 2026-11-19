// Phase 7: Material Reusability Analysis, Safety Filtering & 6-Stage Craft Guide Types

export type CraftingSuitabilityStatus =
  | 'suitable'
  | 'conditional'
  | 'insufficient_data'
  | 'unsafe';

export interface MaterialReusabilityAnalysis {
  materialType: string;
  materialCategory: string;
  materialConfidence: number; // 0..1
  objectCondition: string;
  reusableComponents: string[];
  materialLimitations: string[];
  suitabilityForManualCrafting: CraftingSuitabilityStatus;
  suitabilityLabel: string;
  suitabilitySummary: string;
  missingInformation: string[]; // Populated honestly when data is insufficient
  recommendedSafeActions: string[];
  requiresAdultSupervision: boolean;
}

export interface CraftPreparationSpec {
  hygieneSteps: string[];
  sortingAndMarking: string[];
  workspaceSetup: string[];
}

export interface ExpectedResultSpec {
  summary: string;
  functionalPurpose: string;
  estimatedDimensionsText: string;
  durabilityNote: string;
  previewDisclaimer: string;
}

export interface FinalInspectionItem {
  id: string;
  criterion: string;
  checkMethod: string;
  criticalSafety?: boolean;
}

export interface SafetyComplianceReport {
  isSafe: boolean;
  requiresAdultSupervision: boolean;
  blockedHazards: string[];
  safetyNotes: string[];
  prohibitedMethodsReminder: string;
}

export interface RecyclingAdvisorInput {
  materialName?: string;
  category?: string;
  materialDetail?: string;
  materialConfidence?: number;
  status?: string;
  condition?: string;
  dimensions?: {
    shapeType?: string;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
    diameterCm?: number;
  };
  deformations?: string[];
  components?: Array<{ name: string; role: string }>;
  uncertainties?: string[];
  userNotes?: string;
  allowAi?: boolean;
}

export const CONCEPT_3D_PREVIEW_DISCLAIMER =
  'Mô hình 3D này là bản mô phỏng ý tưởng dự kiến và cấu tạo từng bộ phận để bạn tham khảo trước khi làm, không phải ảnh chụp của sản phẩm thủ công đã được tạo ra ngoài thực tế.';

export const PROHIBITED_METHODS_NOTICE =
  'Chỉ áp dụng phương pháp thủ công an toàn. Tuyệt đối không đốt hoặc nung chảy nhựa, không dùng axit hay dung môi hóa chất độc hại, không tự ý đập/cắt kính dày hoặc tháo dỡ pin/linh kiện điện tử.';
