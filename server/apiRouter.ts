import { Router } from 'express';
import { db, toPublicUser } from './db.ts';
import type { CommunityComment, UserProject, CommunityPost, MaterialItem, UserProfile } from './db.ts';
import { encryptPassword, signAuthToken, verifyPassword } from './cryptoVault.ts';
import {
  appendAdminAuditLog,
  requireAdmin,
  requireAuth,
  resolveRequestUser,
  toAdminAccountView,
  validatePasswordInput,
  validateUsernameInput,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  AiServiceError,
  analyzeRecycleMaterials,
  estimateGeometryPayload,
  generateCraft3DVisual,
  type AnalysisResult,
} from './gemini.ts';
import {
  cancelImageTo3DJob,
  getImageTo3DCapabilities,
  getImageTo3DGlbBuffer,
  getImageTo3DJob,
  isSafeExternalModelUrl,
  startImageTo3DJob,
} from './imageTo3D.ts';
import {
  validateContourPoints,
  validateNormalizedBBox,
  validateProfilePoints,
} from '../src/types/reconstruction.ts';
import { generatePhase7RecyclingAdvisor } from './recyclingAdvisor.ts';
import {
  createRateLimiter,
  sanitizeErrorMessage,
  sanitizeIdParam,
  sanitizeText,
  validateClientImageInput,
  validateSafeMediaUrl,
} from './security.ts';
import { CoalescingTtlCache } from './cache.ts';

export const apiRouter = Router();

const aiRateLimiter = createRateLimiter({
  keyPrefix: 'ai',
  windowMs: 60_000,
  maxRequests: Number(process.env.RATE_LIMIT_AI_MAX) || 25,
  message: 'Bạn đã gửi quá nhiều yêu cầu AI trong 1 phút. Vui lòng chờ giây lát trước khi thử lại.',
});

const crudRateLimiter = createRateLimiter({
  keyPrefix: 'crud',
  windowMs: 60_000,
  maxRequests: Number(process.env.RATE_LIMIT_CRUD_MAX) || 120,
  message: 'Tần suất thao tác dữ liệu vượt giới hạn. Vui lòng thử lại sau ít giây.',
});

export const analysisCache = new CoalescingTtlCache<AnalysisResult>({
  maxEntries: 24,
  ttlMs: 10 * 60 * 1000,
});

export const ideasCache = new CoalescingTtlCache<
  Awaited<ReturnType<typeof generatePhase7RecyclingAdvisor>>
>({
  maxEntries: 40,
  ttlMs: 12 * 60 * 1000,
});

// Check API & Reconstruction Capabilities status
apiRouter.get('/status', (_req, res) => {
  const hasGemini = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
  );
  const hasOpenAi = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_OPENAI_API_KEY'
  );
  const hasSamEndpoint = Boolean(
    process.env.SAM_API_ENDPOINT && isSafeExternalModelUrl(process.env.SAM_API_ENDPOINT)
  );

  res.json({
    success: true,
    hasGeminiApiKey: hasGemini,
    hasOpenAiApiKey: hasOpenAi,
    hasSamEndpoint,
    imageTo3D: getImageTo3DCapabilities(),
    availableEngines: ['gemini', 'chatgpt', 'dual'],
    defaultEngine: 'gemini',
    model: 'gemini-4-hydrogen',
    appName: 'Recycle Art Studio',
    cache: {
      analysis: analysisCache.stats(),
      ideas: ideasCache.stats(),
    },
    timestamp: new Date().toISOString(),
  });
});

// Server-side Segmentation validation & optional SAM endpoint proxy
apiRouter.post('/segment-object', aiRateLimiter, async (req, res) => {
  const body = req.body || {};
  const imgCheck = validateClientImageInput(body.image);
  if (!imgCheck.ok) {
    return res.status(imgCheck.status).json({ success: false, error: imgCheck.error });
  }

  const bbox = validateNormalizedBBox(body.boundingBox);
  if (body.boundingBox && !bbox) {
    return res.status(400).json({
      success: false,
      error: 'Bounding box không hợp lệ (tọa độ chuẩn hóa phải nằm trong [0, 1]).',
    });
  }

  const samEndpoint = process.env.SAM_API_ENDPOINT;
  if (samEndpoint && isSafeExternalModelUrl(samEndpoint)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const samRes = await fetch(samEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imgCheck.value, boundingBox: bbox }),
        signal: controller.signal,
      });
      if (samRes.ok) {
        const samData = await samRes.json();
        return res.json({
          success: true,
          engine: 'remote_sam',
          boundingBox: bbox,
          data: samData,
        });
      }
    } catch (err: any) {
      return res.status(502).json({
        success: false,
        error: `Remote SAM endpoint lỗi: ${sanitizeErrorMessage(err, 'Timeout')}`,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  res.json({
    success: true,
    engine: 'client_grabcut_validated',
    boundingBox: bbox,
    message:
      'Đã xác thực bounding box & chữ ký nhị phân ảnh. Tách nền chi tiết được thực thi trực tiếp bằng thuật toán GrabCut/Sobel trên trình duyệt.',
  });
});

// Pure CV + Mathematical Geometry estimation endpoint (works without external LLM key)
apiRouter.post('/estimate-geometry', crudRateLimiter, (req, res) => {
  try {
    const body = req.body || {};
    const heightCm = Number(body.heightCm);
    const widthCm = Number(body.widthCm);
    const depthCm =
      body.depthCm !== undefined && body.depthCm !== null ? Number(body.depthCm) : undefined;

    if (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 500) {
      return res.status(400).json({
        success: false,
        error: 'Chiều cao (heightCm) phải là số dương hợp lệ (0 < heightCm ≤ 500).',
      });
    }
    if (!Number.isFinite(widthCm) || widthCm <= 0 || widthCm > 500) {
      return res.status(400).json({
        success: false,
        error: 'Chiều rộng (widthCm) phải là số dương hợp lệ (0 < widthCm ≤ 500).',
      });
    }
    if (depthCm !== undefined && (!Number.isFinite(depthCm) || depthCm <= 0 || depthCm > 500)) {
      return res.status(400).json({
        success: false,
        error: 'Chiều sâu (depthCm) không hợp lệ.',
      });
    }

    const maskValid =
      typeof body.maskUrl === 'string' && body.maskUrl.trim()
        ? validateClientImageInput(body.maskUrl)
        : null;
    if (maskValid && !maskValid.ok) {
      return res.status(maskValid.status).json({ success: false, error: maskValid.error });
    }

    const cropValid =
      typeof body.croppedObjectUrl === 'string' && body.croppedObjectUrl.trim()
        ? validateClientImageInput(body.croppedObjectUrl)
        : null;
    if (cropValid && !cropValid.ok) {
      return res.status(cropValid.status).json({ success: false, error: cropValid.error });
    }

    const procValid =
      typeof body.processedImageUrl === 'string' && body.processedImageUrl.trim()
        ? validateClientImageInput(body.processedImageUrl)
        : null;
    if (procValid && !procValid.ok) {
      return res.status(procValid.status).json({ success: false, error: procValid.error });
    }

    const safeProfile = Array.isArray(body.silhouetteProfile)
      ? validateProfilePoints(body.silhouetteProfile).points
      : [];
    const safeContour = Array.isArray(body.contourPoints)
      ? validateContourPoints(body.contourPoints).points
      : [];

    const result = estimateGeometryPayload({
      materialName:
        typeof body.materialName === 'string' ? sanitizeText(body.materialName, 120) : undefined,
      category: body.category,
      geometryType: body.geometryType,
      shapeType: body.shapeType,
      heightCm,
      widthCm,
      depthCm,
      silhouetteProfile: safeProfile,
      contourPoints: safeContour,
      crossSectionShape: body.crossSectionShape,
      measurementMethod: body.measurementMethod,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      primaryColor: typeof body.primaryColor === 'string' ? sanitizeText(body.primaryColor, 20) : undefined,
      boundingBox: validateNormalizedBBox(body.boundingBox),
      maskUrl: maskValid && maskValid.ok ? maskValid.value : null,
      croppedObjectUrl: cropValid && cropValid.ok ? cropValid.value : null,
      processedImageUrl: procValid && procValid.ok ? procValid.value : null,
      imageQualityScore: typeof body.imageQualityScore === 'number' ? body.imageQualityScore : undefined,
      multiViewConsistency:
        typeof body.multiViewConsistency === 'number' ? body.multiViewConsistency : null,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Error in /api/estimate-geometry:', sanitizeErrorMessage(err));
    res.status(500).json({
      success: false,
      error: 'Lỗi ước lượng hình học 3D: ' + sanitizeErrorMessage(err, 'Không xác định'),
    });
  }
});

// Trigger async Image-to-3D GLB mesh reconstruction (Tripo3D / Meshy / Custom)
apiRouter.post('/reconstruct-3d', aiRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
    const primaryCandidate = body.image ?? (rawImages.length > 0 ? rawImages[0] : undefined);
    const imgCheck = validateClientImageInput(primaryCandidate);
    if (!imgCheck.ok) {
      return res.status(imgCheck.status).json({ success: false, error: imgCheck.error });
    }

    const validatedImages: string[] = [imgCheck.value];
    for (const candidate of rawImages) {
      if (candidate === primaryCandidate) continue;
      const check = validateClientImageInput(candidate);
      if (!check.ok) {
        return res.status(check.status).json({ success: false, error: check.error });
      }
      validatedImages.push(check.value);
    }

    let maskCheck: string | null = null;
    if (typeof body.maskDataUrl === 'string' && body.maskDataUrl.trim()) {
      const mRes = validateClientImageInput(body.maskDataUrl);
      if (!mRes.ok) {
        return res.status(mRes.status).json({ success: false, error: mRes.error });
      }
      maskCheck = mRes.value;
    }

    const job = await startImageTo3DJob({
      imageDataUrl: imgCheck.value,
      images: validatedImages,
      maskDataUrl: maskCheck,
      preferProvider: body.preferProvider,
      context: {
        analysisId:
          typeof body.analysisId === 'string' ? sanitizeText(body.analysisId, 80) : undefined,
        objectName:
          typeof body.objectName === 'string' ? sanitizeText(body.objectName, 120) : undefined,
        category: typeof body.category === 'string' ? sanitizeText(body.category, 40) : undefined,
        material: typeof body.material === 'string' ? sanitizeText(body.material, 40) : undefined,
        shapeType: typeof body.shapeType === 'string' ? sanitizeText(body.shapeType, 40) : undefined,
        dimensions:
          body.dimensions && typeof body.dimensions === 'object'
            ? {
                heightCm: Number(body.dimensions.heightCm) || null,
                widthCm: Number(body.dimensions.widthCm) || null,
                depthCm: Number(body.dimensions.depthCm) || null,
              }
            : undefined,
      },
    });

    res.json({ success: true, job, data: job, capabilities: getImageTo3DCapabilities() });
  } catch (err: any) {
    const status = Number(err?.statusCode) || 500;
    if (status !== 429) {
      console.error('Error in /api/reconstruct-3d:', sanitizeErrorMessage(err));
    }
    res.status(status).json({
      success: false,
      error: sanitizeErrorMessage(err, 'Không thể khởi tạo tác vụ Image-to-3D.'),
      quota: getImageTo3DCapabilities().quota,
    });
  }
});

apiRouter.get('/reconstruction/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã tác vụ 3D không hợp lệ.' });
  }
  const job = getImageTo3DJob(safeId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ dựng hình 3D.' });
  }
  res.json({ success: true, job, data: job });
});

apiRouter.delete('/reconstruction/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã tác vụ 3D không hợp lệ.' });
  }
  const job = cancelImageTo3DJob(safeId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tác vụ cần hủy.' });
  }
  res.json({ success: true, job, data: job });
});

apiRouter.get('/reconstruction/:id/model.glb', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã tệp GLB không hợp lệ.' });
  }
  const glb = getImageTo3DGlbBuffer(safeId);
  if (!glb) {
    return res.status(404).json({
      success: false,
      error: 'Chưa có tệp GLB hợp lệ cho tác vụ này.',
    });
  }
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.setHeader('Content-Disposition', `inline; filename="${safeId}.glb"`);
  res.send(glb);
});

// AI Multimodal Material Analysis (Gemini 4 Hydrogen / OpenAI GPT-4o / Dual)
// Includes strict binary image validation, in-flight request deduplication & bounded TTL cache
apiRouter.post('/analyze-materials', aiRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      images,
      angles,
      referenceObject,
      userNotes,
      aiEngine,
      focusOnSelection,
      boundingBox,
      bboxCroppedImageUrl,
      segmentedImageUrl,
      maskUrl,
      croppedObjectUrl,
      silhouetteProfile,
      calibratedDimensions,
      qualityReport,
      viewsMetadata,
      imageQualityScore,
      multiViewConsistency,
      bypassCache,
    } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cần cung cấp ít nhất 1 hình ảnh vật liệu.',
      });
    }
    if (images.length > 6) {
      return res.status(400).json({
        success: false,
        error: 'Tối đa 6 góc ảnh cho mỗi lần phân tích.',
      });
    }

    const validatedImages: string[] = [];
    for (const rawImg of images) {
      const check = validateClientImageInput(rawImg);
      if (!check.ok) {
        return res.status(check.status).json({ success: false, error: check.error });
      }
      validatedImages.push(check.value);
    }

    const validateOptionalDataUrl = (val: unknown): { ok: true; value: string | null } | { ok: false; status: number; error: string } => {
      if (typeof val !== 'string' || !val.trim()) return { ok: true, value: null };
      const check = validateClientImageInput(val);
      if (!check.ok) return check;
      return { ok: true, value: check.value };
    };

    const bboxCropCheck = validateOptionalDataUrl(bboxCroppedImageUrl);
    if (!bboxCropCheck.ok) {
      return res.status(bboxCropCheck.status).json({ success: false, error: bboxCropCheck.error });
    }
    const segImgCheck = validateOptionalDataUrl(segmentedImageUrl);
    if (!segImgCheck.ok) {
      return res.status(segImgCheck.status).json({ success: false, error: segImgCheck.error });
    }
    const maskImgCheck = validateOptionalDataUrl(maskUrl);
    if (!maskImgCheck.ok) {
      return res.status(maskImgCheck.status).json({ success: false, error: maskImgCheck.error });
    }
    const cropObjCheck = validateOptionalDataUrl(croppedObjectUrl);
    if (!cropObjCheck.ok) {
      return res.status(cropObjCheck.status).json({ success: false, error: cropObjCheck.error });
    }

    const sanitizedViewsMeta: any[] | undefined = Array.isArray(viewsMetadata)
      ? viewsMetadata.slice(0, 6).map((vm: any) => {
          const vmBboxCrop = validateOptionalDataUrl(vm?.bboxCroppedUrl);
          const vmProc = validateOptionalDataUrl(vm?.processedImageUrl);
          const vmMask = validateOptionalDataUrl(vm?.maskUrl);
          return {
            angle: typeof vm?.angle === 'string' ? sanitizeText(vm.angle, 30) : 'front',
            boundingBox: validateNormalizedBBox(vm?.boundingBox),
            bboxCroppedUrl: vmBboxCrop.ok ? vmBboxCrop.value : null,
            processedImageUrl: vmProc.ok ? vmProc.value : null,
            maskUrl: vmMask.ok ? vmMask.value : null,
          };
        })
      : undefined;

    const normalizedInput = {
      images: validatedImages,
      angles: Array.isArray(angles) ? angles.slice(0, 6).map((a: unknown) => sanitizeText(a, 30)) : undefined,
      referenceObject:
        referenceObject && typeof referenceObject === 'object'
          ? {
              type: sanitizeText(referenceObject.type || 'none', 40) as any,
              description: sanitizeText(referenceObject.description, 160),
            }
          : undefined,
      userNotes: typeof userNotes === 'string' ? sanitizeText(userNotes, 600) : undefined,
      aiEngine: aiEngine === 'chatgpt' || aiEngine === 'dual' ? aiEngine : ('gemini' as const),
      focusOnSelection: focusOnSelection !== false,
      boundingBox: validateNormalizedBBox(boundingBox),
      bboxCroppedImageUrl: bboxCropCheck.value,
      segmentedImageUrl: segImgCheck.value,
      maskUrl: maskImgCheck.value,
      croppedObjectUrl: cropObjCheck.value,
      silhouetteProfile: Array.isArray(silhouetteProfile)
        ? validateProfilePoints(silhouetteProfile).points
        : undefined,
      contourPoints: Array.isArray(body.contourPoints)
        ? validateContourPoints(body.contourPoints).points
        : undefined,
      calibratedDimensions: calibratedDimensions || null,
      qualityReport:
        qualityReport && typeof qualityReport === 'object'
          ? {
              status: sanitizeText(qualityReport.status || 'GOOD', 24),
              overallScore: Number(qualityReport.overallScore || 0),
              blurScore: typeof qualityReport.blurScore === 'number' ? qualityReport.blurScore : undefined,
              brightness: typeof qualityReport.brightness === 'number' ? qualityReport.brightness : undefined,
              contrast: typeof qualityReport.contrast === 'number' ? qualityReport.contrast : undefined,
              bboxAreaRatio:
                typeof qualityReport.bboxAreaRatio === 'number' ? qualityReport.bboxAreaRatio : undefined,
              reasons: Array.isArray(qualityReport.reasons)
                ? qualityReport.reasons.slice(0, 6).map((r: unknown) => sanitizeText(r, 140))
                : undefined,
            }
          : null,
      viewsMetadata: sanitizedViewsMeta,
      imageQualityScore: typeof imageQualityScore === 'number' ? imageQualityScore : undefined,
      multiViewConsistency:
        typeof multiViewConsistency === 'number' ? multiViewConsistency : null,
    };

    const cachedRun = await analysisCache.run(
      normalizedInput,
      () => analyzeRecycleMaterials(normalizedInput),
      { skipCache: Boolean(bypassCache) }
    );

    res.json({
      success: true,
      data: cachedRun.value,
      meta: {
        cached: cachedRun.cached,
        deduplicated: cachedRun.deduplicated,
        cacheKeyPrefix: cachedRun.cacheKeyPrefix,
      },
    });
  } catch (err: any) {
    if (err instanceof AiServiceError) {
      return res.status(err.statusCode).json({
        success: false,
        error: sanitizeErrorMessage(err, 'Lỗi dịch vụ AI Vision.'),
        code: err.code,
      });
    }
    console.error('API Error in /api/analyze-materials:', sanitizeErrorMessage(err));
    res.status(500).json({
      success: false,
      error: 'Lỗi phân tích hình ảnh AI: ' + sanitizeErrorMessage(err, 'Không xác định'),
    });
  }
});

// Phase 7: Material Reusability Analysis + Safe Recycling Ideas & 6-Stage Craft Guide
// Includes SHA-256 request coalescing & TTL caching
apiRouter.post('/recycling-ideas', aiRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const mat = body.material && typeof body.material === 'object' ? body.material : {};
    const recon =
      body.reconstruction && typeof body.reconstruction === 'object'
        ? body.reconstruction
        : mat.reconstruction && typeof mat.reconstruction === 'object'
        ? mat.reconstruction
        : {};

    const dims = body.dimensions || recon.dimensions || mat.dimensions || undefined;

    const advisorInput = {
      materialName: sanitizeText(
        typeof body.materialName === 'string'
          ? body.materialName
          : recon.object?.name || mat.name,
        140
      ),
      category: sanitizeText(
        typeof body.category === 'string'
          ? body.category
          : recon.object?.category || mat.category,
        40
      ),
      materialDetail: sanitizeText(
        typeof body.materialDetail === 'string'
          ? body.materialDetail
          : recon.object?.material || mat.recycleCode,
        80
      ),
      materialConfidence:
        typeof body.materialConfidence === 'number'
          ? body.materialConfidence
          : recon.object?.materialConfidence,
      status: sanitizeText(typeof body.status === 'string' ? body.status : mat.status, 40),
      condition: sanitizeText(
        typeof body.condition === 'string' ? body.condition : mat.condition,
        300
      ),
      dimensions: dims
        ? {
            shapeType: dims.shapeType,
            lengthCm: Number(dims.lengthCm) || undefined,
            widthCm: Number(dims.widthCm) || undefined,
            heightCm: Number(dims.heightCm) || undefined,
            diameterCm: Number(dims.diameterCm || dims.maxDiameterCm) || undefined,
          }
        : undefined,
      deformations: Array.isArray(body.deformations)
        ? body.deformations.slice(0, 10)
        : recon.object?.deformations,
      components: Array.isArray(body.components)
        ? body.components.slice(0, 16)
        : recon.geometry?.components,
      uncertainties: Array.isArray(body.uncertainties)
        ? body.uncertainties.slice(0, 12)
        : recon.quality?.uncertainties,
      userNotes:
        typeof body.userNotes === 'string' ? sanitizeText(body.userNotes, 400) : undefined,
      allowAi: body.allowAi !== false,
    };

    const cachedRun = await ideasCache.run(
      advisorInput,
      () => generatePhase7RecyclingAdvisor(advisorInput),
      { skipCache: Boolean(body.bypassCache) }
    );

    res.json({
      success: true,
      data: cachedRun.value,
      meta: {
        cached: cachedRun.cached,
        deduplicated: cachedRun.deduplicated,
        cacheKeyPrefix: cachedRun.cacheKeyPrefix,
      },
    });
  } catch (err: any) {
    console.error('Error in /api/recycling-ideas:', sanitizeErrorMessage(err));
    res.status(500).json({
      success: false,
      error: 'Không thể tạo gợi ý tái chế Phase 7: ' + sanitizeErrorMessage(err, 'Lỗi không xác định'),
    });
  }
});

// Generate 3D Isometric visual mockup
apiRouter.post('/generate-craft-visual', aiRateLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const craftTitle = sanitizeText(body.craftTitle, 140);
    if (!craftTitle) {
      return res.status(400).json({ success: false, error: 'Thiếu tên sản phẩm (craftTitle).' });
    }
    const result = await generateCraft3DVisual({
      craftId: typeof body.craftId === 'string' ? sanitizeIdParam(body.craftId) || undefined : undefined,
      craftTitle,
      category: typeof body.category === 'string' ? sanitizeText(body.category, 40) : undefined,
      materialName:
        typeof body.materialName === 'string' ? sanitizeText(body.materialName, 120) : undefined,
      aiEngine: body.aiEngine === 'chatgpt' ? 'chatgpt' : 'gemini',
      userCustomPrompt:
        typeof body.userCustomPrompt === 'string'
          ? sanitizeText(body.userCustomPrompt, 350)
          : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'Lỗi tạo bản vẽ 3D: ' + sanitizeErrorMessage(err, 'Không xác định'),
    });
  }
});

// Material Inventory
apiRouter.get('/inventory', crudRateLimiter, (_req, res) => {
  const state = db.get();
  res.json({ success: true, data: state.materials });
});

apiRouter.post('/inventory', crudRateLimiter, (req, res) => {
  const item = (req.body || {}) as Partial<MaterialItem>;
  const safeName = sanitizeText(item.name, 140);
  if (!safeName) {
    return res.status(400).json({ success: false, error: 'Tên vật liệu là bắt buộc' });
  }
  const safeId = sanitizeIdParam(item.id) || 'mat_' + Date.now();
  const allowedCategories = new Set([
    'plastic',
    'paper',
    'metal',
    'glass',
    'fabric',
    'organic',
    'electronic',
    'other',
  ]);
  const allowedStatuses = new Set([
    'safe_to_use',
    'needs_cleaning',
    'needs_special_handling',
    'not_recommended',
  ]);
  const safeImages = Array.isArray(item.images)
    ? item.images
        .slice(0, 6)
        .map((img) => validateSafeMediaUrl(img, ''))
        .filter(Boolean)
    : [];

  const newItem: MaterialItem = {
    id: safeId,
    name: safeName,
    category: allowedCategories.has(String(item.category))
      ? (item.category as MaterialItem['category'])
      : 'other',
    categoryLabel: sanitizeText(item.categoryLabel, 60) || 'Vật liệu tái chế',
    recycleCode: item.recycleCode ? sanitizeText(item.recycleCode, 60) : undefined,
    images: safeImages,
    status: allowedStatuses.has(String(item.status))
      ? (item.status as MaterialItem['status'])
      : 'needs_cleaning',
    statusLabel: sanitizeText(item.statusLabel, 60) || 'Cần kiểm tra',
    condition: sanitizeText(item.condition, 300) || 'Đã quét & kiểm tra sơ bộ',
    color: sanitizeText(item.color, 50) || '#38bdf8',
    quantity: Math.max(1, Math.min(999, Number(item.quantity) || 1)),
    unit: sanitizeText(item.unit, 24) || 'cái',
    dimensions: item.dimensions && typeof item.dimensions === 'object'
      ? item.dimensions
      : {
          shapeType: 'cylinder',
          lengthCm: 10,
          widthCm: 10,
          heightCm: 20,
          usableSurfaceCm2: 300,
          totalSurfaceCm2: 400,
          usableRatioPercent: 75,
        },
    cleaningInstructions: Array.isArray(item.cleaningInstructions)
      ? item.cleaningInstructions.slice(0, 8).map((x) => sanitizeText(x, 240)).filter(Boolean)
      : [],
    safetyWarnings: Array.isArray(item.safetyWarnings)
      ? item.safetyWarnings.slice(0, 8).map((x) => sanitizeText(x, 240)).filter(Boolean)
      : [],
    guideStatus: item.guideStatus === 'completed' ? 'completed' : undefined,
    imageStatus: item.imageStatus === 'completed' ? 'completed' : undefined,
    dateAdded:
      typeof item.dateAdded === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dateAdded)
        ? item.dateAdded
        : new Date().toISOString().split('T')[0],
    reconstruction:
      item.reconstruction && typeof item.reconstruction === 'object'
        ? item.reconstruction
        : undefined,
  };

  db.update((state) => {
    state.materials.unshift(newItem);
  });
  res.json({ success: true, data: newItem });
});

apiRouter.put('/inventory/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã vật liệu không hợp lệ.' });
  }
  const body = req.body || {};
  let updatedItem: MaterialItem | null = null;

  db.update((state) => {
    const idx = state.materials.findIndex((m) => m.id === safeId);
    if (idx !== -1) {
      const existing = state.materials[idx];
      state.materials[idx] = {
        ...existing,
        ...(typeof body.name === 'string' && sanitizeText(body.name, 140)
          ? { name: sanitizeText(body.name, 140) }
          : {}),
        ...(typeof body.category === 'string' ? { category: body.category } : {}),
        ...(typeof body.categoryLabel === 'string'
          ? { categoryLabel: sanitizeText(body.categoryLabel, 60) }
          : {}),
        ...(typeof body.recycleCode === 'string'
          ? { recycleCode: sanitizeText(body.recycleCode, 60) }
          : {}),
        ...(typeof body.status === 'string' ? { status: body.status } : {}),
        ...(typeof body.statusLabel === 'string'
          ? { statusLabel: sanitizeText(body.statusLabel, 60) }
          : {}),
        ...(typeof body.condition === 'string'
          ? { condition: sanitizeText(body.condition, 300) }
          : {}),
        ...(typeof body.color === 'string' ? { color: sanitizeText(body.color, 50) } : {}),
        ...(typeof body.quantity === 'number'
          ? { quantity: Math.max(1, Math.min(999, body.quantity)) }
          : {}),
        ...(typeof body.unit === 'string' ? { unit: sanitizeText(body.unit, 24) } : {}),
        ...(body.dimensions && typeof body.dimensions === 'object'
          ? { dimensions: body.dimensions }
          : {}),
        ...(Array.isArray(body.cleaningInstructions)
          ? {
              cleaningInstructions: body.cleaningInstructions
                .slice(0, 8)
                .map((x: unknown) => sanitizeText(x, 240))
                .filter(Boolean),
            }
          : {}),
        ...(Array.isArray(body.safetyWarnings)
          ? {
              safetyWarnings: body.safetyWarnings
                .slice(0, 8)
                .map((x: unknown) => sanitizeText(x, 240))
                .filter(Boolean),
            }
          : {}),
        ...(body.reconstruction && typeof body.reconstruction === 'object'
          ? { reconstruction: body.reconstruction }
          : {}),
      };
      updatedItem = state.materials[idx];
    }
  });
  if (!updatedItem) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy vật liệu' });
  }
  res.json({ success: true, data: updatedItem });
});

apiRouter.delete('/inventory/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã vật liệu không hợp lệ.' });
  }
  db.update((state) => {
    state.materials = state.materials.filter((m) => m.id !== safeId);
  });
  res.json({ success: true, message: 'Đã xóa vật liệu' });
});

// User Projects
apiRouter.get('/projects', crudRateLimiter, (req, res) => {
  const activeUser = resolveRequestUser(req);
  const activeUserId = activeUser?.id || 'user_default';
  const state = db.get();
  const visible = state.projects.filter(
    (p) => p.userId === activeUserId || (!activeUser && p.userId === 'user_default')
  );
  res.json({ success: true, data: visible });
});

apiRouter.post('/projects', crudRateLimiter, (req, res) => {
  const activeUser = resolveRequestUser(req);
  const activeUserId = activeUser?.id || 'user_default';
  const project = (req.body || {}) as Partial<UserProject>;
  const safeTitle = sanitizeText(project.title, 160);
  if (!safeTitle) {
    return res.status(400).json({ success: false, error: 'Tiêu đề dự án là bắt buộc.' });
  }
  const safeStatus =
    project.status === 'completed' || project.status === 'idea' ? project.status : 'in_progress';

  const newProject: UserProject = {
    id: sanitizeIdParam(project.id) || 'proj_' + Date.now(),
    userId: activeUserId,
    title: safeTitle,
    description: sanitizeText(project.description, 800),
    status: safeStatus,
    progressPercent: Math.max(0, Math.min(100, Number(project.progressPercent) || 0)),
    currentStepIndex: Math.max(0, Number(project.currentStepIndex) || 0),
    coverImage: validateSafeMediaUrl(project.coverImage, '/assets/aistudio/image_9cb5bb6a.png'),
    model3DType: sanitizeText(project.model3DType, 60) || 'pen_holder',
    craftData: project.craftData as any,
    inputMaterials: Array.isArray(project.inputMaterials) ? project.inputMaterials.slice(0, 6) : [],
    finishedPhotos: Array.isArray(project.finishedPhotos)
      ? project.finishedPhotos.slice(0, 6).map((x) => validateSafeMediaUrl(x, '')).filter(Boolean)
      : [],
    userNotes: sanitizeText(project.userNotes, 600),
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0],
  };

  db.update((state) => {
    state.projects.unshift(newProject);
    const user = state.users.find((u) => u.id === activeUserId);
    if (user && newProject.status === 'completed') {
      user.totalCraftsMade += 1;
      user.savedWasteKg = Number((user.savedWasteKg + 0.5).toFixed(1));
    }
  });
  res.json({ success: true, data: newProject });
});

apiRouter.put('/projects/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã dự án không hợp lệ.' });
  }
  const body = req.body || {};
  let updatedProj: UserProject | null = null;
  db.update((state) => {
    const idx = state.projects.findIndex((p) => p.id === safeId);
    if (idx !== -1) {
      const existing = state.projects[idx];
      const wasCompleted = existing.status === 'completed';
      state.projects[idx] = {
        ...existing,
        ...(typeof body.title === 'string' && sanitizeText(body.title, 160)
          ? { title: sanitizeText(body.title, 160) }
          : {}),
        ...(typeof body.description === 'string'
          ? { description: sanitizeText(body.description, 800) }
          : {}),
        ...(body.status === 'in_progress' || body.status === 'completed' ? { status: body.status } : {}),
        ...(typeof body.progressPercent === 'number'
          ? { progressPercent: Math.max(0, Math.min(100, body.progressPercent)) }
          : {}),
        ...(typeof body.currentStepIndex === 'number'
          ? { currentStepIndex: Math.max(0, body.currentStepIndex) }
          : {}),
        ...(typeof body.coverImage === 'string'
          ? { coverImage: validateSafeMediaUrl(body.coverImage, existing.coverImage) }
          : {}),
        ...(typeof body.userNotes === 'string'
          ? { userNotes: sanitizeText(body.userNotes, 600) }
          : {}),
        ...(body.craftData && typeof body.craftData === 'object' ? { craftData: body.craftData } : {}),
        updatedAt: new Date().toISOString().split('T')[0],
      };
      updatedProj = state.projects[idx];

      if (!wasCompleted && updatedProj.status === 'completed') {
        const user = state.users.find((u) => u.id === 'user_default');
        if (user) {
          user.totalCraftsMade += 1;
          user.savedWasteKg = Number((user.savedWasteKg + 0.4).toFixed(1));
        }
      }
    }
  });
  if (!updatedProj) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy dự án' });
  }
  res.json({ success: true, data: updatedProj });
});

apiRouter.delete('/projects/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã dự án không hợp lệ.' });
  }
  db.update((state) => {
    state.projects = state.projects.filter((p) => p.id !== safeId);
  });
  res.json({ success: true, message: 'Đã xóa dự án' });
});

// Community Posts
apiRouter.get('/community', crudRateLimiter, (req, res) => {
  const activeUser = resolveRequestUser(req);
  const state = db.get();
  const userId = activeUser?.id || sanitizeIdParam(req.query.userId) || 'user_default';
  const likedPostIds = new Set(state.userLikes[userId] || []);
  const savedPostIds = new Set(state.savedProjects[userId] || []);

  const enriched = state.communityPosts.map((post) => ({
    ...post,
    isLiked: likedPostIds.has(post.id),
    isSaved: savedPostIds.has(post.id),
  }));

  res.json({ success: true, data: enriched });
});

apiRouter.get('/community/:id', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã bài đăng không hợp lệ.' });
  }
  const activeUser = resolveRequestUser(req);
  const state = db.get();
  const post = state.communityPosts.find((p) => p.id === safeId);
  if (!post) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy bài đăng' });
  }
  const userId = activeUser?.id || sanitizeIdParam(req.query.userId) || 'user_default';
  const isLiked = (state.userLikes[userId] || []).includes(post.id);
  const isSaved = (state.savedProjects[userId] || []).includes(post.id);

  res.json({
    success: true,
    data: {
      ...post,
      isLiked,
      isSaved,
    },
  });
});

apiRouter.post('/community', crudRateLimiter, (req, res) => {
  const body = (req.body || {}) as Partial<CommunityPost>;
  const safeTitle = sanitizeText(body.title, 160);
  if (!safeTitle) {
    return res.status(400).json({ success: false, error: 'Tiêu đề bài đăng là bắt buộc.' });
  }

  const activeUser = resolveRequestUser(req);
  const state = db.get();
  const user = activeUser || state.users.find((u) => u.id === 'user_default') || {
    name: 'Sáng Tạo Xanh (Bạn)',
    avatar: '/assets/aistudio/image_9cb5bb6a.png',
    id: 'user_default',
  };

  const safeCover = validateSafeMediaUrl(body.coverImage, '/assets/aistudio/image_9cb5bb6a.png');
  const safeAdditional = Array.isArray(body.additionalImages)
    ? body.additionalImages.slice(0, 6).map((x) => validateSafeMediaUrl(x, '')).filter(Boolean)
    : [];
  const safeDifficulty =
    body.difficulty === 'Trung bình' || body.difficulty === 'Khó' ? body.difficulty : 'Dễ';

  const newPost: CommunityPost = {
    id: 'post_' + Date.now(),
    projectId: body.projectId ? sanitizeIdParam(body.projectId) || undefined : undefined,
    title: safeTitle,
    authorId: user.id,
    authorName: user.name,
    authorAvatar: user.avatar,
    description: sanitizeText(body.description, 1200),
    coverImage: safeCover,
    additionalImages: safeAdditional,
    model3DType: sanitizeText(body.model3DType, 60) || 'pen_holder',
    materialsSourceDescription:
      sanitizeText(body.materialsSourceDescription, 400) || 'Thu gom từ gia đình & trường học',
    materialsSummary: Array.isArray(body.materialsSummary)
      ? body.materialsSummary.slice(0, 12).map((x) => sanitizeText(x, 120)).filter(Boolean)
      : [],
    toolsSummary: Array.isArray(body.toolsSummary)
      ? body.toolsSummary.slice(0, 12).map((x) => sanitizeText(x, 120)).filter(Boolean)
      : [],
    difficulty: safeDifficulty,
    estimatedTime: sanitizeText(body.estimatedTime, 40) || '30 phút',
    recycledRatio: Math.max(0, Math.min(100, Number(body.recycledRatio) || 100)),
    type: body.type === 'with_added_materials' ? 'with_added_materials' : '100_percent_recycled',
    dimensions: sanitizeText(body.dimensions, 80) || 'Tiêu chuẩn',
    steps: Array.isArray(body.steps) ? body.steps.slice(0, 16) : [],
    tipsAndLearnings: Array.isArray(body.tipsAndLearnings)
      ? body.tipsAndLearnings.slice(0, 8).map((x) => sanitizeText(x, 240)).filter(Boolean)
      : ['Cẩn thận với kéo và làm nhẵn các cạnh.'],
    likesCount: 1,
    commentsCount: 0,
    comments: [],
    visibility:
      body.visibility === 'private' || body.visibility === 'unlisted' ? body.visibility : 'public',
    guideStatus:
      body.guideStatus === 'completed' || body.guideStatus === 'pending'
        ? body.guideStatus
        : body.steps && body.steps.length > 0
        ? 'completed'
        : 'pending',
    imageStatus:
      body.imageStatus === 'completed' || body.imageStatus === 'pending'
        ? body.imageStatus
        : safeCover
        ? 'completed'
        : 'pending',
    createdAt: new Date().toISOString().split('T')[0],
  };

  db.update((s) => {
    s.communityPosts.unshift(newPost);
  });

  res.json({ success: true, data: newPost });
});

// Like / Unlike Post
apiRouter.post('/community/:id/like', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã bài đăng không hợp lệ.' });
  }
  const activeUser = resolveRequestUser(req);
  const body = req.body || {};
  const userId = activeUser?.id || sanitizeIdParam(body.userId) || 'user_default';
  let isLiked = false;
  let newLikesCount = 0;
  let found = false;

  db.update((state) => {
    const post = state.communityPosts.find((p) => p.id === safeId);
    if (!post) return;
    found = true;
    if (!state.userLikes[userId]) state.userLikes[userId] = [];
    const userLiked = state.userLikes[userId].includes(safeId);

    if (userLiked) {
      state.userLikes[userId] = state.userLikes[userId].filter((x) => x !== safeId);
      post.likesCount = Math.max(0, post.likesCount - 1);
      isLiked = false;
    } else {
      state.userLikes[userId].push(safeId);
      post.likesCount += 1;
      isLiked = true;
    }

    newLikesCount = post.likesCount;
  });

  if (!found) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy bài đăng' });
  }
  res.json({ success: true, isLiked, likesCount: newLikesCount });
});

// Add Comment (sanitized XSS-safe text)
apiRouter.post('/community/:id/comment', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã bài đăng không hợp lệ.' });
  }
  const body = req.body || {};
  const cleanText = sanitizeText(body.text, 600);
  if (!cleanText) {
    return res.status(400).json({ success: false, error: 'Bình luận không được để trống' });
  }

  const activeUser = resolveRequestUser(req);
  const state = db.get();
  const user = activeUser || state.users.find((u) => u.id === 'user_default');
  const cleanUserName = sanitizeText(body.userName, 80) || user?.name || 'Sáng Tạo Xanh (Bạn)';

  const newComment: CommunityComment = {
    id: 'c_' + Date.now(),
    userId: user?.id || 'user_default',
    userName: cleanUserName,
    userAvatar: user?.avatar || '/assets/aistudio/image_9cb5bb6a.png',
    text: cleanText,
    createdAt: new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }),
    likes: 0,
  };

  let found = false;
  db.update((s) => {
    const post = s.communityPosts.find((p) => p.id === safeId);
    if (post) {
      found = true;
      post.comments.push(newComment);
      post.commentsCount = post.comments.length;
    }
  });

  if (!found) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy bài đăng' });
  }
  res.json({ success: true, data: newComment });
});

// Toggle Save Idea
apiRouter.post('/community/:id/save', crudRateLimiter, (req, res) => {
  const safeId = sanitizeIdParam(req.params.id);
  if (!safeId) {
    return res.status(400).json({ success: false, error: 'Mã bài đăng không hợp lệ.' });
  }
  const activeUser = resolveRequestUser(req);
  const body = req.body || {};
  const userId = activeUser?.id || sanitizeIdParam(body.userId) || 'user_default';
  let isSaved = false;

  db.update((state) => {
    if (!state.savedProjects[userId]) state.savedProjects[userId] = [];
    const idx = state.savedProjects[userId].indexOf(safeId);
    if (idx !== -1) {
      state.savedProjects[userId].splice(idx, 1);
      isSaved = false;
    } else {
      state.savedProjects[userId].push(safeId);
      isSaved = true;
    }
  });

  res.json({ success: true, isSaved });
});

// Get Saved Ideas
apiRouter.get('/saved-ideas', crudRateLimiter, (req, res) => {
  const activeUser = resolveRequestUser(req);
  const userId = activeUser?.id || sanitizeIdParam(req.query.userId) || 'user_default';
  const state = db.get();
  const savedIds = new Set(state.savedProjects[userId] || []);
  const savedPosts = state.communityPosts
    .filter((p) => savedIds.has(p.id))
    .map((p) => ({
      ...p,
      isLiked: (state.userLikes[userId] || []).includes(p.id),
      isSaved: true,
    }));

  res.json({ success: true, data: savedPosts });
});

// User Profile (never leaks passwordEncrypted)
apiRouter.get('/profile', crudRateLimiter, (req, res) => {
  const activeUser = resolveRequestUser(req);
  const state = db.get();
  const user = activeUser || state.users[0];
  res.json({ success: true, data: user ? toPublicUser(user) : null });
});

apiRouter.put('/profile', crudRateLimiter, (req, res) => {
  const activeUser = resolveRequestUser(req);
  const targetUserId = activeUser?.id || 'user_default';
  const body = req.body || {};
  const safeName = typeof body.name === 'string' ? sanitizeText(body.name, 80) : '';
  const safeBio = typeof body.bio === 'string' ? sanitizeText(body.bio, 300) : undefined;
  let updated: any = null;

  db.update((state) => {
    const idx = state.users.findIndex((u) => u.id === targetUserId);
    if (idx !== -1) {
      const existing = state.users[idx];
      state.users[idx] = {
        ...existing,
        ...(safeName ? { name: safeName } : {}),
        ...(safeBio !== undefined ? { bio: safeBio } : {}),
        ...(typeof body.avatar === 'string'
          ? { avatar: validateSafeMediaUrl(body.avatar, existing.avatar) }
          : {}),
      };
      updated = toPublicUser(state.users[idx]);
    }
  });
  res.json({ success: true, data: updated });
});

// ==========================================
// ACCOUNT AUTHENTICATION ROUTES
// ==========================================

apiRouter.post('/auth/login', crudRateLimiter, (req, res) => {
  const body = req.body || {};
  const uCheck = validateUsernameInput(body.username);
  if (!uCheck.ok) {
    return res.status(400).json({ success: false, error: uCheck.error });
  }
  const pCheck = validatePasswordInput(body.password);
  if (!pCheck.ok) {
    return res.status(400).json({ success: false, error: pCheck.error });
  }

  const state = db.get();
  const account = state.users.find((u) => u.username.toLowerCase() === uCheck.username);
  if (!account || !verifyPassword(pCheck.password, account.passwordEncrypted)) {
    return res.status(401).json({
      success: false,
      error: 'Tên tài khoản hoặc mật khẩu không chính xác.',
      code: 'INVALID_CREDENTIALS',
    });
  }

  if (account.status === 'locked') {
    return res.status(403).json({
      success: false,
      error: 'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ quản trị viên.',
      code: 'ACCOUNT_LOCKED',
    });
  }

  let latestUser: UserProfile = account;
  db.update((s) => {
    const target = s.users.find((u) => u.id === account.id);
    if (target) {
      target.lastLoginAt = new Date().toISOString();
      latestUser = target;
    }
  });

  const token = signAuthToken({
    uid: latestUser.id,
    username: latestUser.username,
    role: latestUser.role,
  });

  res.json({
    success: true,
    token,
    user: toPublicUser(latestUser),
  });
});

apiRouter.post('/auth/register', crudRateLimiter, (req, res) => {
  const body = req.body || {};
  const uCheck = validateUsernameInput(body.username);
  if (!uCheck.ok) {
    return res.status(400).json({ success: false, error: uCheck.error });
  }
  const pCheck = validatePasswordInput(body.password);
  if (!pCheck.ok) {
    return res.status(400).json({ success: false, error: pCheck.error });
  }

  const state = db.get();
  const exists = state.users.some((u) => u.username.toLowerCase() === uCheck.username);
  if (exists) {
    return res.status(409).json({
      success: false,
      error: `Tên tài khoản "${uCheck.username}" đã tồn tại. Vui lòng chọn tên khác.`,
      code: 'USERNAME_EXISTS',
    });
  }

  const nowIso = new Date().toISOString();
  const safeName = sanitizeText(body.name, 80) || uCheck.username;
  const safeBio =
    sanitizeText(body.bio, 300) ||
    'Thành viên mới tại Recycle Art Studio — chung tay tái chế sáng tạo.';

  const newAccount: UserProfile = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    username: uCheck.username,
    name: safeName,
    avatar: '/assets/aistudio/image_9cb5bb6a.png',
    bio: safeBio,
    role: 'member',
    status: 'active',
    passwordEncrypted: encryptPassword(pCheck.password),
    passwordUpdatedAt: nowIso,
    lastLoginAt: nowIso,
    joinedDate: nowIso.split('T')[0],
    totalCraftsMade: 0,
    savedWasteKg: 0,
    totalLikesReceived: 0,
  };

  db.update((s) => {
    s.users.push(newAccount);
    s.userLikes[newAccount.id] = [];
    s.savedProjects[newAccount.id] = [];
  });

  const token = signAuthToken({
    uid: newAccount.id,
    username: newAccount.username,
    role: newAccount.role,
  });

  res.status(201).json({
    success: true,
    token,
    user: toPublicUser(newAccount),
  });
});

apiRouter.get('/auth/me', crudRateLimiter, requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({
    success: true,
    user: toPublicUser(req.authUser!),
  });
});

apiRouter.post(
  '/auth/change-own-password',
  crudRateLimiter,
  requireAuth,
  (req: AuthenticatedRequest, res) => {
    const body = req.body || {};
    const curCheck = validatePasswordInput(body.currentPassword);
    if (!curCheck.ok) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập mật khẩu hiện tại hợp lệ.' });
    }
    const nextCheck = validatePasswordInput(body.newPassword);
    if (!nextCheck.ok) {
      return res.status(400).json({ success: false, error: nextCheck.error });
    }

    const user = req.authUser!;
    if (!verifyPassword(curCheck.password, user.passwordEncrypted)) {
      return res.status(401).json({ success: false, error: 'Mật khẩu hiện tại không đúng.' });
    }

    let updatedUser: UserProfile = user;
    db.update((state) => {
      const target = state.users.find((u) => u.id === user.id);
      if (target) {
        target.passwordEncrypted = encryptPassword(nextCheck.password);
        target.passwordUpdatedAt = new Date().toISOString();
        updatedUser = target;
      }
    });

    res.json({
      success: true,
      message: 'Đã cập nhật mật khẩu tài khoản của bạn.',
      user: toPublicUser(updatedUser),
    });
  }
);

// ==========================================
// ADMIN ACCOUNT MANAGEMENT ROUTES (IMMEDIATE DB PERSISTENCE)
// ==========================================

apiRouter.get('/admin/accounts', crudRateLimiter, requireAdmin, (_req: AuthenticatedRequest, res) => {
  const state = db.get();
  const accounts = state.users.map(toAdminAccountView);
  res.json({
    success: true,
    data: {
      accounts,
      stats: {
        totalAccounts: accounts.length,
        adminCount: accounts.filter((a) => a.role === 'admin').length,
        activeCount: accounts.filter((a) => a.status === 'active').length,
        lockedCount: accounts.filter((a) => a.status === 'locked').length,
      },
      auditLogs: state.adminAuditLogs || [],
    },
  });
});

apiRouter.post('/admin/accounts', crudRateLimiter, requireAdmin, (req: AuthenticatedRequest, res) => {
  const admin = req.authUser!;
  const body = req.body || {};
  const uCheck = validateUsernameInput(body.username);
  if (!uCheck.ok) {
    return res.status(400).json({ success: false, error: uCheck.error });
  }
  const pCheck = validatePasswordInput(body.password);
  if (!pCheck.ok) {
    return res.status(400).json({ success: false, error: pCheck.error });
  }

  const state = db.get();
  if (state.users.some((u) => u.username.toLowerCase() === uCheck.username)) {
    return res.status(409).json({
      success: false,
      error: `Tài khoản "${uCheck.username}" đã tồn tại trong cơ sở dữ liệu.`,
    });
  }

  const role = body.role === 'admin' ? 'admin' : 'member';
  const nowIso = new Date().toISOString();
  const created: UserProfile = {
    id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    username: uCheck.username,
    name: sanitizeText(body.name, 80) || uCheck.username,
    avatar: '/assets/aistudio/image_9cb5bb6a.png',
    bio:
      sanitizeText(body.bio, 300) ||
      (role === 'admin'
        ? 'Quản trị viên hệ thống Recycle Art Studio.'
        : 'Thành viên Recycle Art Studio.'),
    role,
    status: 'active',
    passwordEncrypted: encryptPassword(pCheck.password),
    passwordUpdatedAt: nowIso,
    joinedDate: nowIso.split('T')[0],
    totalCraftsMade: 0,
    savedWasteKg: 0,
    totalLikesReceived: 0,
  };

  let auditLogs: any[] = [];
  db.update((s) => {
    s.users.push(created);
    s.userLikes[created.id] = [];
    s.savedProjects[created.id] = [];
    appendAdminAuditLog(
      s,
      admin,
      'create_account',
      `Tạo tài khoản mới "${created.username}" (vai trò: ${created.role}) và lưu ngay vào hệ thống.`,
      { id: created.id, username: created.username }
    );
    auditLogs = s.adminAuditLogs;
  });

  res.status(201).json({
    success: true,
    message: `Đã tạo và lưu tài khoản "${created.username}" vào hệ thống.`,
    data: {
      account: toAdminAccountView(created),
      auditLogs,
    },
  });
});

apiRouter.patch(
  '/admin/accounts/:id/password',
  crudRateLimiter,
  requireAdmin,
  (req: AuthenticatedRequest, res) => {
    const admin = req.authUser!;
    const safeId = sanitizeIdParam(req.params.id);
    if (!safeId) {
      return res.status(400).json({ success: false, error: 'Mã tài khoản không hợp lệ.' });
    }

    const pCheck = validatePasswordInput(req.body?.newPassword);
    if (!pCheck.ok) {
      return res.status(400).json({ success: false, error: pCheck.error });
    }

    let updatedAccount: UserProfile | null = null;
    let auditLogs: any[] = [];

    db.update((s) => {
      const target = s.users.find((u) => u.id === safeId);
      if (!target) return;
      target.passwordEncrypted = encryptPassword(pCheck.password);
      target.passwordUpdatedAt = new Date().toISOString();
      updatedAccount = target;
      appendAdminAuditLog(
        s,
        admin,
        'change_password',
        `Đổi mật khẩu cho tài khoản "${target.username}" và lưu tức thời vào database.`,
        { id: target.id, username: target.username }
      );
      auditLogs = s.adminAuditLogs;
    });

    if (!updatedAccount) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản cần đổi mật khẩu.' });
    }

    res.json({
      success: true,
      message: `Đã đổi và lưu mật khẩu mới cho "${(updatedAccount as UserProfile).username}" vào hệ thống.`,
      data: {
        account: toAdminAccountView(updatedAccount),
        auditLogs,
      },
    });
  }
);

apiRouter.post(
  '/admin/accounts/:id/reveal-password',
  crudRateLimiter,
  requireAdmin,
  (req: AuthenticatedRequest, res) => {
    const admin = req.authUser!;
    const safeId = sanitizeIdParam(req.params.id);
    if (!safeId) {
      return res.status(400).json({ success: false, error: 'Mã tài khoản không hợp lệ.' });
    }

    let targetView: ReturnType<typeof toAdminAccountView> | null = null;
    let auditLogs: any[] = [];

    db.update((s) => {
      const target = s.users.find((u) => u.id === safeId);
      if (!target) return;
      targetView = toAdminAccountView(target);
      appendAdminAuditLog(
        s,
        admin,
        'view_passwords',
        `Xem mật khẩu tài khoản "${target.username}" trong bảng quản trị.`,
        { id: target.id, username: target.username }
      );
      auditLogs = s.adminAuditLogs;
    });

    if (!targetView) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    }

    res.json({
      success: true,
      data: {
        account: targetView,
        auditLogs,
      },
    });
  }
);

apiRouter.patch(
  '/admin/accounts/:id',
  crudRateLimiter,
  requireAdmin,
  (req: AuthenticatedRequest, res) => {
    const admin = req.authUser!;
    const safeId = sanitizeIdParam(req.params.id);
    if (!safeId) {
      return res.status(400).json({ success: false, error: 'Mã tài khoản không hợp lệ.' });
    }

    const body = req.body || {};
    const state = db.get();
    const existing = state.users.find((u) => u.id === safeId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    }

    const isPrimaryAdmin = existing.username.toLowerCase() === 'adminkhkt';
    if (isPrimaryAdmin && body.status === 'locked') {
      return res.status(400).json({
        success: false,
        error: 'Không thể khóa tài khoản quản trị gốc adminkhkt.',
      });
    }
    if (isPrimaryAdmin && body.role === 'member') {
      return res.status(400).json({
        success: false,
        error: 'Không thể hạ quyền tài khoản quản trị gốc adminkhkt.',
      });
    }

    let updatedAccount: UserProfile = existing;
    let auditLogs: any[] = [];
    const changes: string[] = [];

    db.update((s) => {
      const target = s.users.find((u) => u.id === safeId);
      if (!target) return;

      if (typeof body.name === 'string') {
        const cleanName = sanitizeText(body.name, 80);
        if (cleanName && cleanName !== target.name) {
          target.name = cleanName;
          changes.push(`tên="${cleanName}"`);
        }
      }
      if (typeof body.bio === 'string') {
        const cleanBio = sanitizeText(body.bio, 300);
        if (cleanBio !== target.bio) {
          target.bio = cleanBio;
          changes.push('mô tả');
        }
      }
      if ((body.role === 'admin' || body.role === 'member') && body.role !== target.role) {
        target.role = body.role;
        changes.push(`vai trò=${body.role}`);
      }
      if ((body.status === 'active' || body.status === 'locked') && body.status !== target.status) {
        target.status = body.status;
        changes.push(`trạng thái=${body.status}`);
      }

      updatedAccount = target;
      const actionType =
        body.status && body.status !== existing.status
          ? 'toggle_status'
          : body.role && body.role !== existing.role
          ? 'update_role'
          : 'update_profile';

      appendAdminAuditLog(
        s,
        admin,
        actionType,
        changes.length > 0
          ? `Cập nhật tài khoản "${target.username}": ${changes.join(', ')}.`
          : `Lưu thông tin tài khoản "${target.username}".`,
        { id: target.id, username: target.username }
      );
      auditLogs = s.adminAuditLogs;
    });

    res.json({
      success: true,
      message: `Đã lưu cập nhật cho tài khoản "${updatedAccount.username}".`,
      data: {
        account: toAdminAccountView(updatedAccount),
        auditLogs,
      },
    });
  }
);

apiRouter.delete(
  '/admin/accounts/:id',
  crudRateLimiter,
  requireAdmin,
  (req: AuthenticatedRequest, res) => {
    const admin = req.authUser!;
    const safeId = sanitizeIdParam(req.params.id);
    if (!safeId) {
      return res.status(400).json({ success: false, error: 'Mã tài khoản không hợp lệ.' });
    }

    const state = db.get();
    const target = state.users.find((u) => u.id === safeId);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản cần xóa.' });
    }

    if (target.username.toLowerCase() === 'adminkhkt' || target.id === admin.id) {
      return res.status(400).json({
        success: false,
        error: 'Không thể xóa tài khoản quản trị đang đăng nhập hoặc tài khoản gốc adminkhkt.',
      });
    }

    let auditLogs: any[] = [];
    db.update((s) => {
      s.users = s.users.filter((u) => u.id !== safeId);
      delete s.userLikes[safeId];
      delete s.savedProjects[safeId];
      appendAdminAuditLog(
        s,
        admin,
        'delete_account',
        `Xóa tài khoản "${target.username}" (${target.name}) khỏi database.`,
        { id: target.id, username: target.username }
      );
      auditLogs = s.adminAuditLogs;
    });

    res.json({
      success: true,
      message: `Đã xóa tài khoản "${target.username}" khỏi hệ thống.`,
      data: { auditLogs },
    });
  }
);

