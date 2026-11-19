import crypto from 'crypto';
import type { GlbInspectionReport } from '../src/types/reconstruction.ts';

export type ImageTo3DProvider = 'tripo3d' | 'meshy' | 'custom_endpoint' | 'none';
export type ImageTo3DStatus =
  | 'not_requested'
  | 'unavailable'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type JobPipelineStep =
  | 'submit_image'
  | 'receive_job_id'
  | 'track_status'
  | 'handle_completion'
  | 'download_model'
  | 'validate_output';

export interface EvaluatedProviderInfo {
  id: 'tripo3d' | 'meshy' | 'rodin' | 'hunyuan3d' | 'instantmesh' | 'triposr';
  serverProviderKey: ImageTo3DProvider | null;
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

export interface ImageTo3DContext {
  analysisId?: string;
  objectName?: string;
  category?: string;
  material?: string;
  shapeType?: string;
  dimensions?: {
    heightCm?: number | null;
    widthCm?: number | null;
    depthCm?: number | null;
  };
}

export interface ImageTo3DJob {
  id: string;
  provider: ImageTo3DProvider;
  status: ImageTo3DStatus;
  progressPercent: number;
  currentStep?: JobPipelineStep;
  stepsCompleted?: JobPipelineStep[];
  createdAt: string;
  updatedAt: string;
  elapsedMs?: number;
  glbUrl: string | null;
  glbByteLength?: number;
  glbInspection?: GlbInspectionReport | null;
  estimatedCredits?: number;
  deduplicatedFromCache?: boolean;
  fallbackEngine: 'parametric_phase4';
  message: string;
  error?: string;
}

export const MAX_GLB_BYTES = 25 * 1024 * 1024; // 25 MB safety limit
const MAX_CACHED_GLBS = 16;
const DEFAULT_DAILY_LIMIT = 15;
const COOLDOWN_MS = 6000;

const jobStore = new Map<string, ImageTo3DJob>();
const glbCache = new Map<string, Buffer>();
const inputHashToJobId = new Map<string, string>();
const canceledJobs = new Set<string>();

interface QuotaState {
  dayKey: string;
  usedToday: number;
  totalCreditsEstimated: number;
  lastSubmittedAtMs: number;
}

const quotaState: QuotaState = {
  dayKey: new Date().toISOString().slice(0, 10),
  usedToday: 0,
  totalCreditsEstimated: 0,
  lastSubmittedAtMs: 0,
};

function syncQuotaDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (quotaState.dayKey !== today) {
    quotaState.dayKey = today;
    quotaState.usedToday = 0;
    quotaState.lastSubmittedAtMs = 0;
  }
}

export function getDailyQuotaLimit(): number {
  const raw = Number(process.env.IMAGE_TO_3D_DAILY_LIMIT);
  if (Number.isFinite(raw) && raw > 0 && raw <= 500) {
    return Math.floor(raw);
  }
  return DEFAULT_DAILY_LIMIT;
}

export function getQuotaStatus() {
  syncQuotaDay();
  const dailyLimit = getDailyQuotaLimit();
  const remainingToday = Math.max(0, dailyLimit - quotaState.usedToday);
  return {
    dayKey: quotaState.dayKey,
    usedToday: quotaState.usedToday,
    dailyLimit,
    remainingToday,
    totalCreditsEstimated: quotaState.totalCreditsEstimated,
    cooldownMs: COOLDOWN_MS,
    maxGlbBytes: MAX_GLB_BYTES,
  };
}

export function resetImageTo3DStateForTest() {
  jobStore.clear();
  glbCache.clear();
  inputHashToJobId.clear();
  canceledJobs.clear();
  quotaState.dayKey = new Date().toISOString().slice(0, 10);
  quotaState.usedToday = 0;
  quotaState.totalCreditsEstimated = 0;
  quotaState.lastSubmittedAtMs = 0;
}

export function getImageTo3DCapabilities() {
  const hasTripoApiKey = Boolean(
    process.env.TRIPO_API_KEY && process.env.TRIPO_API_KEY !== 'MY_TRIPO_API_KEY'
  );
  const hasMeshyApiKey = Boolean(
    process.env.MESHY_API_KEY && process.env.MESHY_API_KEY !== 'MY_MESHY_API_KEY'
  );
  const hasCustom3DEndpoint = Boolean(
    process.env.IMAGE_TO_3D_ENDPOINT && process.env.IMAGE_TO_3D_ENDPOINT.startsWith('https://')
  );

  let activeProvider: ImageTo3DProvider = 'none';
  if (hasTripoApiKey) activeProvider = 'tripo3d';
  else if (hasMeshyApiKey) activeProvider = 'meshy';
  else if (hasCustom3DEndpoint) activeProvider = 'custom_endpoint';

  const evaluatedProviders: EvaluatedProviderInfo[] = [
    {
      id: 'tripo3d',
      serverProviderKey: 'tripo3d',
      name: 'Tripo3D API v2 (OpenAPI)',
      apiAvailability: 'REST API chính thức (/v2/openapi/upload, /task, /task/:id)',
      imageInputRequirements: 'PNG/JPEG nền sạch hoặc đã tách nền (>= 256px), hỗ trợ đơn ảnh & đa góc (2-4 ảnh)',
      outputFormats: ['GLB (ưu tiên)', 'FBX', 'OBJ'],
      meshQuality: 'Rất cao — topology gọn, ít lỗ rách hình học',
      textureQuality: 'Cao — PBR Albedo/Roughness/Metallic nhúng sẵn trong GLB',
      processingTime: '10–25 giây',
      pricing: 'Trả theo credit (~20–40 credits/lượt); tác vụ lỗi không bị trừ credit',
      licenseAndRestrictions: 'Gói trả phí: toàn quyền thương mại & riêng tư; miễn phí cần ghi nguồn/công khai',
      multiView: true,
      configured: hasTripoApiKey,
      recommended: true,
      roleInProject: 'Nhà cung cấp Cloud chính được chọn cho Phase 5',
    },
    {
      id: 'meshy',
      serverProviderKey: 'meshy',
      name: 'Meshy Image-to-3D API',
      apiAvailability: 'REST API chính thức (/openapi/v1/image-to-3d)',
      imageInputRequirements: 'Ảnh PNG/JPEG hoặc Data URI rõ vật thể, ánh sáng đều',
      outputFormats: ['GLB (ưu tiên)', 'FBX', 'OBJ', 'USDZ'],
      meshQuality: 'Cao — hỗ trợ tùy chọn polycount & topology',
      textureQuality: 'Rất tốt — bật enable_pbr cho vật liệu kim loại/nhựa/thủy tinh',
      processingTime: '20–45 giây',
      pricing: '10–25 credits/lượt (nạp credit trả trước; hoàn tiền khi lỗi)',
      licenseAndRestrictions: 'Gói trả phí: sở hữu thương mại; miễn phí áp dụng CC-BY 4.0',
      multiView: false,
      configured: hasMeshyApiKey,
      recommended: true,
      roleInProject: 'Nhà cung cấp Cloud dự phòng song song với Tripo3D',
    },
    {
      id: 'rodin',
      serverProviderKey: null,
      name: 'Hyper3D Rodin',
      apiAvailability: 'API thương mại có cổng gói Business ($120/tháng)',
      imageInputRequirements: '1–5 ảnh góc nhìn sạch, độ phân giải trung bình-cao',
      outputFormats: ['GLB', 'FBX', 'OBJ'],
      meshQuality: 'Rất cao (nhiều chi tiết mịn)',
      textureQuality: 'PBR sắc nét 2K',
      processingTime: '25–60 giây',
      pricing: 'Thuê bao API tối thiểu ~$120/tháng + phí credit theo lượt',
      licenseAndRestrictions: 'Thương mại theo gói Business/Creator; chi phí cố định cao',
      multiView: true,
      configured: false,
      recommended: false,
      roleInProject: 'Không chọn do phí thuê bao API cố định vượt ngân sách dự án',
    },
    {
      id: 'hunyuan3d',
      serverProviderKey: 'custom_endpoint',
      name: 'Tencent Hunyuan3D (v2/v3)',
      apiAvailability: 'Mã nguồn mở tự host GPU hoặc qua custom HTTPS endpoint',
      imageInputRequirements: 'Ảnh tách nền chuẩn hóa căn giữa vật thể (>= 512px)',
      outputFormats: ['GLB', 'OBJ'],
      meshQuality: 'Rất cao (tái tạo bề mặt phức tạp tốt)',
      textureQuality: 'Tốt với PBR pipeline',
      processingTime: '15–45 giây (GPU VRAM 16–24GB)',
      pricing: 'Tự host GPU (~$0.05–$0.35/lượt thuê GPU serverless)',
      licenseAndRestrictions: 'Tencent Community License (có giới hạn khu vực EU/UK/KR với trọng số mở)',
      multiView: true,
      configured: hasCustom3DEndpoint,
      recommended: false,
      roleInProject: 'Hỗ trợ qua IMAGE_TO_3D_ENDPOINT khi triển khai GPU riêng',
    },
    {
      id: 'instantmesh',
      serverProviderKey: 'custom_endpoint',
      name: 'InstantMesh (Tencent ARC)',
      apiAvailability: 'Không có API miễn phí chính thức — tự host Python/CUDA HTTPS',
      imageInputRequirements: 'Ảnh tách nền 1 góc nhìn, sinh đa góc nội bộ rồi LRM mesh',
      outputFormats: ['OBJ', 'GLB (cần đóng gói gltf)'],
      meshQuality: 'Trung bình-khá (mesh mềm hơn Tripo3D/Hunyuan3D)',
      textureQuality: 'Vertex color / UV cơ bản',
      processingTime: '10–25 giây trên RTX 4090/A100',
      pricing: 'Miễn phí mã nguồn, trả phí GPU hạ tầng tự vận hành',
      licenseAndRestrictions: 'Apache 2.0 (thân thiện thương mại)',
      multiView: false,
      configured: hasCustom3DEndpoint,
      recommended: false,
      roleInProject: 'Phương án mã nguồn mở tự host qua IMAGE_TO_3D_ENDPOINT',
    },
    {
      id: 'triposr',
      serverProviderKey: 'custom_endpoint',
      name: 'TripoSR (Stability AI + Tripo)',
      apiAvailability: 'Không có API miễn phí chính thức — tự host GPU hoặc inference server',
      imageInputRequirements: 'Ảnh tách nền vuông, vật thể ở giữa khung hình',
      outputFormats: ['GLB', 'OBJ'],
      meshQuality: 'Trung bình — tốc độ cực nhanh nhưng dễ bệt mặt sau',
      textureQuality: 'Thấp-trung bình (thường dùng vertex color)',
      processingTime: '1–5 giây trên GPU CUDA',
      pricing: 'Miễn phí trọng số, tốn chi phí GPU server',
      licenseAndRestrictions: 'MIT License (tự do thương mại)',
      multiView: false,
      configured: hasCustom3DEndpoint,
      recommended: false,
      roleInProject: 'Phương án dự phòng tốc độ cao nếu tự vận hành GPU cục bộ',
    },
  ];

  return {
    hasTripoApiKey,
    hasMeshyApiKey,
    hasCustom3DEndpoint,
    hasImageTo3D: hasTripoApiKey || hasMeshyApiKey || hasCustom3DEndpoint,
    activeProvider,
    selectedPrimaryRecommendation: 'tripo3d',
    quota: getQuotaStatus(),
    evaluatedProviders,
  };
}

/**
 * Validates binary GLB header + glTF 2.0 JSON chunk structure:
 * - Magic 'glTF' (0x46546C67 LE)
 * - Version === 2
 * - Total byteLength <= buffer.length and <= MAX_GLB_BYTES
 * - Chunk 0 type === 'JSON' (0x4e4f534a), valid JSON, non-empty meshes[], valid geometry attributes
 */
export function validateGlbBuffer(buf: Buffer): {
  valid: boolean;
  reason?: string;
  version?: number;
  byteLength?: number;
  inspection?: GlbInspectionReport;
} {
  if (!Buffer.isBuffer(buf) || buf.length < 20) {
    return { valid: false, reason: 'Tệp GLB quá nhỏ hoặc rỗng (< 20 bytes).' };
  }
  if (buf.length > MAX_GLB_BYTES) {
    return {
      valid: false,
      reason: `Tệp GLB (${(buf.length / (1024 * 1024)).toFixed(1)} MB) vượt quá giới hạn tối đa 25 MB.`,
    };
  }

  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) {
    return { valid: false, reason: 'Header tệp không khớp định dạng nhị phân glTF (GLB magic invalid).' };
  }
  const version = buf.readUInt32LE(4);
  if (version !== 2) {
    return { valid: false, reason: `Phiên bản glTF (${version}) không được hỗ trợ (yêu cầu GLB v2).` };
  }
  const totalLen = buf.readUInt32LE(8);
  if (totalLen > buf.length || totalLen < 20) {
    return { valid: false, reason: 'Độ dài khai báo trong header GLB không khớp kích thước tệp.' };
  }

  const chunk0Length = buf.readUInt32LE(12);
  const firstChunkType = buf.readUInt32LE(16);
  if (firstChunkType !== 0x4e4f534a) {
    return { valid: false, reason: 'Chunk đầu tiên của GLB không phải JSON scene descriptor.' };
  }
  if (chunk0Length <= 0 || 20 + chunk0Length > buf.length) {
    return { valid: false, reason: 'Kích thước JSON chunk trong GLB bị cắt cụt hoặc sai lệch.' };
  }

  let gltfJson: any;
  try {
    const jsonText = buf.subarray(20, 20 + chunk0Length).toString('utf8').replace(/\0+$/, '').trim();
    gltfJson = JSON.parse(jsonText);
  } catch {
    return { valid: false, reason: 'JSON scene descriptor trong GLB bị lỗi cú pháp.' };
  }

  if (!gltfJson || typeof gltfJson !== 'object') {
    return { valid: false, reason: 'Cấu trúc glTF JSON không hợp lệ.' };
  }

  const meshes = Array.isArray(gltfJson.meshes) ? gltfJson.meshes : [];
  const nodes = Array.isArray(gltfJson.nodes) ? gltfJson.nodes : [];
  const materials = Array.isArray(gltfJson.materials) ? gltfJson.materials : [];
  const textures = Array.isArray(gltfJson.textures) ? gltfJson.textures : [];
  const images = Array.isArray(gltfJson.images) ? gltfJson.images : [];
  const accessors = Array.isArray(gltfJson.accessors) ? gltfJson.accessors : [];

  const issues: string[] = [];
  if (meshes.length === 0) {
    issues.push('GLB không chứa bất kỳ mesh hình học nào (meshes.length === 0).');
  }

  let primitiveCount = 0;
  let hasPositionAttribute = false;
  let vertexCount = 0;
  let triangleCount = 0;

  for (const m of meshes) {
    const prims = Array.isArray(m?.primitives) ? m.primitives : [];
    for (const p of prims) {
      primitiveCount++;
      const posAccIdx = p?.attributes?.POSITION;
      if (typeof posAccIdx === 'number' && accessors[posAccIdx]) {
        hasPositionAttribute = true;
        vertexCount += Number(accessors[posAccIdx].count || 0);
      }
      const idxAccIdx = p?.indices;
      if (typeof idxAccIdx === 'number' && accessors[idxAccIdx]) {
        triangleCount += Math.floor(Number(accessors[idxAccIdx].count || 0) / 3);
      }
    }
  }

  if (meshes.length > 0 && !hasPositionAttribute) {
    issues.push('Mesh trong GLB thiếu thuộc tính tọa độ đỉnh POSITION.');
  }
  if (materials.length === 0) {
    issues.push('GLB chưa khai báo material PBR; trình xem sẽ áp vật liệu mặc định.');
  }

  const hasEmbeddedTextures =
    textures.length > 0 ||
    images.some((img: any) => typeof img?.bufferView === 'number' || String(img?.uri || '').startsWith('data:'));

  const hasPbrMaterials = materials.some(
    (mat: any) => Boolean(mat?.pbrMetallicRoughness) || Boolean(mat?.normalTexture)
  );

  const inspection: GlbInspectionReport = {
    valid: issues.filter((i) => !i.includes('mặc định')).length === 0 && meshes.length > 0 && hasPositionAttribute,
    source: 'server_glb',
    byteLength: buf.length,
    meshCount: meshes.length,
    primitiveCount,
    materialCount: materials.length,
    textureCount: Math.max(textures.length, images.length),
    nodeCount: nodes.length,
    hasEmbeddedTextures,
    hasPbrMaterials,
    vertexCount: vertexCount || undefined,
    triangleCount: triangleCount || undefined,
    generator: typeof gltfJson?.asset?.generator === 'string' ? gltfJson.asset.generator : undefined,
    issues,
  };

  if (!inspection.valid) {
    return {
      valid: false,
      reason: issues[0] || 'Cấu trúc mesh GLB không hợp lệ.',
      version,
      byteLength: buf.length,
      inspection,
    };
  }

  return {
    valid: true,
    version,
    byteLength: buf.length,
    inspection,
  };
}

/**
 * SSRF guard for external GLB URLs returned by remote providers.
 */
export function isSafeExternalModelUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function storeGlb(jobId: string, buf: Buffer) {
  if (glbCache.size >= MAX_CACHED_GLBS) {
    const oldestKey = glbCache.keys().next().value;
    if (oldestKey) glbCache.delete(oldestKey);
  }
  glbCache.set(jobId, buf);
}

export function getImageTo3DJob(jobId: string): ImageTo3DJob | null {
  return jobStore.get(jobId) || null;
}

export function getImageTo3DGlbBuffer(jobId: string): Buffer | null {
  return glbCache.get(jobId) || null;
}

export function cancelImageTo3DJob(jobId: string): ImageTo3DJob | null {
  const job = jobStore.get(jobId);
  if (!job) return null;
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'unavailable') {
    return job;
  }
  canceledJobs.add(jobId);
  updateJob(jobId, {
    status: 'failed',
    error: 'Tác vụ đã được hủy theo yêu cầu người dùng.',
    message: 'Đã hủy tác vụ Image-to-3D. Đang dùng mô hình Parametric 3D nội bộ.',
    elapsedMs: Date.now() - Date.parse(job.createdAt),
  });
  return jobStore.get(jobId) || null;
}

function updateJob(jobId: string, patch: Partial<ImageTo3DJob>) {
  const existing = jobStore.get(jobId);
  if (!existing) return;
  jobStore.set(jobId, {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; maxRetries?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const maxRetries = options.maxRetries ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = 800 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = 800 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Lỗi kết nối mạng tới dịch vụ Image-to-3D.');
}

function estimateProviderCredits(provider: ImageTo3DProvider, viewCount: number): number {
  if (provider === 'tripo3d') return viewCount >= 2 ? 40 : 30;
  if (provider === 'meshy') return 20;
  return 0;
}

/**
 * Starts an async Image-to-3D reconstruction job with:
 * - Provider availability check (honest 'unavailable' fallback when no keys are configured)
 * - SHA-256 input deduplication cache (avoids duplicate credit spend)
 * - Daily quota & cooldown protection
 * - Multi-view cutouts & Phase 3 context forwarding
 */
export async function startImageTo3DJob(params: {
  imageDataUrl: string;
  images?: string[];
  maskDataUrl?: string | null;
  preferProvider?: ImageTo3DProvider;
  context?: ImageTo3DContext;
}): Promise<ImageTo3DJob> {
  syncQuotaDay();
  const caps = getImageTo3DCapabilities();
  const jobId = `job3d_${crypto.randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();

  if (!caps.hasImageTo3D) {
    const unavailableJob: ImageTo3DJob = {
      id: jobId,
      provider: 'none',
      status: 'unavailable',
      progressPercent: 0,
      createdAt: now,
      updatedAt: now,
      glbUrl: null,
      fallbackEngine: 'parametric_phase4',
      message:
        'Chưa cấu hình TRIPO_API_KEY, MESHY_API_KEY hoặc IMAGE_TO_3D_ENDPOINT trên máy chủ. Hệ thống tự động sử dụng Parametric 3D Engine (Phase 4).',
    };
    jobStore.set(jobId, unavailableJob);
    return unavailableJob;
  }

  let provider: ImageTo3DProvider =
    params.preferProvider && params.preferProvider !== 'none'
      ? params.preferProvider
      : caps.activeProvider;

  // Validate requested provider actually has credentials configured; otherwise fall back cleanly
  if (provider === 'tripo3d' && !caps.hasTripoApiKey) {
    provider = caps.activeProvider;
  } else if (provider === 'meshy' && !caps.hasMeshyApiKey) {
    provider = caps.activeProvider;
  } else if (provider === 'custom_endpoint' && !caps.hasCustom3DEndpoint) {
    provider = caps.activeProvider;
  }

  const allImages = [
    params.imageDataUrl,
    ...(Array.isArray(params.images) ? params.images.filter((img) => img !== params.imageDataUrl) : []),
  ]
    .filter((x) => typeof x === 'string' && x.length > 0)
    .slice(0, 4);

  // Deduplicate identical requests so repeated clicks reuse cached GLB at zero cost
  const inputHash = crypto
    .createHash('sha256')
    .update(`${provider}|${allImages.join('|')}|${params.maskDataUrl || ''}`)
    .digest('hex');

  const cachedJobId = inputHashToJobId.get(inputHash);
  if (cachedJobId) {
    const cachedJob = jobStore.get(cachedJobId);
    if (cachedJob && cachedJob.status === 'completed' && glbCache.has(cachedJobId)) {
      return {
        ...cachedJob,
        deduplicatedFromCache: true,
        estimatedCredits: 0,
        message: `Tái sử dụng GLB đã tạo từ cache (tiết kiệm credit ${provider}).`,
      };
    }
  }

  // Enforce daily quota & short cooldown
  const quota = getQuotaStatus();
  if (quota.remainingToday <= 0) {
    const quotaError = new Error(
      `Đã đạt giới hạn ${quota.dailyLimit} lượt Image-to-3D hôm nay để bảo vệ chi phí API. Hệ thống dùng Parametric 3D Engine (Phase 4).`
    );
    (quotaError as any).statusCode = 429;
    throw quotaError;
  }

  const elapsedSinceLast = Date.now() - quotaState.lastSubmittedAtMs;
  if (quotaState.lastSubmittedAtMs > 0 && elapsedSinceLast < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - elapsedSinceLast) / 1000);
    const rateError = new Error(`Vui lòng đợi ${waitSec}s trước khi gửi tác vụ Image-to-3D mới.`);
    (rateError as any).statusCode = 429;
    throw rateError;
  }

  const estimatedCredits = estimateProviderCredits(provider, allImages.length);
  quotaState.usedToday += 1;
  quotaState.lastSubmittedAtMs = Date.now();

  const job: ImageTo3DJob = {
    id: jobId,
    provider,
    status: 'queued',
    progressPercent: 10,
    currentStep: 'submit_image',
    stepsCompleted: [],
    createdAt: now,
    updatedAt: now,
    glbUrl: null,
    estimatedCredits,
    fallbackEngine: 'parametric_phase4',
    message: `Đã xếp hàng xử lý Image-to-3D (${allImages.length} góc ảnh) qua ${provider}...`,
  };
  jobStore.set(jobId, job);

  const startedAt = Date.now();

  void processImageTo3DJob(jobId, provider, allImages, params.maskDataUrl, params.context, inputHash, startedAt).catch(
    (err) => {
      if (canceledJobs.has(jobId)) return;
      updateJob(jobId, {
        status: 'failed',
        elapsedMs: Date.now() - startedAt,
        estimatedCredits: 0, // Failed tasks do not incur credit charges on Tripo/Meshy
        error: err?.message || 'Lỗi không xác định khi tái tạo GLB.',
        message: `Image-to-3D thất bại (${err?.message || 'Unknown error'}). Tự động fallback về Parametric 3D Engine.`,
      });
    }
  );

  return job;
}

async function downloadAndValidateGlb(jobId: string, modelUrl: string): Promise<{
  buf: Buffer;
  inspection: GlbInspectionReport;
}> {
  if (!isSafeExternalModelUrl(modelUrl)) {
    throw new Error('URL tải mô hình GLB bị chặn bởi kiểm tra an toàn SSRF.');
  }
  const glbRes = await fetchWithRetry(modelUrl, { method: 'GET' }, { timeoutMs: 30000, maxRetries: 2 });
  if (!glbRes.ok) {
    throw new Error(`Không tải được tệp GLB (HTTP ${glbRes.status}).`);
  }
  const contentLen = Number(glbRes.headers.get('content-length') || 0);
  if (contentLen > MAX_GLB_BYTES) {
    throw new Error(`Kích thước GLB (${(contentLen / (1024 * 1024)).toFixed(1)} MB) vượt quá giới hạn 25 MB.`);
  }
  const glbBuf = Buffer.from(await glbRes.arrayBuffer());
  const check = validateGlbBuffer(glbBuf);
  if (!check.valid || !check.inspection) {
    throw new Error(check.reason || 'Tệp GLB không đạt kiểm tra cấu trúc glTF 2.0.');
  }
  return { buf: glbBuf, inspection: check.inspection };
}

async function processImageTo3DJob(
  jobId: string,
  provider: ImageTo3DProvider,
  images: string[],
  maskDataUrl: string | null | undefined,
  context: ImageTo3DContext | undefined,
  inputHash: string,
  startedAt: number
) {
  if (canceledJobs.has(jobId)) return;

  const primaryImage = images[0];
  updateJob(jobId, {
    status: 'processing',
    progressPercent: 20,
    currentStep: 'submit_image',
    stepsCompleted: ['submit_image'],
    message: `Đang gửi ảnh đã tách nền (${images.length} góc) tới ${provider}...`,
  });

  if (provider === 'custom_endpoint') {
    const endpoint = process.env.IMAGE_TO_3D_ENDPOINT!;
    if (!isSafeExternalModelUrl(endpoint)) {
      throw new Error('IMAGE_TO_3D_ENDPOINT phải sử dụng HTTPS công khai hợp lệ.');
    }
    const res = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: primaryImage,
          images,
          mask: maskDataUrl || null,
          context: context || null,
        }),
      },
      { timeoutMs: 45000, maxRetries: 1 }
    );
    if (!res.ok) {
      throw new Error(`Custom endpoint trả mã lỗi HTTP ${res.status}`);
    }
    updateJob(jobId, {
      progressPercent: 75,
      currentStep: 'download_model',
      stepsCompleted: ['submit_image', 'receive_job_id', 'track_status', 'handle_completion'],
    });

    const contentType = res.headers.get('content-type') || '';
    let glbBuf: Buffer;
    let inspection: GlbInspectionReport | undefined;

    if (contentType.includes('model/gltf-binary') || contentType.includes('octet-stream')) {
      glbBuf = Buffer.from(await res.arrayBuffer());
      const check = validateGlbBuffer(glbBuf);
      if (!check.valid || !check.inspection) throw new Error(check.reason || 'GLB không hợp lệ');
      inspection = check.inspection;
    } else {
      const payload: any = await res.json();
      if (payload.glbBase64) {
        glbBuf = Buffer.from(payload.glbBase64, 'base64');
        const check = validateGlbBuffer(glbBuf);
        if (!check.valid || !check.inspection) throw new Error(check.reason || 'GLB không hợp lệ');
        inspection = check.inspection;
      } else if (payload.glbUrl) {
        const downloaded = await downloadAndValidateGlb(jobId, payload.glbUrl);
        glbBuf = downloaded.buf;
        inspection = downloaded.inspection;
      } else {
        throw new Error('Custom endpoint không trả về dữ liệu GLB hợp lệ.');
      }
    }

    storeGlb(jobId, glbBuf);
    inputHashToJobId.set(inputHash, jobId);
    updateJob(jobId, {
      status: 'completed',
      progressPercent: 100,
      currentStep: 'validate_output',
      stepsCompleted: [
        'submit_image',
        'receive_job_id',
        'track_status',
        'handle_completion',
        'download_model',
        'validate_output',
      ],
      elapsedMs: Date.now() - startedAt,
      glbUrl: `/api/reconstruction/${jobId}/model.glb`,
      glbByteLength: glbBuf.length,
      glbInspection: inspection,
      message: 'Đã tái tạo & kiểm chứng mesh GLB thành công từ endpoint tùy chỉnh.',
    });
    return;
  }

  if (provider === 'tripo3d') {
    const key = process.env.TRIPO_API_KEY;
    if (!key) throw new Error('Thiếu TRIPO_API_KEY');

    // Step 1: Upload primary (and optional multi-view) PNG/JPEG assets to Tripo3D
    const uploadAsset = async (dataUrl: string, idx: number): Promise<string> => {
      const b64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!b64Match) throw new Error('Tripo3D yêu cầu ảnh base64 Data URL hợp lệ.');
      const imgBytes = Buffer.from(b64Match[2], 'base64');
      const form = new FormData();
      form.append('file', new Blob([imgBytes], { type: b64Match[1] || 'image/png' }), `object_${idx}.png`);

      const uploadRes = await fetchWithRetry(
        'https://api.tripo3d.ai/v2/openapi/upload',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        },
        { timeoutMs: 25000, maxRetries: 2 }
      );
      const uploadJson: any = await uploadRes.json();
      const fileToken = uploadJson?.data?.image_token;
      if (!uploadRes.ok || !fileToken) {
        throw new Error(uploadJson?.message || 'Tripo3D upload ảnh thất bại.');
      }
      return fileToken;
    };

    const fileTokens: string[] = [];
    for (let i = 0; i < images.length; i++) {
      if (canceledJobs.has(jobId)) return;
      fileTokens.push(await uploadAsset(images[i], i));
    }

    updateJob(jobId, {
      progressPercent: 35,
      currentStep: 'receive_job_id',
      stepsCompleted: ['submit_image'],
      message: 'Đang khởi tạo tác vụ Tripo3D (PBR + GLB)...',
    });

    // Step 2: Create multiview_to_model (if >= 2 images) or image_to_model task
    const taskPayload =
      fileTokens.length >= 2
        ? {
            type: 'multiview_to_model',
            files: fileTokens.map((token) => ({ type: 'png', file_token: token })),
            pbr: true,
            texture: true,
          }
        : {
            type: 'image_to_model',
            file: { type: 'png', file_token: fileTokens[0] },
            pbr: true,
            texture: true,
          };

    let taskRes = await fetchWithRetry(
      'https://api.tripo3d.ai/v2/openapi/task',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(taskPayload),
      },
      { timeoutMs: 20000, maxRetries: 1 }
    );
    let taskJson: any = await taskRes.json();

    // If multiview payload rejected by account tier, transparently fall back to single-image task
    if ((!taskRes.ok || !taskJson?.data?.task_id) && taskPayload.type === 'multiview_to_model') {
      taskRes = await fetchWithRetry(
        'https://api.tripo3d.ai/v2/openapi/task',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            type: 'image_to_model',
            file: { type: 'png', file_token: fileTokens[0] },
            pbr: true,
            texture: true,
          }),
        },
        { timeoutMs: 20000, maxRetries: 1 }
      );
      taskJson = await taskRes.json();
    }

    const taskId = taskJson?.data?.task_id;
    if (!taskRes.ok || !taskId) {
      throw new Error(taskJson?.message || 'Không thể khởi tạo task Tripo3D.');
    }

    updateJob(jobId, {
      progressPercent: 45,
      currentStep: 'track_status',
      stepsCompleted: ['submit_image', 'receive_job_id'],
      message: `Tripo3D đang sinh lưới & PBR texture (Task ${taskId.slice(0, 8)})...`,
    });

    // Step 3: Poll task up to ~75s
    let modelDownloadUrl: string | null = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      if (canceledJobs.has(jobId)) return;
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetchWithRetry(
        `https://api.tripo3d.ai/v2/openapi/task/${taskId}`,
        { headers: { Authorization: `Bearer ${key}` } },
        { timeoutMs: 12000, maxRetries: 1 }
      );
      const pollJson: any = await pollRes.json();
      const st = pollJson?.data?.status;
      const pct = Number(pollJson?.data?.progress || 50);
      updateJob(jobId, { progressPercent: Math.min(88, Math.max(45, pct)) });

      if (st === 'success') {
        modelDownloadUrl =
          pollJson?.data?.output?.pbr_model || pollJson?.data?.output?.model || null;
        break;
      }
      if (st === 'failed' || st === 'cancelled' || st === 'unknown') {
        throw new Error(`Tripo3D dừng với trạng thái ${st}`);
      }
    }

    if (!modelDownloadUrl) {
      throw new Error('Hết thời gian chờ hoặc không nhận được URL GLB từ Tripo3D.');
    }

    updateJob(jobId, {
      progressPercent: 92,
      currentStep: 'download_model',
      stepsCompleted: ['submit_image', 'receive_job_id', 'track_status', 'handle_completion'],
      message: 'Đang tải & kiểm tra cấu trúc GLB từ Tripo3D...',
    });

    const { buf: glbBuf, inspection } = await downloadAndValidateGlb(jobId, modelDownloadUrl);
    storeGlb(jobId, glbBuf);
    inputHashToJobId.set(inputHash, jobId);
    quotaState.totalCreditsEstimated += estimateProviderCredits('tripo3d', images.length);

    updateJob(jobId, {
      status: 'completed',
      progressPercent: 100,
      currentStep: 'validate_output',
      stepsCompleted: [
        'submit_image',
        'receive_job_id',
        'track_status',
        'handle_completion',
        'download_model',
        'validate_output',
      ],
      elapsedMs: Date.now() - startedAt,
      glbUrl: `/api/reconstruction/${jobId}/model.glb`,
      glbByteLength: glbBuf.length,
      glbInspection: inspection,
      message: `Hoàn tất tái tạo & kiểm chứng mesh thật GLB từ Tripo3D (${inspection.meshCount} mesh, ${inspection.textureCount} texture).`,
    });
    return;
  }

  if (provider === 'meshy') {
    const key = process.env.MESHY_API_KEY;
    if (!key) throw new Error('Thiếu MESHY_API_KEY');

    const createRes = await fetchWithRetry(
      'https://api.meshy.ai/openapi/v1/image-to-3d',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          image_url: primaryImage,
          enable_pbr: true,
          should_texture: true,
          topology: 'triangle',
          target_polycount: 30000,
        }),
      },
      { timeoutMs: 25000, maxRetries: 1 }
    );
    const createJson: any = await createRes.json();
    const taskId = createJson?.result;
    if (!createRes.ok || !taskId) {
      throw new Error(createJson?.message || 'Khởi tạo Meshy Image-to-3D thất bại.');
    }

    updateJob(jobId, {
      progressPercent: 40,
      currentStep: 'track_status',
      stepsCompleted: ['submit_image', 'receive_job_id'],
      message: `Meshy đang tái tạo mesh 3D & PBR texture (Task ${String(taskId).slice(0, 8)})...`,
    });

    let modelDownloadUrl: string | null = null;
    for (let attempt = 0; attempt < 26; attempt++) {
      if (canceledJobs.has(jobId)) return;
      await new Promise((r) => setTimeout(r, 3500));
      const pollRes = await fetchWithRetry(
        `https://api.meshy.ai/openapi/v1/image-to-3d/${taskId}`,
        { headers: { Authorization: `Bearer ${key}` } },
        { timeoutMs: 12000, maxRetries: 1 }
      );
      const pollJson: any = await pollRes.json();
      updateJob(jobId, {
        progressPercent: Math.min(88, Math.max(40, Number(pollJson?.progress || 45))),
      });
      if (pollJson?.status === 'SUCCEEDED') {
        modelDownloadUrl = pollJson?.model_urls?.glb || null;
        break;
      }
      if (pollJson?.status === 'FAILED' || pollJson?.status === 'EXPIRED' || pollJson?.status === 'CANCELED') {
        throw new Error(`Meshy thất bại với trạng thái ${pollJson.status}`);
      }
    }

    if (!modelDownloadUrl) {
      throw new Error('Hết thời gian chờ hoặc không nhận được URL GLB từ Meshy.');
    }

    updateJob(jobId, {
      progressPercent: 92,
      currentStep: 'download_model',
      stepsCompleted: ['submit_image', 'receive_job_id', 'track_status', 'handle_completion'],
      message: 'Đang tải & kiểm tra cấu trúc GLB từ Meshy...',
    });

    const { buf: glbBuf, inspection } = await downloadAndValidateGlb(jobId, modelDownloadUrl);
    storeGlb(jobId, glbBuf);
    inputHashToJobId.set(inputHash, jobId);
    quotaState.totalCreditsEstimated += estimateProviderCredits('meshy', 1);

    updateJob(jobId, {
      status: 'completed',
      progressPercent: 100,
      currentStep: 'validate_output',
      stepsCompleted: [
        'submit_image',
        'receive_job_id',
        'track_status',
        'handle_completion',
        'download_model',
        'validate_output',
      ],
      elapsedMs: Date.now() - startedAt,
      glbUrl: `/api/reconstruction/${jobId}/model.glb`,
      glbByteLength: glbBuf.length,
      glbInspection: inspection,
      message: `Hoàn tất tái tạo & kiểm chứng mesh thật GLB từ Meshy (${inspection.meshCount} mesh, ${inspection.textureCount} texture).`,
    });
  }
}
