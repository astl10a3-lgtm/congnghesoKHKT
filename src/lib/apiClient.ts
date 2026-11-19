export class ApiClientError extends Error {
  status: number;
  code?: string;
  retryAfterSeconds?: number;

  constructor(
    message: string,
    status = 500,
    code?: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  deduplicateKey?: string;
}

const inFlightClientRequests = new Map<string, Promise<any>>();
const AUTH_TOKEN_STORAGE_KEY = 'recycle_studio_auth_token';

export function getStoredAuthToken(): string | null {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token && token.trim()) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction errors
  }
}

/**
 * Unified API client with:
 * - AbortController timeout support
 * - In-flight request deduplication for identical GETs or keyed calls
 * - Automatic Bearer session token attachment
 * - Clean normalized Vietnamese error messages (429 rate-limit, 413 payload, timeout, offline)
 */
export async function apiFetch<T = any>(
  url: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs = 45000, deduplicateKey, headers, ...rest } = options;
  const method = (rest.method || 'GET').toUpperCase();
  const dedupKey = deduplicateKey || (method === 'GET' ? `GET:${url}` : undefined);

  if (dedupKey && inFlightClientRequests.has(dedupKey)) {
    return inFlightClientRequests.get(dedupKey)!;
  }

  const execute = async (): Promise<T> => {
    const controller = new AbortController();
    const externalSignal = rest.signal;

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const mergedHeaders = new Headers(headers);
      if (rest.body && typeof rest.body === 'string' && !mergedHeaders.has('Content-Type')) {
        mergedHeaders.set('Content-Type', 'application/json');
      }
      const token = getStoredAuthToken();
      if (token && !mergedHeaders.has('Authorization')) {
        mergedHeaders.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(url, {
        ...rest,
        method,
        headers: mergedHeaders,
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const payload = isJson ? await response.json().catch(() => null) : null;

      if (!response.ok) {
        const retryHeader = Number(response.headers.get('retry-after')) || payload?.retryAfterSeconds;
        if (response.status === 429) {
          throw new ApiClientError(
            payload?.error ||
              `Tần suất yêu cầu vượt giới hạn. Vui lòng thử lại sau ${retryHeader || 15} giây.`,
            429,
            'RATE_LIMITED',
            retryHeader
          );
        }
        if (response.status === 413) {
          throw new ApiClientError(
            payload?.error || 'Dung lượng ảnh hoặc dữ liệu tải lên vượt quá giới hạn cho phép.',
            413,
            'PAYLOAD_TOO_LARGE'
          );
        }
        throw new ApiClientError(
          payload?.error || `Lỗi máy chủ (${response.status}). Vui lòng thử lại.`,
          response.status,
          payload?.code
        );
      }

      if (payload && payload.success === false) {
        throw new ApiClientError(
          payload.error || 'Yêu cầu xử lý không thành công.',
          response.status,
          payload.code
        );
      }

      return payload as T;
    } catch (err: any) {
      if (err instanceof ApiClientError) throw err;
      if (err?.name === 'AbortError') {
        throw new ApiClientError(
          'Hết thời gian chờ kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.',
          408,
          'TIMEOUT'
        );
      }
      throw new ApiClientError(
        err?.message || 'Không thể kết nối tới máy chủ Recycle Art Studio.',
        0,
        'NETWORK_ERROR'
      );
    } finally {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  };

  const promise = execute();
  if (dedupKey) {
    inFlightClientRequests.set(dedupKey, promise);
    promise.finally(() => {
      inFlightClientRequests.delete(dedupKey);
    });
  }
  return promise;
}

/**
 * Validates user-selected image file BEFORE reading/compressing in canvas:
 * checks MIME, file size (<= 15MB), and binary magic bytes (JPEG, PNG, WebP).
 */
export async function validateClientImageFile(
  file: File
): Promise<{ ok: true } | { ok: false; error: string }> {
  const MAX_RAW_FILE_BYTES = 15 * 1024 * 1024;
  const allowedMimes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

  if (!file) return { ok: false, error: 'Chưa chọn tệp ảnh.' };
  if (file.size > MAX_RAW_FILE_BYTES) {
    return {
      ok: false,
      error: `Ảnh "${file.name}" vượt quá 15MB (${(file.size / 1024 / 1024).toFixed(1)}MB). Vui lòng chọn ảnh nhẹ hơn.`,
    };
  }
  if (file.type && !allowedMimes.has(file.type.toLowerCase())) {
    return {
      ok: false,
      error: `Định dạng "${file.type}" không được hỗ trợ. Vui lòng chọn JPEG, PNG hoặc WebP.`,
    };
  }

  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (header.length < 12) {
      return { ok: false, error: 'Tệp ảnh bị lỗi hoặc quá nhỏ.' };
    }
    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isPng =
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47;
    const isWebp =
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50;

    if (!isJpeg && !isPng && !isWebp) {
      return {
        ok: false,
        error: `Tệp "${file.name}" không mang chữ ký ảnh JPEG/PNG/WebP hợp lệ.`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Không thể đọc dữ liệu ảnh từ thiết bị.' };
  }
}
