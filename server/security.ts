import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

const PUBLIC_ROOT = path.resolve(process.cwd(), 'public');
const MAX_IMAGE_DATA_BYTES = 10 * 1024 * 1024; // 10MB

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,80}$/;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const DANGEROUS_TAG_REGEX = /<\s*\/?\s*(?:script|iframe|object|embed|style|link|meta|svg)[^>]*>/gi;
const EVENT_HANDLER_REGEX = /\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SECRET_LEAK_REGEX = /(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

/**
 * Security headers applied to all HTTP responses.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

/**
 * Lightweight request latency logger that never prints auth headers, tokens, or base64 image blobs.
 */
export function safeRequestLoggerMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api')) {
    return next();
  }
  const startedAt = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const ms = Date.now() - startedAt;
    const safePath = req.path.replace(SECRET_LEAK_REGEX, '[REDACTED]').slice(0, 120);
    console.info(`[API] ${req.method} ${safePath} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  message?: string;
}

interface RateBucket {
  timestamps: number[];
}

const allLimiterStores: Map<string, RateBucket>[] = [];

export function resetAllRateLimitersForTest() {
  for (const store of allLimiterStores) {
    store.clear();
  }
}

function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Sliding-window per-IP rate limiter middleware.
 * Returns HTTP 429 with Retry-After and normalized JSON error when quota is exceeded.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RateBucket>();
  allLimiterStores.push(store);

  const maxRequests = Math.max(1, options.maxRequests);
  const windowMs = Math.max(1000, options.windowMs);

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const clientIp = resolveClientIp(req);
    const key = `${options.keyPrefix}:${clientIp}`;

    let bucket = store.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      store.set(key, bucket);
    }

    const cutoff = now - windowMs;
    while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= cutoff) {
      bucket.timestamps.shift();
    }

    if (bucket.timestamps.length >= maxRequests) {
      const oldestInWindow = bucket.timestamps[0] || now;
      const retryAfterMs = Math.max(1000, windowMs - (now - oldestInWindow));
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        retryAfterSeconds,
        error:
          options.message ||
          `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${retryAfterSeconds} giây.`,
      });
    }

    bucket.timestamps.push(now);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - bucket.timestamps.length)));

    // Periodic pruning to keep memory bounded
    if (store.size > 500) {
      for (const [k, b] of store.entries()) {
        if (b.timestamps.length === 0 || b.timestamps[b.timestamps.length - 1] <= cutoff) {
          store.delete(k);
        }
      }
    }

    next();
  };
}

/**
 * Validates route `:id` params strictly to prevent path traversal or header injection.
 */
export function sanitizeIdParam(rawId: unknown): string | null {
  if (typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  if (!SAFE_ID_REGEX.test(trimmed)) return null;
  return trimmed;
}

/**
 * Strips control characters, HTML script/iframe tags, and inline event handlers from text inputs.
 */
export function sanitizeText(raw: unknown, maxLength = 500): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(CONTROL_CHAR_REGEX, '')
    .replace(DANGEROUS_TAG_REGEX, '')
    .replace(EVENT_HANDLER_REGEX, '')
    .replace(/javascript\s*:/gi, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitizes error messages to prevent API keys, tokens, or filesystem paths from leaking to clients.
 */
export function sanitizeErrorMessage(err: unknown, fallback = 'Đã xảy ra lỗi xử lý máy chủ.'): string {
  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : fallback;
  if (!rawMsg || typeof rawMsg !== 'string') return fallback;
  const cleaned = rawMsg
    .replace(SECRET_LEAK_REGEX, '[REDACTED_KEY]')
    .replace(/\/(?:app|Users|home|var|tmp)\/[^\s'"]+/g, '[PATH]')
    .replace(CONTROL_CHAR_REGEX, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 320) : fallback;
}

/**
 * Verifies real binary magic bytes inside a base64 image buffer (JPEG, PNG, WebP).
 */
export function hasValidImageMagicBytes(
  buffer: Buffer,
  declaredMime: string
): boolean {
  if (buffer.length < 12) return false;
  const mime = declaredMime.toLowerCase();

  // JPEG: FF D8 FF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  // WebP: RIFF....WEBP
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (mime === 'image/jpeg' || mime === 'image/jpg') return isJpeg;
  if (mime === 'image/png') return isPng;
  if (mime === 'image/webp') return isWebp;
  return isJpeg || isPng || isWebp;
}

/**
 * Validates client-submitted image data URLs (with binary magic-byte inspection) or local /assets/ paths.
 * Blocks external HTTP/HTTPS URLs to prevent SSRF and rejects spoofed MIME types.
 */
export function validateClientImageInput(
  rawImg: unknown,
  maxBytes = MAX_IMAGE_DATA_BYTES
): { ok: true; value: string; byteLength: number } | { ok: false; status: number; error: string } {
  if (typeof rawImg !== 'string' || !rawImg.trim()) {
    return { ok: false, status: 400, error: 'Thiếu dữ liệu hình ảnh.' };
  }
  const trimmed = rawImg.trim();

  if (/^(https?:|ftp:|file:|javascript:|vbscript:)/i.test(trimmed)) {
    return {
      ok: false,
      status: 400,
      error:
        'Máy chủ từ chối tải URL ảnh bên ngoài (chống SSRF). Vui lòng dùng Data URL hợp lệ hoặc ảnh nội bộ.',
    };
  }

  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if (!match) {
      return {
        ok: false,
        status: 400,
        error: 'Định dạng Data URL không hợp lệ (chỉ hỗ trợ JPEG, PNG, WebP).',
      };
    }
    const mime = match[1].toLowerCase();
    const b64 = match[2].replace(/\s+/g, '');
    const estimatedBytes = Math.floor((b64.length * 3) / 4);
    if (estimatedBytes > maxBytes) {
      return { ok: false, status: 413, error: 'Kích thước ảnh vượt quá giới hạn 10MB.' };
    }

    // Decode first 32 chars (24 bytes) for magic-byte verification without allocating excess memory
    const prefixBuf = Buffer.from(b64.slice(0, 32), 'base64');
    if (!hasValidImageMagicBytes(prefixBuf, mime)) {
      return {
        ok: false,
        status: 400,
        error: 'Nội dung nhị phân ảnh không khớp với chữ ký JPEG/PNG/WebP thực tế.',
      };
    }

    return { ok: true, value: trimmed, byteLength: estimatedBytes };
  }

  if (trimmed.startsWith('/assets/')) {
    const resolved = path.resolve(PUBLIC_ROOT, trimmed.replace(/^\/+/, ''));
    if (!resolved.startsWith(PUBLIC_ROOT + path.sep) || !fs.existsSync(resolved)) {
      return { ok: false, status: 400, error: 'Tệp ảnh mẫu nội bộ không tồn tại.' };
    }
    return { ok: true, value: trimmed, byteLength: fs.statSync(resolved).size };
  }

  return { ok: false, status: 400, error: 'Nguồn ảnh không được hỗ trợ.' };
}

/**
 * Validates coverImage / avatar strings stored in CRUD records (community, projects, profile).
 * Allows internal `/assets/...`, validated magic-byte `data:image/...`, or public HTTPS URLs (no private IPs / XSS schemes).
 */
export function validateSafeMediaUrl(
  raw: unknown,
  fallback = '/assets/aistudio/image_9cb5bb6a.png'
): string {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const trimmed = raw.trim();

  if (trimmed.startsWith('/assets/')) {
    const resolved = path.resolve(PUBLIC_ROOT, trimmed.replace(/^\/+/, ''));
    if (resolved.startsWith(PUBLIC_ROOT + path.sep) && fs.existsSync(resolved)) {
      return trimmed;
    }
    return fallback;
  }

  if (trimmed.startsWith('data:')) {
    const checked = validateClientImageInput(trimmed, 5 * 1024 * 1024);
    return checked.ok ? checked.value : fallback;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return fallback;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function hashCanonicalPayload(payload: unknown): string {
  const json = JSON.stringify(payload ?? null);
  return crypto.createHash('sha256').update(json).digest('hex');
}
