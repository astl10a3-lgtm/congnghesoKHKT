import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type {
  AccountRole,
  AdminAccountRecord,
  AdminAuditLogItem,
  AdminDashboardData,
  AuthUser,
} from '../types/account';
import { ModalDialog } from './ui/ModalDialog';
import { ErrorBanner, LoadingState } from './ui/StatusFeedback';

interface AdminAccountsViewProps {
  currentUser: AuthUser;
  onNotify: (msg: string) => void;
  onCurrentUserUpdated: (updated: AuthUser) => void;
}

type RoleFilter = 'all' | 'admin' | 'member' | 'locked';

const AUDIT_ACTION_LABELS: Record<AdminAuditLogItem['action'], string> = {
  create_account: 'Tạo tài khoản',
  change_password: 'Đổi mật khẩu',
  view_passwords: 'Xem mật khẩu',
  update_role: 'Đổi vai trò',
  toggle_status: 'Khóa / Mở khóa',
  update_profile: 'Sửa thông tin',
  delete_account: 'Xóa tài khoản',
};

function formatDateTime(iso?: string): string {
  if (!iso) return 'Chưa có';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function generateStrongPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const AdminAccountsView: React.FC<AdminAccountsViewProps> = ({
  currentUser,
  onNotify,
  onCurrentUserUpdated,
}) => {
  const [accounts, setAccounts] = useState<AdminAccountRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [showAllPasswords, setShowAllPasswords] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Change password modal state
  const [passwordModalTarget, setPasswordModalTarget] = useState<AdminAccountRecord | null>(null);
  const [nextPassword, setNextPassword] = useState('');
  const [showModalPassword, setShowModalPassword] = useState(true);
  const [passwordModalError, setPasswordModalError] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // Create account modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<AccountRole>('member');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchAdminData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<{ success: boolean; data: AdminDashboardData }>(
        '/api/admin/accounts',
        { timeoutMs: 15000 }
      );
      if (res.success && res.data) {
        setAccounts(res.data.accounts);
        setAuditLogs(res.data.auditLogs);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Không thể tải danh sách tài khoản quản trị.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAdminData();
  }, [fetchAdminData]);

  const stats = useMemo(
    () => ({
      totalAccounts: accounts.length,
      adminCount: accounts.filter((a) => a.role === 'admin').length,
      activeCount: accounts.filter((a) => a.status === 'active').length,
      auditCount: auditLogs.length,
    }),
    [accounts, auditLogs]
  );

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (filter === 'admin' && acc.role !== 'admin') return false;
      if (filter === 'member' && acc.role !== 'member') return false;
      if (filter === 'locked' && acc.status !== 'locked') return false;
      if (!q) return true;
      return (
        acc.username.toLowerCase().includes(q) ||
        acc.name.toLowerCase().includes(q) ||
        acc.id.toLowerCase().includes(q)
      );
    });
  }, [accounts, filter, searchQuery]);

  const handleToggleRevealPassword = async (acc: AdminAccountRecord) => {
    const currentlyShown = showAllPasswords || Boolean(revealedIds[acc.id]);
    if (currentlyShown) {
      setRevealedIds((prev) => ({ ...prev, [acc.id]: false }));
      if (showAllPasswords) setShowAllPasswords(false);
      return;
    }

    setRevealedIds((prev) => ({ ...prev, [acc.id]: true }));
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { account: AdminAccountRecord; auditLogs: AdminAuditLogItem[] };
      }>(`/api/admin/accounts/${acc.id}/reveal-password`, {
        method: 'POST',
      });
      if (res.success && res.data) {
        setAccounts((prev) => prev.map((x) => (x.id === acc.id ? res.data.account : x)));
        setAuditLogs(res.data.auditLogs);
      }
    } catch {
      // Keep UI reveal responsive even if audit log request is throttled
    }
  };

  const handleCopyPassword = async (acc: AdminAccountRecord) => {
    try {
      await navigator.clipboard.writeText(acc.password);
      setCopiedId(acc.id);
      setTimeout(() => setCopiedId((prev) => (prev === acc.id ? null : prev)), 1800);
      onNotify(`Đã sao chép mật khẩu của "${acc.username}".`);
    } catch {
      onNotify('Trình duyệt không cho phép sao chép tự động.');
    }
  };

  const handleOpenChangePassword = (acc: AdminAccountRecord) => {
    setPasswordModalTarget(acc);
    setNextPassword('');
    setPasswordModalError(null);
    setShowModalPassword(true);
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModalTarget) return;
    if (nextPassword.trim().length < 4) {
      setPasswordModalError('Mật khẩu mới phải dài ít nhất 4 ký tự.');
      return;
    }

    setIsSavingPassword(true);
    setPasswordModalError(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        message: string;
        data: { account: AdminAccountRecord; auditLogs: AdminAuditLogItem[] };
      }>(`/api/admin/accounts/${passwordModalTarget.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: nextPassword.trim() }),
      });

      if (res.success && res.data) {
        setAccounts((prev) =>
          prev.map((x) => (x.id === passwordModalTarget.id ? res.data.account : x))
        );
        setAuditLogs(res.data.auditLogs);
        setRevealedIds((prev) => ({ ...prev, [passwordModalTarget.id]: true }));
        onNotify(res.message);
        setPasswordModalTarget(null);
      }
    } catch (err: any) {
      setPasswordModalError(err?.message || 'Không thể lưu mật khẩu mới.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleUpdateRoleOrStatus = async (
    acc: AdminAccountRecord,
    patch: { role?: AccountRole; status?: 'active' | 'locked' }
  ) => {
    setBusyAccountId(acc.id);
    try {
      const res = await apiFetch<{
        success: boolean;
        message: string;
        data: { account: AdminAccountRecord; auditLogs: AdminAuditLogItem[] };
      }>(`/api/admin/accounts/${acc.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (res.success && res.data) {
        setAccounts((prev) => prev.map((x) => (x.id === acc.id ? res.data.account : x)));
        setAuditLogs(res.data.auditLogs);
        if (acc.id === currentUser.id) {
          const { password: _omit, ...publicFields } = res.data.account;
          onCurrentUserUpdated(publicFields);
        }
        onNotify(res.message);
      }
    } catch (err: any) {
      onNotify(err?.message || 'Lỗi cập nhật tài khoản.');
    } finally {
      setBusyAccountId(null);
    }
  };

  const handleDeleteAccount = async (acc: AdminAccountRecord) => {
    setBusyAccountId(acc.id);
    try {
      const res = await apiFetch<{
        success: boolean;
        message: string;
        data: { auditLogs: AdminAuditLogItem[] };
      }>(`/api/admin/accounts/${acc.id}`, {
        method: 'DELETE',
      });
      if (res.success) {
        setAccounts((prev) => prev.filter((x) => x.id !== acc.id));
        setAuditLogs(res.data.auditLogs);
        setConfirmDeleteId(null);
        onNotify(res.message);
      }
    } catch (err: any) {
      onNotify(err?.message || 'Không thể xóa tài khoản.');
    } finally {
      setBusyAccountId(null);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    const cleanUser = newUsername.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,32}$/.test(cleanUser)) {
      setCreateError('Tên tài khoản phải 3–32 ký tự (chữ thường, số, dấu chấm hoặc gạch dưới).');
      return;
    }
    if (newPassword.trim().length < 4) {
      setCreateError('Mật khẩu tối thiểu 4 ký tự.');
      return;
    }

    setIsCreating(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        message: string;
        data: { account: AdminAccountRecord; auditLogs: AdminAuditLogItem[] };
      }>('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({
          username: cleanUser,
          name: newName.trim() || cleanUser,
          password: newPassword.trim(),
          role: newRole,
        }),
      });
      if (res.success && res.data) {
        setAccounts((prev) => [...prev, res.data.account]);
        setAuditLogs(res.data.auditLogs);
        setRevealedIds((prev) => ({ ...prev, [res.data.account.id]: true }));
        setShowCreateModal(false);
        setNewUsername('');
        setNewName('');
        setNewPassword('');
        setNewRole('member');
        onNotify(res.message);
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Không thể tạo tài khoản.');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading && accounts.length === 0) {
    return <LoadingState title="Đang tải dữ liệu tài khoản hệ thống..." />;
  }

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb + Action Header */}
      <div className="bg-white border border-emerald-200/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-2xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Hệ thống</span>
            <span aria-hidden="true">/</span>
            <span className="font-semibold text-[#0A5C36]">Quản trị tài khoản</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[#0284C7]">@{currentUser.username}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#0A5C36] tracking-tight">
            Quản lý tài khoản & Mật khẩu hệ thống
          </h1>
          <p className="text-xs sm:text-sm text-slate-600">
            Xem toàn bộ tài khoản trong database, kiểm tra hoặc đổi mật khẩu — mọi thay đổi được lưu tức thời vào hệ thống.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void fetchAdminData()}
            className="min-h-[42px] px-3.5 py-2 rounded-xl border border-emerald-200/80 bg-white hover:bg-[#F0FDF4] text-[#0A5C36] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
            className="min-h-[42px] px-4 py-2 rounded-xl eco-btn-primary text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tạo tài khoản</span>
          </button>
        </div>
      </div>

      {loadError && (
        <ErrorBanner title="Không thể tải bảng quản trị" message={loadError} onRetry={fetchAdminData} />
      )}

      {/* 4-Column Flat KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 space-y-1 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Tổng tài khoản</p>
          <p className="text-2xl font-bold text-[#0A5C36] tabular-nums">{stats.totalAccounts}</p>
        </div>
        <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 space-y-1 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Tài khoản Admin</p>
          <p className="text-2xl font-bold text-[#0284C7] tabular-nums">{stats.adminCount}</p>
        </div>
        <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 space-y-1 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Đang hoạt động</p>
          <p className="text-2xl font-bold text-[#10B981] tabular-nums">{stats.activeCount}</p>
        </div>
        <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 space-y-1 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Thao tác đã lưu</p>
          <p className="text-2xl font-bold text-[#0284C7] tabular-nums">{stats.auditCount}</p>
        </div>
      </div>

      {/* Accounts Table Surface */}
      <div className="bg-white border border-emerald-200/80 rounded-2xl overflow-hidden shadow-2xs">
        {/* Filter & Search Toolbar */}
        <div className="p-4 border-b border-emerald-100 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:flex-none sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên tài khoản hoặc họ tên..."
                className="w-full min-h-[40px] pl-9 pr-3 py-1.5 rounded-xl border border-emerald-200 bg-[#F0FDF4]/60 focus:bg-white text-xs text-slate-900 focus:outline-none focus:border-[#059669]"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#F0FDF4] border border-emerald-200/70 rounded-xl">
              {(
                [
                  { id: 'all', label: 'Tất cả' },
                  { id: 'admin', label: 'Admin' },
                  { id: 'member', label: 'Thành viên' },
                  { id: 'locked', label: 'Đã khóa' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    filter === tab.id
                      ? 'bg-white text-[#0A5C36] shadow-xs border border-emerald-200/60'
                      : 'text-slate-600 hover:text-[#0A5C36]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAllPasswords((v) => !v)}
            className="min-h-[38px] px-3 py-1.5 rounded-xl border border-emerald-200/80 hover:bg-[#F0FDF4] text-xs font-semibold text-[#0A5C36] flex items-center gap-1.5 self-start lg:self-auto whitespace-nowrap cursor-pointer"
          >
            {showAllPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showAllPasswords ? 'Ẩn tất cả mật khẩu' : 'Hiện tất cả mật khẩu'}</span>
          </button>
        </div>

        {/* High-Density Data Table */}
        <div className="overflow-x-auto bg-white">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="eco-table-head text-[11px] font-semibold">
                <th className="py-3 px-4">Tài khoản</th>
                <th className="py-3 px-4">Vai trò</th>
                <th className="py-3 px-4">Mật khẩu trong hệ thống</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Cập nhật / Đăng nhập</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-100 text-xs bg-white">
              {filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                    Không tìm thấy tài khoản nào khớp bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((acc) => {
                  const isPrimaryAdmin = acc.username.toLowerCase() === 'adminkhkt';
                  const isPasswordVisible = showAllPasswords || Boolean(revealedIds[acc.id]);
                  const isBusy = busyAccountId === acc.id;

                  return (
                    <tr key={acc.id} className="hover:bg-[#F0FDF4]/60 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={acc.avatar || '/assets/aistudio/image_9cb5bb6a.png'}
                            alt={acc.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-lg object-cover bg-slate-100 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate max-w-[180px]">
                              {acc.name}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500 truncate">
                              @{acc.username}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <select
                          aria-label={`Vai trò của ${acc.username}`}
                          value={acc.role}
                          disabled={isPrimaryAdmin || isBusy}
                          onChange={(e) =>
                            void handleUpdateRoleOrStatus(acc, {
                              role: e.target.value as AccountRole,
                            })
                          }
                          className="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800 disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer"
                        >
                          <option value="admin">Quản trị (Admin)</option>
                          <option value="member">Thành viên</option>
                        </select>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg min-w-[110px] inline-block tabular-nums">
                            {isPasswordVisible ? acc.password || '(trống)' : '••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleToggleRevealPassword(acc)}
                            title={isPasswordVisible ? 'Ẩn mật khẩu' : 'Xem mật khẩu'}
                            aria-label={isPasswordVisible ? 'Ẩn mật khẩu' : 'Xem mật khẩu'}
                            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                          >
                            {isPasswordVisible ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyPassword(acc)}
                            title="Sao chép mật khẩu"
                            aria-label="Sao chép mật khẩu"
                            className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                          >
                            {copiedId === acc.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <button
                          type="button"
                          disabled={isPrimaryAdmin || isBusy}
                          onClick={() =>
                            void handleUpdateRoleOrStatus(acc, {
                              status: acc.status === 'active' ? 'locked' : 'active',
                            })
                          }
                          className={`min-h-[34px] px-2.5 py-1 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60 cursor-pointer ${
                            acc.status === 'active'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                          }`}
                        >
                          {acc.status === 'active' ? (
                            <>
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Hoạt động</span>
                            </>
                          ) : (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              <span>Đã khóa</span>
                            </>
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4 text-slate-600 tabular-nums">
                        <div>Đổi MK: {formatDateTime(acc.passwordUpdatedAt)}</div>
                        <div className="text-[11px] text-slate-400">
                          Đăng nhập: {formatDateTime(acc.lastLoginAt)}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenChangePassword(acc)}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-[#0284C7] hover:bg-[#0369A1] text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Đổi MK</span>
                          </button>

                          {!isPrimaryAdmin && acc.id !== currentUser.id && (
                            confirmDeleteId === acc.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleDeleteAccount(acc)}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                                >
                                  Xác nhận
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="min-h-[34px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(acc.id)}
                                title="Xóa tài khoản"
                                aria-label={`Xóa tài khoản ${acc.username}`}
                                className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-500 hover:text-rose-700 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Audit Log Panel */}
      <div className="bg-white border border-emerald-200/80 rounded-2xl overflow-hidden shadow-2xs">
        <div className="px-4 py-3.5 border-b border-emerald-100 bg-[#F0FDF4]/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#0A5C36] shrink-0" />
            <h2 className="text-sm font-bold text-[#0A5C36]">
              Nhật ký thao tác đã lưu vào hệ thống
            </h2>
          </div>
          <span className="text-xs text-[#0284C7] font-semibold tabular-nums">
            {auditLogs.length} bản ghi gần nhất
          </span>
        </div>

        <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {auditLogs.length === 0 ? (
            <div className="py-8 px-4 text-center text-xs text-slate-500">
              Chưa có thao tác quản trị nào được ghi nhận. Mọi thay đổi từ Admin sẽ hiển thị và lưu ngay tại đây.
            </div>
          ) : (
            auditLogs.map((log) => (
              <div
                key={log.id}
                className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2 text-slate-700">
                  <span className="font-mono font-semibold text-slate-900">
                    @{log.adminUsername}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-emerald-700">
                    {AUDIT_ACTION_LABELS[log.action] || log.action}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{log.detail}</span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
                  {formatDateTime(log.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Change Password Modal */}
      {passwordModalTarget && (
        <ModalDialog
          title={`Đổi mật khẩu cho @${passwordModalTarget.username}`}
          subtitle="Mật khẩu mới sẽ được mã hóa và lưu trực tiếp vào database ngay lập tức"
          onClose={() => setPasswordModalTarget(null)}
          maxWidthClass="max-w-md"
        >
          <form onSubmit={handleSavePassword} className="space-y-4">
            {passwordModalError && (
              <ErrorBanner title="Không thể đổi mật khẩu" message={passwordModalError} />
            )}

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-2">
              <span>Mật khẩu hiện tại:</span>
              <span className="font-mono font-semibold text-slate-900">
                {passwordModalTarget.password || '(chưa đặt)'}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="admin-next-password" className="text-xs font-semibold text-slate-700">
                  Mật khẩu mới (4–64 ký tự)
                </label>
                <button
                  type="button"
                  onClick={() => setNextPassword(generateStrongPassword())}
                  className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  Tạo mật khẩu ngẫu nhiên
                </button>
              </div>
              <div className="relative">
                <input
                  id="admin-next-password"
                  type={showModalPassword ? 'text' : 'password'}
                  value={nextPassword}
                  onChange={(e) => setNextPassword(e.target.value)}
                  placeholder="Nhập mật khẩu mới..."
                  className="w-full min-h-[44px] pl-3.5 pr-11 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 focus:outline-none focus:border-emerald-600"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowModalPassword((v) => !v)}
                  aria-label={showModalPassword ? 'Ẩn' : 'Hiện'}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                >
                  {showModalPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPasswordModalTarget(null)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSavingPassword}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {isSavingPassword ? 'Đang lưu...' : 'Lưu mật khẩu ngay'}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}

      {/* Create Account Modal */}
      {showCreateModal && (
        <ModalDialog
          title="Tạo tài khoản mới"
          subtitle="Tài khoản mới được lưu ngay vào database và có thể đăng nhập tức thì"
          onClose={() => setShowCreateModal(false)}
          maxWidthClass="max-w-md"
        >
          <form onSubmit={handleCreateAccount} className="space-y-3.5">
            {createError && <ErrorBanner title="Lỗi tạo tài khoản" message={createError} />}

            <div className="space-y-1.5">
              <label htmlFor="create-username" className="block text-xs font-semibold text-slate-700">
                Tên tài khoản
              </label>
              <input
                id="create-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="VD: hocsinh01"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="create-name" className="block text-xs font-semibold text-slate-700">
                Tên hiển thị
              </label>
              <input
                id="create-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="VD: Nguyễn Văn A"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="create-password" className="text-xs font-semibold text-slate-700">
                  Mật khẩu
                </label>
                <button
                  type="button"
                  onClick={() => setNewPassword(generateStrongPassword())}
                  className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  Tạo tự động
                </button>
              </div>
              <input
                id="create-password"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nhập mật khẩu ban đầu"
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="create-role" className="block text-xs font-semibold text-slate-700">
                Vai trò
              </label>
              <select
                id="create-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AccountRole)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="member">Thành viên (Member)</option>
                <option value="admin">Quản trị viên (Admin)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
              >
                {isCreating ? 'Đang tạo...' : 'Tạo & Lưu ngay'}
              </button>
            </div>
          </form>
        </ModalDialog>
      )}
    </div>
  );
};
