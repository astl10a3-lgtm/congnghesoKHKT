import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  Navbar,
  ActiveTab
} from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { WorkflowStepper } from './components/WorkflowStepper';
import { LoadingState, ErrorBanner } from './components/ui/StatusFeedback';
import { BackgroundLayout } from './components/layout/BackgroundLayout';

const MaterialCapture = lazy(() =>
  import('./components/MaterialCapture').then((m) => ({ default: m.MaterialCapture }))
);
const ClassificationSafetyCard = lazy(() =>
  import('./components/ClassificationSafetyCard').then((m) => ({ default: m.ClassificationSafetyCard }))
);
const GeometryCalculatorCard = lazy(() =>
  import('./components/GeometryCalculatorCard').then((m) => ({ default: m.GeometryCalculatorCard }))
);
const MaterialScanner3D = lazy(() =>
  import('./three/MaterialScanner3D').then((m) => ({ default: m.MaterialScanner3D }))
);
const CraftRecommendationList = lazy(() =>
  import('./components/CraftRecommendationList').then((m) => ({ default: m.CraftRecommendationList }))
);
const InteractiveCraftGuide = lazy(() =>
  import('./components/InteractiveCraftGuide').then((m) => ({ default: m.InteractiveCraftGuide }))
);
const MaterialInventory = lazy(() =>
  import('./components/MaterialInventory').then((m) => ({ default: m.MaterialInventory }))
);
const MyProjectsView = lazy(() =>
  import('./components/MyProjectsView').then((m) => ({ default: m.MyProjectsView }))
);
const CommunityView = lazy(() =>
  import('./components/CommunityView').then((m) => ({ default: m.CommunityView }))
);
const SavedIdeasView = lazy(() =>
  import('./components/SavedIdeasView').then((m) => ({ default: m.SavedIdeasView }))
);
const UserProfileModal = lazy(() =>
  import('./components/UserProfileModal').then((m) => ({ default: m.UserProfileModal }))
);
const CommunityDetailModal = lazy(() =>
  import('./components/CommunityDetailModal').then((m) => ({ default: m.CommunityDetailModal }))
);
const AuthModal = lazy(() =>
  import('./components/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const AdminAccountsView = lazy(() =>
  import('./components/AdminAccountsView').then((m) => ({ default: m.AdminAccountsView }))
);
import { AuthGateScreen } from './components/AuthModal';
import { apiFetch, getStoredAuthToken, setStoredAuthToken } from './lib/apiClient';
import {
  useWorkflow,
  createIdleTask,
  type LocalAdvisorState,
  type WorkflowStageId,
} from './context/WorkflowContext';
import type {
  MaterialItem,
  CraftProduct,
  UserProject,
  CommunityPost,
} from '../server/db';
import type { AuthUser } from './types/account';
import type { AnalysisInput, AnalysisResult } from '../server/gemini';
import type {
  ContourPoint,
  MeasurementMethod,
  NormalizedBoundingBox,
  ProfilePoint,
  ReconstructionResult,
} from './types/reconstruction';
import { Sparkles } from 'lucide-react';

export default function App() {
  const {
    setWizardStep,
    views,
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
  } = useWorkflow();

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean>(true);
  const [hasSamEndpoint, setHasSamEndpoint] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [showProfileModal, setShowProfileModal] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  // Core Data Lists
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [savedPosts, setSavedPosts] = useState<CommunityPost[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [isLocalReconstructing, setIsLocalReconstructing] = useState<boolean>(false);
  const [deepLinkIdeaId, setDeepLinkIdeaId] = useState<string | null>(null);

  // Notification / Toast Message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const analysisResult = analysisTask.data;
  const isAnalyzing = analysisTask.status === 'loading' || isLocalReconstructing;
  const analysisError = analysisTask.error;
  const localAdvisorResult = ideasTask.data;
  const isGeneratingIdeas = ideasTask.status === 'loading';
  const ideasError = ideasTask.error;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadInitialWorkspace = async () => {
    setIsInitialLoading(true);
    setInitialLoadError(null);
    const results = await Promise.allSettled([
      fetchApiStatus(),
      fetchInventory(),
      fetchProjects(),
      fetchCommunity(),
      fetchSavedIdeas(),
    ]);
    const coreFailed = results.slice(1, 4).every((r) => r.status === 'rejected');
    if (coreFailed) {
      setInitialLoadError('Không thể tải dữ liệu kho vật liệu, dự án và cộng đồng từ máy chủ.');
    }
    setIsInitialLoading(false);
  };

  // Auto-logout on page open/refresh & parse optional ?idea= deep link
  useEffect(() => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setUserProfile(null);
    void fetchApiStatus().catch(() => {});

    try {
      const params = new URLSearchParams(window.location.search);
      const ideaId = params.get('idea');
      if (ideaId) {
        setDeepLinkIdeaId(ideaId);
        setActiveTab('community');
      }
    } catch {
      // Ignore invalid URL
    }
  }, []);

  const fetchApiStatus = async () => {
    const data = await apiFetch('/api/status', { timeoutMs: 12000 });
    setHasGeminiKey(Boolean(data.hasGeminiApiKey));
    setHasSamEndpoint(Boolean(data.hasSamEndpoint));
  };

  const refreshCurrentUserProfile = async () => {
    if (!getStoredAuthToken()) return;
    try {
      const me = await apiFetch<{ success: boolean; user: AuthUser }>('/api/auth/me', {
        timeoutMs: 12000,
      });
      if (me.success && me.user) {
        setUserProfile(me.user);
      }
    } catch {
      // Ignore silent refresh failure
    }
  };

  const handleAuthSuccess = async (loggedInUser: AuthUser) => {
    setUserProfile(loggedInUser);
    setIsAuthenticated(true);
    setShowAuthModal(false);
    showToast(
      loggedInUser.role === 'admin'
        ? `Đã đăng nhập Admin @${loggedInUser.username}`
        : `Chào mừng ${loggedInUser.name}!`
    );
    if (loggedInUser.role === 'admin') {
      setActiveTab('admin');
    } else if (activeTab === 'admin') {
      setActiveTab('home');
    }
    await loadInitialWorkspace();
  };

  const handleLogout = async () => {
    setStoredAuthToken(null);
    setIsAuthenticated(false);
    setUserProfile(null);
    setShowProfileModal(false);
    setShowAuthModal(false);
    setProjects([]);
    setSavedPosts([]);
    setActiveTab('home');
    showToast('Đã đăng xuất tài khoản.');
  };

  const fetchInventory = async () => {
    const data = await apiFetch<{ success: boolean; data: MaterialItem[] }>('/api/inventory', {
      timeoutMs: 12000,
    });
    if (data.success) setMaterials(data.data);
  };

  const fetchProjects = async () => {
    const data = await apiFetch<{ success: boolean; data: UserProject[] }>('/api/projects', {
      timeoutMs: 12000,
    });
    if (data.success) setProjects(data.data);
  };

  const fetchCommunity = async () => {
    const data = await apiFetch<{ success: boolean; data: CommunityPost[] }>('/api/community', {
      timeoutMs: 12000,
    });
    if (data.success) setCommunityPosts(data.data);
  };

  const fetchSavedIdeas = async () => {
    const data = await apiFetch<{ success: boolean; data: CommunityPost[] }>('/api/saved-ideas', {
      timeoutMs: 12000,
    });
    if (data.success) setSavedPosts(data.data);
  };

  const fetchPhase7IdeasForMaterial = async (mat: MaterialItem) => {
    setIdeasTask({
      status: 'loading',
      data: ideasTask.data,
      error: null,
      updatedAt: Date.now(),
    });
    try {
      const json = await apiFetch<{ success: boolean; data: LocalAdvisorState }>(
        '/api/recycling-ideas',
        {
          method: 'POST',
          deduplicateKey: `ideas:${mat.id}:${mat.name}`,
          timeoutMs: 30000,
          body: JSON.stringify({
            material: mat,
            reconstruction: mat.reconstruction,
            userNotes: mat.condition,
          }),
        }
      );
      if (json.success && json.data) {
        setIdeasTask({
          status: 'success',
          data: json.data,
          error: null,
          updatedAt: Date.now(),
        });
      }
    } catch (err: any) {
      setIdeasTask({
        status: 'error',
        data: ideasTask.data,
        error: err?.message || 'Không thể tạo ý tưởng tái chế cho vật liệu này.',
        updatedAt: Date.now(),
      });
    }
  };

  // Handle Multimodal Analysis Call
  const handleStartAnalysis = async (input: AnalysisInput): Promise<boolean> => {
    setAnalysisTask({
      status: 'loading',
      data: null,
      error: null,
      updatedAt: Date.now(),
    });
    setIdeasTask(createIdleTask<LocalAdvisorState>());
    setConfirmedMaterial(null);

    try {
      const json = await apiFetch<{ success: boolean; data: AnalysisResult }>(
        '/api/analyze-materials',
        {
          method: 'POST',
          timeoutMs: 65000,
          body: JSON.stringify(input),
        }
      );

      setAnalysisTask({
        status: 'success',
        data: json.data,
        error: null,
        updatedAt: Date.now(),
      });
      setConfirmedMaterial(json.data.material);
      showToast('AI Vision đã phân tích vật liệu và dựng 3D thành công!');
      return true;
    } catch (err: any) {
      console.error('Error analyzing materials:', err);
      const msg = err?.message || 'Không thể kết nối AI Vision';
      setAnalysisTask({
        status: 'error',
        data: null,
        error: msg,
        updatedAt: Date.now(),
      });
      showToast('Lỗi AI: ' + msg);
      return false;
    }
  };

  // Offline CV + Parametric 3D reconstruction via /api/estimate-geometry (works without GEMINI_API_KEY)
  const handleLocalGeometryReconstruction = async (payload: {
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
  }): Promise<MaterialItem | null> => {
    setIsLocalReconstructing(true);
    try {
      const shapeType =
        payload.category === 'paper'
          ? 'box'
          : payload.category === 'fabric'
          ? 'irregular_solid'
          : 'cylinder';
      const geometryType =
        payload.category === 'paper'
          ? 'box'
          : payload.category === 'fabric'
          ? 'irregular'
          : 'lathe';

      const json = await apiFetch('/api/estimate-geometry', {
        method: 'POST',
        timeoutMs: 30000,
        body: JSON.stringify({
          materialName: payload.materialName,
          category: payload.category,
          shapeType,
          geometryType,
          heightCm: payload.heightCm,
          widthCm: payload.widthCm,
          depthCm: payload.depthCm,
          silhouetteProfile: payload.silhouetteProfile,
          contourPoints: payload.contourPoints,
          measurementMethod: payload.measurementMethod,
          confidence: payload.confidence,
          boundingBox: payload.boundingBox || null,
          maskUrl: payload.maskUrl || null,
          croppedObjectUrl: payload.croppedObjectUrl || null,
          processedImageUrl: payload.processedImageUrl || null,
          imageQualityScore: payload.imageQualityScore,
          multiViewConsistency: payload.multiViewConsistency,
        }),
      });

      const recon: ReconstructionResult = {
        ...json.data.reconstruction,
        segmentation: {
          boundingBox: payload.boundingBox || null,
          maskUrl: payload.maskUrl || null,
          croppedObjectUrl: payload.croppedObjectUrl || null,
          processedImageUrl: payload.processedImageUrl || payload.images[0] || null,
        },
      };

      const catLabels: Record<MaterialItem['category'], string> = {
        plastic: 'Rác thải nhựa',
        paper: 'Rác thải giấy & carton',
        metal: 'Rác thải kim loại',
        glass: 'Rác thải thủy tinh',
        fabric: 'Vải & Dệt may',
        organic: 'Rác thải hữu cơ',
        electronic: 'Rác thải điện tử',
        other: 'Rác thải khác',
      };

      const localMaterial: MaterialItem = {
        id: `local_mat_${Date.now()}`,
        name: payload.materialName,
        category: payload.category,
        categoryLabel: catLabels[payload.category],
        recycleCode: recon.object.material,
        quantity: 1,
        unit: 'cái',
        condition: payload.userNotes || 'Đã phân đoạn tách nền & hiệu chuẩn kích thước cục bộ',
        status: 'needs_cleaning',
        statusLabel: 'Cần làm sạch',
        cleaningInstructions: [
          'Rửa sạch bụi bẩn, dầu mỡ còn sót lại và phơi khô hoàn toàn trước khi cắt.',
          'Kiểm tra kỹ độ dày thành vật liệu theo số đo 3D trước khi tạo hình.',
        ],
        safetyWarnings: [
          'Sử dụng kéo/dao rọc giấy cẩn thận, làm mịn mép cắt bằng giấy nhám hoặc băng keo.',
        ],
        dimensions: {
          shapeType: payload.category === 'paper' ? 'box' : payload.category === 'fabric' ? 'irregular' : 'cylinder',
          lengthCm: payload.depthCm,
          widthCm: payload.widthCm,
          heightCm: payload.heightCm,
          diameterCm: payload.category === 'paper' ? undefined : payload.widthCm,
          volumeMl: json.data.geometryAnalysis.calculatedVolumeMl,
          totalSurfaceCm2: json.data.geometryAnalysis.calculatedSurfaceCm2,
          usableSurfaceCm2: json.data.geometryAnalysis.usableSurfaceCm2,
          usableRatioPercent: Math.max(10, 100 - (json.data.geometryAnalysis.wastedRatioPercent || 15)),
        },
        images: payload.images.slice(0, 4),
        color: recon.appearance.primaryColor || '#38bdf8',
        dateAdded: new Date().toISOString().split('T')[0],
        reconstruction: recon,
      };

      setConfirmedMaterial(localMaterial);
      showToast('Đã dựng mô hình Parametric 3D cục bộ thành công!');
      void fetchPhase7IdeasForMaterial(localMaterial);
      return localMaterial;
    } catch (err: any) {
      showToast('Lỗi dựng 3D cục bộ: ' + (err?.message || 'Thất bại'));
      return null;
    } finally {
      setIsLocalReconstructing(false);
    }
  };

  const handleGlbAttached = (glbUrl: string, provider: string) => {
    setConfirmedMaterial((prev) => {
      if (!prev || !prev.reconstruction) return prev;
      return {
        ...prev,
        reconstruction: {
          ...prev.reconstruction,
          reconstructionMethod: 'image_to_3d',
          imageTo3D: {
            jobId: `glb_${Date.now()}`,
            provider: provider as any,
            status: 'completed',
            glbUrl,
          },
        },
      };
    });
    showToast('Đã gắn Mesh GLB 3D vào trình xem!');
  };

  // Add analyzed material to Inventory
  const handleAddMaterialToInventory = async (mat: MaterialItem) => {
    try {
      const data = await apiFetch<{ success: boolean; data: MaterialItem }>('/api/inventory', {
        method: 'POST',
        body: JSON.stringify(mat),
      });
      if (data.success) {
        setMaterials((prev) => [data.data, ...prev]);
        showToast('Đã lưu vật liệu vào kho cá nhân!');
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi khi lưu vật liệu.');
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await apiFetch(`/api/inventory/${id}`, { method: 'DELETE' });
      setMaterials((prev) => prev.filter((m) => m.id !== id));
      showToast('Đã xóa vật liệu khỏi kho.');
    } catch (err: any) {
      showToast(err?.message || 'Lỗi khi xóa.');
    }
  };

  // Select craft to open 3D workshop
  const handleSelectCraftForGuide = (craft: CraftProduct) => {
    setActiveCraftForGuide(craft);
    setActiveProjectResumeIndex(0);
    setActiveProjectId(null);
    setIsAssemblyFocused(false);
    setActiveTab('guide');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Resume project from My Projects
  const handleResumeProject = (proj: UserProject) => {
    setActiveCraftForGuide(proj.craftData);
    setActiveProjectResumeIndex(proj.currentStepIndex || 0);
    setActiveProjectId(proj.id);
    setIsAssemblyFocused(false);
    setActiveTab('guide');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 7-stage non-destructive navigation across the full workflow
  const handleNavigateWorkflowStage = (stage: WorkflowStageId) => {
    switch (stage) {
      case 'capture':
        setIsAssemblyFocused(false);
        setActiveTab('scan');
        setWizardStep(1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'select':
        setIsAssemblyFocused(false);
        setActiveTab('scan');
        setWizardStep((prev) => (prev >= 3 && prev <= 5 ? prev : 3));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'analyze':
        setIsAssemblyFocused(false);
        setActiveTab('scan');
        setWizardStep(views.length > 0 ? 7 : 8);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'model3d':
        setIsAssemblyFocused(false);
        setActiveTab('scan');
        setWizardStep(8);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'ideas':
        setIsAssemblyFocused(false);
        setActiveTab('scan');
        setWizardStep(8);
        setTimeout(() => {
          document.getElementById('recycling-ideas-section')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }, 80);
        break;
      case 'instructions':
        if (activeCraftForGuide) {
          setIsAssemblyFocused(false);
          setActiveTab('guide');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        break;
      case 'assembly':
        if (activeCraftForGuide) {
          setIsAssemblyFocused(true);
          setActiveTab('guide');
        }
        break;
    }
  };

  // Save or update project
  const handleSaveToProjects = async (
    craft: CraftProduct,
    completedIndices: number[],
    finishedPhoto?: string | null
  ) => {
    const isCompleted = completedIndices.length === craft.steps.length;
    const projectPayload: Partial<UserProject> = {
      title: craft.title,
      description: craft.description,
      status: isCompleted ? 'completed' : 'in_progress',
      progressPercent: Math.round((completedIndices.length / Math.max(1, craft.steps.length)) * 100),
      currentStepIndex: completedIndices.length > 0 ? Math.max(0, ...completedIndices) : 0,
      coverImage: finishedPhoto || craft.imageUrl,
      model3DType: craft.model3DType,
      craftData: {
        ...craft,
        steps: craft.steps.map((s, idx) => ({
          ...s,
          isCompleted: completedIndices.includes(idx),
        })),
      },
      inputMaterials: confirmedMaterial ? [confirmedMaterial] : [],
      userNotes: 'Dự án tạo từ Recycle Art Studio',
    };

    try {
      const isUpdating = Boolean(activeProjectId);
      const data = await apiFetch<{ success: boolean; data: UserProject }>(
        isUpdating ? `/api/projects/${activeProjectId}` : '/api/projects',
        {
          method: isUpdating ? 'PUT' : 'POST',
          body: JSON.stringify(projectPayload),
        }
      );
      if (data.success) {
        if (isUpdating) {
          setProjects((prev) => prev.map((p) => (p.id === data.data.id ? data.data : p)));
          showToast('Đã cập nhật tiến độ dự án!');
        } else {
          setActiveProjectId(data.data.id);
          setProjects((prev) => [data.data, ...prev]);
          showToast('Đã lưu vào "Dự án của tôi"!');
        }
        void refreshCurrentUserProfile();
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi lưu dự án.');
    }
  };

  // Duplicate Project
  const handleDuplicateProject = async (proj: UserProject) => {
    const duplicated: Partial<UserProject> = {
      ...proj,
      id: undefined,
      title: `${proj.title} (Bản sao)`,
      status: 'in_progress',
      progressPercent: 0,
      currentStepIndex: 0,
    };
    try {
      const data = await apiFetch<{ success: boolean; data: UserProject }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(duplicated),
      });
      if (data.success) {
        setProjects((prev) => [data.data, ...prev]);
        showToast('Đã nhân bản dự án thành công!');
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi nhân bản.');
    }
  };

  // Delete project
  const handleDeleteProject = async (id: string) => {
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== id));
      showToast('Đã xóa dự án.');
    } catch (err: any) {
      showToast(err?.message || 'Lỗi xóa dự án.');
    }
  };

  // Publish Craft to Community
  const handlePublishToCommunity = async (
    craft: CraftProduct,
    finishedPhoto?: string | null
  ) => {
    const payload: Partial<CommunityPost> = {
      title: craft.title,
      description: craft.description,
      coverImage: finishedPhoto || craft.imageUrl,
      model3DType: craft.model3DType,
      materialsSourceDescription: craft.whySuitable,
      materialsSummary: craft.materialsUsed.map((m) => m.name),
      toolsSummary: craft.toolsRequired,
      difficulty: craft.difficulty,
      estimatedTime: craft.estimatedTime,
      recycledRatio: craft.recycledMaterialRatio,
      type: craft.type,
      dimensions: `${craft.dimensionsFinished.lengthCm}×${craft.dimensionsFinished.widthCm}×${craft.dimensionsFinished.heightCm} cm`,
      steps: craft.steps,
      tipsAndLearnings: ['Cẩn thận với kéo và làm mịn viền cắt bằng băng keo.'],
    };

    try {
      const data = await apiFetch<{ success: boolean; data: CommunityPost }>('/api/community', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (data.success) {
        setCommunityPosts((prev) => [data.data, ...prev]);
        showToast('Tác phẩm đã xuất bản thành công lên Cộng Đồng!');
        setActiveTab('community');
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi xuất bản lên cộng đồng.');
    }
  };

  // Like / Save / Comment Community
  const handleToggleLike = async (postId: string) => {
    try {
      const data = await apiFetch<{ success: boolean; isLiked: boolean; likesCount: number }>(
        `/api/community/${postId}/like`,
        {
          method: 'POST',
          body: '{}',
        }
      );
      if (data.success) {
        setCommunityPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? ({ ...p, isLiked: data.isLiked, likesCount: data.likesCount } as any)
              : p
          )
        );
      }
    } catch (err) {
      console.warn('Like toggle error:', err);
    }
  };

  const handleToggleSave = async (postId: string) => {
    try {
      const data = await apiFetch<{ success: boolean; isSaved: boolean }>(
        `/api/community/${postId}/save`,
        {
          method: 'POST',
          body: '{}',
        }
      );
      if (data.success) {
        setCommunityPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? ({ ...p, isSaved: data.isSaved } as any) : p
          )
        );
        void fetchSavedIdeas();
        showToast(data.isSaved ? 'Đã lưu vào Ý tưởng đã lưu' : 'Đã bỏ lưu ý tưởng');
      }
    } catch (err) {
      console.warn('Save toggle error:', err);
    }
  };

  const handleAddComment = async (postId: string, text: string) => {
    try {
      const data = await apiFetch<{ success: boolean; data: any }>(
        `/api/community/${postId}/comment`,
        {
          method: 'POST',
          body: JSON.stringify({ text }),
        }
      );
      if (data.success) {
        setCommunityPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: [...p.comments, data.data],
                  commentsCount: p.commentsCount + 1,
                }
              : p
          )
        );
        showToast('Bình luận đã gửi thành công!');
      }
    } catch (err: any) {
      showToast(err?.message || 'Lỗi gửi bình luận.');
    }
  };

  // Brainstorm combined materials from inventory
  const handleCombineFromInventory = (selectedMaterials: MaterialItem[]) => {
    const combinedNotes = selectedMaterials.map((m) => `${m.name} (${m.quantity} ${m.unit})`).join('; ');
    const allImages = selectedMaterials.flatMap((m) => m.images);

    handleStartAnalysis({
      images: allImages.length > 0 ? allImages : ['/assets/aistudio/image_9cb5bb6a.png'],
      userNotes: `Phối hợp nhiều vật liệu: ${combinedNotes}`,
      referenceObject: { type: 'credit_card_85mm' },
    });
    setActiveTab('scan');
  };

  if (!isAuthenticated || !userProfile) {
    return (
      <>
        {toastMessage && (
          <div
            role="status"
            aria-live="polite"
            className="fixed top-5 right-4 z-50 px-4 py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-semibold shadow-2xl border border-slate-800 flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}
        <AuthGateScreen onAuthSuccess={(u) => void handleAuthSuccess(u)} />
      </>
    );
  }

  return (
    <BackgroundLayout
      variant="app"
      header={
        <>
          {/* Toast Notification */}
          {toastMessage && (
            <div
              role="status"
              aria-live="polite"
              className="fixed top-20 right-4 z-50 px-4 py-2.5 rounded-2xl bg-[#0A5C36] text-white text-xs font-semibold shadow-2xl border border-[#4ADE80]/40 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-[#4ADE80] shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Global Navbar */}
          <Navbar
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (tab !== 'guide') setIsAssemblyFocused(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            userProfile={userProfile}
            isAuthenticated={isAuthenticated}
            onOpenProfile={() => setShowProfileModal(true)}
            onOpenAuth={() => setShowAuthModal(true)}
          />
        </>
      }
      footer={
        <footer className="border-t border-emerald-200/80 bg-white/95 backdrop-blur-md py-7 mt-8 text-center text-xs text-slate-600">
          <div className="max-w-[1220px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#059669] to-[#0284C7] flex items-center justify-center text-white font-bold text-xs">
                R
              </div>
              <span className="font-bold text-[#0A5C36]">Recycle Art Studio</span>
              <span>— Biến rác thải thành sáng tạo</span>
            </div>

            <p className="text-slate-500">
              Công nghệ AI Đa Phương Thức & 3D WebGL • Thúc đẩy kinh tế tuần hoàn
            </p>

            <div className="flex items-center gap-4 text-slate-700 font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="min-h-[44px] px-2 hover:text-[#0A5C36] cursor-pointer"
              >
                Trang chủ
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('scan')}
                className="min-h-[44px] px-2 hover:text-[#0A5C36] cursor-pointer"
              >
                Quét AI
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('community')}
                className="min-h-[44px] px-2 hover:text-[#0A5C36] cursor-pointer"
              >
                Cộng đồng
              </button>
            </div>
          </div>
        </footer>
      }
    >
      {initialLoadError && (
        <ErrorBanner
          title="Lỗi đồng bộ dữ liệu ban đầu"
          message={initialLoadError}
          onRetry={loadInitialWorkspace}
        />
      )}

      {(activeTab === 'scan' || activeTab === 'guide') && (
        <WorkflowStepper
          activeTab={activeTab}
          onSelectStage={handleNavigateWorkflowStage}
        />
      )}

      <div key={activeTab} className="eco-page-enter space-y-6">
        {/* TAB 1: HOME */}
        {activeTab === 'home' && (
          <HeroSection
            onStartScan={() => setActiveTab('scan')}
            onExploreCommunity={() => setActiveTab('community')}
            onSelectFeaturedCraft={handleSelectCraftForGuide}
          />
        )}

        <Suspense fallback={<LoadingState compact title="Đang tải phân hệ studio..." />}>

        {/* TAB 2: SCAN & AI VISION STUDIO */}
        {activeTab === 'scan' && (
          <div className="space-y-10">
            {/* 11-Step Capture, Segmentation, Quality Gate, Calibration & 3D Reconstruction Wizard */}
            <MaterialCapture
              onStartAnalysis={handleStartAnalysis}
              onLocalGeometryReconstruction={handleLocalGeometryReconstruction}
              onSaveMaterialToInventory={handleAddMaterialToInventory}
              onGlbAttached={handleGlbAttached}
              isAnalyzing={isAnalyzing}
              hasGeminiKey={hasGeminiKey}
              hasSamEndpoint={hasSamEndpoint}
              confirmedMaterial={confirmedMaterial}
              analysisError={analysisError}
            />

            {/* Analysis & Reconstruction Results Display */}
            {confirmedMaterial && (
              <div className="space-y-8 animate-in fade-in duration-300">
                {analysisResult && (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 border border-emerald-200 text-xs text-slate-800 flex items-start justify-between gap-3 shadow-xs">
                    <div className="flex items-start gap-2.5">
                      <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-extrabold text-slate-900 block text-sm">
                          Kết quả phân tích từ: {analysisResult.engineLabel || 'Google Gemini 4 Hydrogen Vision'}
                        </span>
                        <p className="text-slate-600 text-xs mt-0.5">
                          {analysisResult.aiInsight ||
                            'Đã phân tích cấu trúc vật liệu, đo đạc kích thước milimet và lập danh sách sản phẩm tái chế phù hợp.'}
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider bg-white/90 text-emerald-800 border border-emerald-200 shadow-2xs shrink-0">
                      AI Đã Khớp
                    </span>
                  </div>
                )}

                {/* Section 8: Waste Classification & Usability Safety Assessment */}
                <ClassificationSafetyCard
                  material={confirmedMaterial}
                  onConfirmClassification={(updated) => setConfirmedMaterial(updated)}
                  onAddToInventory={handleAddMaterialToInventory}
                />

                {/* Section 10: 3D Material Scanner & Interactive Geometry Measurement */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#0A5C36]">
                        Mô hình 3D Parametric & Mesh tương tác
                      </span>
                      <span className="text-xs text-slate-500">• Xoay 360°, tách lớp, thước kẹp 3D</span>
                    </div>
                  </div>

                  <MaterialScanner3D
                    material={confirmedMaterial}
                    height="440px"
                  />
                </div>

                {/* Section 10B: Mathematical Dimensions & Usable Surface Area Calculation */}
                <GeometryCalculatorCard
                  material={confirmedMaterial}
                  onUpdateDimensions={(newDims) => {
                    setConfirmedMaterial((prev) => {
                      if (!prev) return prev;
                      const updatedRecon = prev.reconstruction
                        ? {
                            ...prev.reconstruction,
                            dimensions: {
                              ...prev.reconstruction.dimensions,
                              heightCm: newDims.heightCm,
                              widthCm: newDims.diameterCm || newDims.widthCm,
                              depthCm: newDims.diameterCm || newDims.lengthCm,
                              lengthCm: newDims.lengthCm,
                              measurementMethod: 'user_input' as const,
                              confidence: 0.9,
                            },
                          }
                        : undefined;
                      return { ...prev, dimensions: newDims, reconstruction: updatedRecon };
                    });
                  }}
                />

                {/* Section 9: Phase 7 Reusability Analysis & 2-Group Craft Recommendations (for both AI and Local 3D Scans) */}
                {!analysisResult && confirmedMaterial && (
                  <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs">
                      <span className="font-bold text-slate-900 block">
                        Đề xuất sản phẩm tái chế & Hướng dẫn 6 giai đoạn (Phase 7)
                      </span>
                      <span className="text-slate-500">
                        Tự động phân tích khả năng tái sử dụng từ vật liệu vừa dựng hình 3D hoặc cập nhật lại sau khi sửa thông số.
                      </span>
                    </div>
                    <button
                      onClick={() => fetchPhase7IdeasForMaterial(confirmedMaterial)}
                      disabled={isGeneratingIdeas}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {isGeneratingIdeas
                          ? 'Đang phân tích ý tưởng...'
                          : localAdvisorResult
                          ? 'Cập nhật lại ý tưởng'
                          : 'Tạo ý tưởng tái chế'}
                      </span>
                    </button>
                  </div>
                )}

                {isGeneratingIdeas && (
                  <LoadingState
                    compact
                    title="Đang đánh giá khả năng tái sử dụng & tạo ý tưởng thủ công..."
                    description="Hệ thống đang kiểm tra vật liệu, an toàn và lên danh sách 2 nhóm sản phẩm phù hợp."
                  />
                )}

                {ideasError && confirmedMaterial && (
                  <ErrorBanner
                    title="Không thể tạo gợi ý tái chế"
                    message={ideasError}
                    onRetry={() => fetchPhase7IdeasForMaterial(confirmedMaterial)}
                  />
                )}

                {(analysisResult || localAdvisorResult) && (
                  <div id="recycling-ideas-section">
                    <CraftRecommendationList
                      group100Percent={
                        analysisResult
                          ? analysisResult.recommendations.group100Percent
                          : localAdvisorResult!.group100Percent
                      }
                      groupWithAddedMaterials={
                        analysisResult
                          ? analysisResult.recommendations.groupWithAddedMaterials
                          : localAdvisorResult!.groupWithAddedMaterials
                      }
                      reusabilityAnalysis={
                        analysisResult
                          ? analysisResult.reusabilityAnalysis || null
                          : localAdvisorResult?.reusability || null
                      }
                      safetyCompliance={
                        analysisResult
                          ? analysisResult.safetyCompliance || null
                          : localAdvisorResult?.safetyCompliance || null
                      }
                      sourceMaterial={confirmedMaterial}
                      onSelectCraft={handleSelectCraftForGuide}
                      onUpdateCraft={(updated) => {
                        if (analysisResult) {
                          setAnalysisTask((prev) => {
                            if (!prev.data) return prev;
                            return {
                              ...prev,
                              data: {
                                ...prev.data,
                                recommendations: {
                                  group100Percent: prev.data.recommendations.group100Percent.map(
                                    (c) => (c.id === updated.id ? updated : c)
                                  ),
                                  groupWithAddedMaterials:
                                    prev.data.recommendations.groupWithAddedMaterials.map((c) =>
                                      c.id === updated.id ? updated : c
                                    ),
                                },
                              },
                            };
                          });
                        }
                        showToast(`Đã cập nhật mô hình 3D cho "${updated.title}"!`);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: 3D INTERACTIVE CRAFT WORKSHOP GUIDE */}
        {activeTab === 'guide' && activeCraftForGuide && (
          <InteractiveCraftGuide
            craft={activeCraftForGuide}
            sourceMaterial={confirmedMaterial}
            availableIdeas={
              analysisResult
                ? [
                    ...analysisResult.recommendations.group100Percent,
                    ...analysisResult.recommendations.groupWithAddedMaterials,
                  ]
                : localAdvisorResult
                ? [
                    ...localAdvisorResult.group100Percent,
                    ...localAdvisorResult.groupWithAddedMaterials,
                  ]
                : [activeCraftForGuide]
            }
            reusabilityAnalysis={
              analysisResult?.reusabilityAnalysis || localAdvisorResult?.reusability || null
            }
            onSelectIdea={handleSelectCraftForGuide}
            initialStepIndex={activeProjectResumeIndex}
            focusAssemblySection={isAssemblyFocused}
            onSaveToProjects={handleSaveToProjects}
            onPublishToCommunity={handlePublishToCommunity}
            onBackToRecommendations={() => {
              setIsAssemblyFocused(false);
              setActiveTab('scan');
            }}
          />
        )}

        {/* TAB 4: MY MATERIAL INVENTORY */}
        {activeTab === 'inventory' &&
          (isInitialLoading && materials.length === 0 ? (
            <LoadingState title="Đang tải kho vật liệu cá nhân..." />
          ) : (
            <MaterialInventory
              materials={materials}
              onSelectCombineMaterials={handleCombineFromInventory}
              onGenerateIdeasForMaterial={(mat) => {
                setAnalysisTask(createIdleTask<AnalysisResult>());
                setConfirmedMaterial(mat);
                void fetchPhase7IdeasForMaterial(mat);
                setWizardStep(8);
                setActiveTab('scan');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onDeleteMaterial={handleDeleteMaterial}
              onUpdateMaterial={(updated) => {
                setMaterials((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
              }}
              onAddNewScan={() => setActiveTab('scan')}
            />
          ))}

        {/* TAB 5: MY PROJECTS */}
        {activeTab === 'projects' && (
          <MyProjectsView
            projects={projects}
            onResumeProject={handleResumeProject}
            onDeleteProject={handleDeleteProject}
            onDuplicateProject={handleDuplicateProject}
            onPublishToCommunity={handlePublishToCommunity}
            onStartNewProject={() => setActiveTab('scan')}
          />
        )}

        {/* TAB 6: COMMUNITY GALLERY */}
        {activeTab === 'community' && (
          <CommunityView
            posts={communityPosts}
            onToggleLike={handleToggleLike}
            onToggleSave={handleToggleSave}
            onAddComment={handleAddComment}
            onCreateNewPost={async (postData) => {
              try {
                const data = await apiFetch<{ success: boolean; data: CommunityPost }>(
                  '/api/community',
                  {
                    method: 'POST',
                    body: JSON.stringify(postData),
                  }
                );
                if (data.success) {
                  setCommunityPosts((prev) => [data.data, ...prev]);
                  showToast('Tác phẩm đã xuất bản thành công!');
                }
              } catch (err: any) {
                showToast(err?.message || 'Lỗi xuất bản tác phẩm.');
              }
            }}
            onOpenWorkshop={handleSelectCraftForGuide}
          />
        )}

        {/* TAB 7: SAVED IDEAS */}
        {activeTab === 'saved' && (
          <SavedIdeasView
            savedPosts={savedPosts}
            onRemoveSaved={handleToggleSave}
            onToggleLike={handleToggleLike}
            onAddComment={handleAddComment}
            onStartCraft={handleSelectCraftForGuide}
          />
        )}

        {/* TAB 8: ADMIN ACCOUNT & PASSWORD CONSOLE */}
        {activeTab === 'admin' && isAuthenticated && userProfile?.role === 'admin' && (
          <AdminAccountsView
            currentUser={userProfile}
            onNotify={showToast}
            onCurrentUserUpdated={(updated) => setUserProfile(updated)}
          />
        )}
        </Suspense>
      </div>

      {/* Deep Link Community Idea Modal (?idea=...) */}
      {deepLinkIdeaId && communityPosts.find((p) => p.id === deepLinkIdeaId) && (
        <Suspense fallback={null}>
          <CommunityDetailModal
            post={communityPosts.find((p) => p.id === deepLinkIdeaId)!}
            onClose={() => {
              setDeepLinkIdeaId(null);
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete('idea');
                window.history.replaceState({}, '', url.toString());
              } catch {}
            }}
            onToggleLike={handleToggleLike}
            onToggleSave={handleToggleSave}
            onAddComment={handleAddComment}
            onOpenWorkshop={handleSelectCraftForGuide}
          />
        </Suspense>
      )}

      {/* User Profile Modal */}
      {showProfileModal && userProfile && (
        <Suspense fallback={null}>
          <UserProfileModal
            user={userProfile}
            isAuthenticated={isAuthenticated}
            onClose={() => setShowProfileModal(false)}
            onOpenAuth={() => setShowAuthModal(true)}
            onLogout={() => void handleLogout()}
            onOpenAdminDashboard={() => setActiveTab('admin')}
            onNotify={showToast}
            onUpdateProfile={async (updated) => {
              try {
                const data = await apiFetch<{ success: boolean; data: AuthUser }>(
                  '/api/profile',
                  {
                    method: 'PUT',
                    body: JSON.stringify(updated),
                  }
                );
                if (data.success) {
                  setUserProfile(data.data);
                  showToast('Đã cập nhật hồ sơ cá nhân!');
                }
              } catch (err: any) {
                showToast(err?.message || 'Lỗi cập nhật hồ sơ.');
              }
            }}
          />
        </Suspense>
      )}

      {/* Auth Login / Register Modal */}
      {showAuthModal && (
        <Suspense fallback={null}>
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onAuthSuccess={(u) => void handleAuthSuccess(u)}
          />
        </Suspense>
      )}
    </BackgroundLayout>
  );
}
