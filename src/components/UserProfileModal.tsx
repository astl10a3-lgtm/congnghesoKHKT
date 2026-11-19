import React, { useState } from 'react';
import {
  Award,
  TreePine,
  Heart,
  CheckCircle,
  Calendar,
  Edit2,
  Save,
  KeyRound,
  LogOut,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type { AuthUser } from '../types/account';
import { ModalDialog } from './ui/ModalDialog';

interface UserProfileModalProps {
  user: AuthUser;
  isAuthenticated: boolean;
  onClose: () => void;
  onUpdateProfile: (updated: Partial<AuthUser>) => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onOpenAdminDashboard?: () => void;
  onNotify?: (msg: string) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  user,
  isAuthenticated,
  onClose,
  onUpdateProfile,
  onOpenAuth,
  onLogout,
  onOpenAdminDashboard,
  onNotify,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSavingPwd, setIsSavingPwd] = useState(false);

  const handleSave = () => {
    onUpdateProfile({ name: name.trim(), bio: bio.trim() });
    setIsEditing(false);
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.trim().length < 4) {
      setPasswordError('Mật khẩu mới tối thiểu 4 ký tự.');
      return;
    }
    setIsSavingPwd(true);
    try {
      const res = await apiFetch<{ success: boolean; message: string }>(
        '/api/auth/change-own-password',
        {
          method: 'POST',
          body: JSON.stringify({
            currentPassword,
            newPassword: newPassword.trim(),
          }),
        }
      );
      if (res.success) {
        setCurrentPassword('');
        setNewPassword('');
        setShowChangePassword(false);
        onNotify?.(res.message || 'Đã đổi mật khẩu thành công!');
      }
    } catch (err: any) {
      setPasswordError(err?.message || 'Không thể đổi mật khẩu.');
    } finally {
      setIsSavingPwd(false);
    }
  };

  return (
    <ModalDialog
      title={isAuthenticated ? `Tài khoản @${user.username}` : 'Hồ sơ Sáng Tạo Xanh'}
      subtitle={
        isAuthenticated
          ? 'Quản lý thông tin tài khoản, bảo mật và đóng góp tái chế'
          : 'Theo dõi đóng góp giảm rác thải và hoạt động cộng đồng'
      }
      onClose={onClose}
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-5">
        {/* User Card Top */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <img
              src={user.avatar || '/assets/aistudio/image_9cb5bb6a.png'}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-cover ring-2 ring-emerald-500/20 bg-slate-100 shrink-0"
            />
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <h4 className="font-extrabold text-slate-900 text-base sm:text-lg truncate">
                  {user.name}
                </h4>
                <span aria-hidden="true">·</span>
                <span className="text-xs font-semibold text-emerald-700">
                  {user.role === 'admin' ? 'Quản trị viên (Admin)' : 'Thành viên Xanh'}
                </span>
              </div>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span>
                  @{user.username} · Tham gia từ {user.joinedDate}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Admin Quick Action */}
        {isAuthenticated && user.role === 'admin' && onOpenAdminDashboard && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenAdminDashboard();
            }}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl eco-btn-primary text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-[#4ADE80]" />
            <span>Mở bảng quản trị tài khoản & Mật khẩu hệ thống</span>
          </button>
        )}

        {/* Bio Section */}
        <div className="p-4 rounded-2xl bg-[#F0FDF4]/70 border border-emerald-200/80 text-xs text-slate-700 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#0A5C36]">Giới thiệu & Mục tiêu xanh</span>
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="min-h-[36px] px-2.5 py-1 rounded-lg text-[#059669] hover:bg-emerald-100/70 font-bold text-xs flex items-center gap-1 cursor-pointer"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Hủy' : 'Chỉnh sửa'}</span>
            </button>
          </div>

          {isEditing ? (
            <div className="space-y-3 pt-1">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tên hiển thị"
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
              />
              <textarea
                rows={3}
                defaultValue={bio}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.max(90, el.scrollHeight)}px`;
                  setBio(el.value);
                }}
                onBlur={(e) => setBio(e.currentTarget.value)}
                enterKeyHint="enter"
                inputMode="text"
                className="w-full min-h-[90px] p-3 rounded-xl border border-slate-300 bg-white text-sm resize-y touch-auto select-text whitespace-pre-wrap"
              />
              <button
                type="button"
                onClick={handleSave}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Lưu thông tin</span>
              </button>
            </div>
          ) : (
            <p className="leading-relaxed text-slate-600">{user.bio}</p>
          )}
        </div>

        {/* Own Password Section (for signed-in accounts) */}
        {isAuthenticated && (
          <div className="border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <KeyRound className="w-4 h-4 text-slate-600" />
                <span>Bảo mật mật khẩu</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowChangePassword((v) => !v);
                  setPasswordError(null);
                }}
                className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 cursor-pointer"
              >
                {showChangePassword ? 'Đóng' : 'Đổi mật khẩu'}
              </button>
            </div>

            {showChangePassword && (
              <form onSubmit={handleChangeOwnPassword} className="space-y-2.5 pt-1">
                {passwordError && (
                  <p className="text-xs font-medium text-rose-600">{passwordError}</p>
                )}
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Mật khẩu hiện tại"
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900"
                  required
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mật khẩu mới (ít nhất 4 ký tự)"
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900"
                  required
                />
                <button
                  type="submit"
                  disabled={isSavingPwd}
                  className="min-h-[40px] px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
                >
                  {isSavingPwd ? 'Đang lưu...' : 'Cập nhật mật khẩu'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Environmental Statistics Cards */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3.5 rounded-2xl bg-[#F0FDF4] border border-emerald-200/80 space-y-1">
            <TreePine className="w-5 h-5 text-[#10B981] mx-auto" />
            <p className="text-xl font-extrabold text-[#0A5C36] tabular-nums">
              {user.savedWasteKg} kg
            </p>
            <p className="text-[11px] text-[#0A5C36] font-semibold leading-tight">
              Rác thải đã giảm
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-sky-50 border border-sky-200/80 space-y-1">
            <CheckCircle className="w-5 h-5 text-[#0284C7] mx-auto" />
            <p className="text-xl font-extrabold text-[#0284C7] tabular-nums">
              {user.totalCraftsMade}
            </p>
            <p className="text-[11px] text-sky-900 font-semibold leading-tight">
              Đồ thủ công xong
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 space-y-1">
            <Heart className="w-5 h-5 text-rose-500 mx-auto fill-rose-500" />
            <p className="text-xl font-extrabold text-rose-600 tabular-nums">
              {user.totalLikesReceived}
            </p>
            <p className="text-[11px] text-rose-900 font-semibold leading-tight">
              Lượt yêu thích
            </p>
          </div>
        </div>

        {/* Account Session Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200">
          {isAuthenticated ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Chuyển tài khoản khác
              </button>
              <button
                type="button"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
                className="min-h-[42px] px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Đăng xuất</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Đăng nhập hoặc Tạo tài khoản mới</span>
            </button>
          )}
        </div>

        {/* Environmental Badge */}
        <div className="p-3.5 rounded-2xl bg-[#0A5C36] text-white flex items-center gap-3 text-xs shadow-xs">
          <Award className="w-6 h-6 text-[#4ADE80] shrink-0" />
          <p className="leading-relaxed text-emerald-50">
            Huy hiệu <strong className="text-white">Đại Sứ Tái Chế</strong>: Cảm ơn bạn đã lan tỏa
            lối sống tuần hoàn và giảm thiểu rác thải nhựa mỗi ngày.
          </p>
        </div>
      </div>
    </ModalDialog>
  );
};
