import type { NextFunction, Request, Response } from 'express';
import {
  db,
  toPublicUser,
  type AdminAuditAction,
  type AdminAuditLog,
  type PublicUserProfile,
  type UserProfile,
} from './db.ts';
import { decryptPassword, verifyAuthToken } from './cryptoVault.ts';

export interface AuthenticatedRequest extends Request {
  authUser?: UserProfile;
}

export interface AdminAccountView extends PublicUserProfile {
  password: string;
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function resolveRequestUser(req: Request): UserProfile | null {
  const token = extractBearerToken(req);
  if (!token) return null;
  const payload = verifyAuthToken(token);
  if (!payload) return null;

  const state = db.get();
  const found = state.users.find((u) => u.id === payload.uid);
  if (!found || found.status === 'locked') return null;
  return found;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Bạn cần đăng nhập để thực hiện thao tác này.',
      code: 'AUTH_REQUIRED',
    });
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
      code: 'TOKEN_INVALID',
    });
  }

  const state = db.get();
  const user = state.users.find((u) => u.id === payload.uid);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Tài khoản không còn tồn tại trong hệ thống.',
      code: 'USER_NOT_FOUND',
    });
  }

  if (user.status === 'locked') {
    return res.status(403).json({
      success: false,
      error: 'Tài khoản của bạn đã bị quản trị viên tạm khóa.',
      code: 'ACCOUNT_LOCKED',
    });
  }

  req.authUser = user;
  return next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => {
    if (!req.authUser || req.authUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Chức năng này chỉ dành cho tài khoản Quản trị viên (Admin).',
        code: 'ADMIN_ONLY',
      });
    }
    return next();
  });
}

export function toAdminAccountView(user: UserProfile): AdminAccountView {
  return {
    ...toPublicUser(user),
    password: decryptPassword(user.passwordEncrypted || ''),
  };
}

export function appendAdminAuditLog(
  state: { adminAuditLogs: AdminAuditLog[] },
  admin: UserProfile,
  action: AdminAuditAction,
  detail: string,
  target?: { id?: string; username?: string }
): AdminAuditLog {
  const entry: AdminAuditLog = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    adminId: admin.id,
    adminUsername: admin.username,
    action,
    targetAccountId: target?.id,
    targetUsername: target?.username,
    detail,
    createdAt: new Date().toISOString(),
  };
  if (!Array.isArray(state.adminAuditLogs)) {
    state.adminAuditLogs = [];
  }
  state.adminAuditLogs.unshift(entry);
  if (state.adminAuditLogs.length > 250) {
    state.adminAuditLogs = state.adminAuditLogs.slice(0, 250);
  }
  return entry;
}

export function validateUsernameInput(raw: unknown): { ok: true; username: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Tên tài khoản là bắt buộc.' };
  }
  const normalized = raw.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,32}$/.test(normalized)) {
    return {
      ok: false,
      error: 'Tên tài khoản phải dài 3–32 ký tự và chỉ gồm chữ thường không dấu, số, dấu chấm hoặc gạch dưới.',
    };
  }
  return { ok: true, username: normalized };
}

export function validatePasswordInput(raw: unknown): { ok: true; password: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Mật khẩu là bắt buộc.' };
  }
  const trimmed = raw.trim();
  if (trimmed.length < 4 || trimmed.length > 64) {
    return { ok: false, error: 'Mật khẩu phải có độ dài từ 4 đến 64 ký tự.' };
  }
  if (/[\r\n\0]/.test(trimmed)) {
    return { ok: false, error: 'Mật khẩu chứa ký tự điều khiển không hợp lệ.' };
  }
  return { ok: true, password: trimmed };
}
