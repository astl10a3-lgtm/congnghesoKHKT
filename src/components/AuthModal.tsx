import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, LogIn, Recycle, UserPlus } from 'lucide-react';
import { apiFetch, setStoredAuthToken } from '../lib/apiClient';
import type { AuthUser } from '../types/account';
import { ModalDialog } from './ui/ModalDialog';
import { ErrorBanner } from './ui/StatusFeedback';
import { BackgroundLayout } from './layout/BackgroundLayout';

interface AuthFormProps {
  onAuthSuccess: (user: AuthUser) => void;
  initialMode?: 'login' | 'register';
}

const AuthFormContent: React.FC<AuthFormProps> = ({
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername || !/^[a-z0-9_.]{3,32}$/.test(cleanUsername)) {
      setError('Tên tài khoản dài 3–32 ký tự (chữ thường không dấu, số, dấu chấm hoặc gạch dưới).');
      return;
    }
    if (password.trim().length < 4) {
      setError('Mật khẩu cần ít nhất 4 ký tự.');
      return;
    }
    if (mode === 'register' && password.trim() !== confirmPassword.trim()) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { username: cleanUsername, password }
          : {
              username: cleanUsername,
              password,
              name: displayName.trim() || cleanUsername,
            };

      const res = await apiFetch<{
        success: boolean;
        token: string;
        user: AuthUser;
      }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.success && res.token && res.user) {
        setStoredAuthToken(res.token);
        onAuthSuccess(res.user);
      }
    } catch (err: any) {
      setError(err?.message || 'Không thể xác thực tài khoản. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Segmented Auth Mode Switcher */}
      <div
        role="tablist"
        aria-label="Chọn chế độ tài khoản"
        className="grid grid-cols-2 gap-1 p-1 bg-[#F0FDF4] border border-emerald-200/70 rounded-xl"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          onClick={() => {
            setMode('login');
            setError(null);
          }}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            mode === 'login'
              ? 'bg-white text-[#0A5C36] shadow-xs border border-emerald-200/60'
              : 'text-slate-600 hover:text-[#0A5C36]'
          }`}
        >
          <LogIn className="w-3.5 h-3.5" />
          <span>Đăng nhập</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          onClick={() => {
            setMode('register');
            setError(null);
          }}
          className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            mode === 'register'
              ? 'bg-white text-[#0A5C36] shadow-xs border border-emerald-200/60'
              : 'text-slate-600 hover:text-[#0A5C36]'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Tạo tài khoản</span>
        </button>
      </div>

      {error && <ErrorBanner title="Lỗi xác thực" message={error} />}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="space-y-1.5">
          <label htmlFor="auth-username" className="block text-xs font-semibold text-slate-700">
            Tên tài khoản
          </label>
          <input
            id="auth-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Nhập tên tài khoản của bạn"
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
            required
          />
        </div>

        {mode === 'register' && (
          <div className="space-y-1.5">
            <label htmlFor="auth-name" className="block text-xs font-semibold text-slate-700">
              Tên hiển thị
            </label>
            <input
              id="auth-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Tên hiển thị của bạn"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-700">
            Mật khẩu
          </label>
          <div className="relative">
            <input
              id="auth-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu (tối thiểu 4 ký tự)"
              className="w-full min-h-[44px] pl-3.5 pr-11 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {mode === 'register' && (
          <div className="space-y-1.5">
            <label htmlFor="auth-confirm" className="block text-xs font-semibold text-slate-700">
              Nhập lại mật khẩu
            </label>
            <input
              id="auth-confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Xác nhận lại mật khẩu"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-600"
              required
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full min-h-[44px] px-4 py-2.5 rounded-xl eco-btn-primary disabled:opacity-60 text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
        >
          <KeyRound className="w-4 h-4" />
          <span>
            {isSubmitting
              ? 'Đang xử lý...'
              : mode === 'login'
              ? 'Đăng nhập ngay'
              : 'Tạo tài khoản ngay'}
          </span>
        </button>
      </form>
    </div>
  );
};

interface AuthModalProps extends AuthFormProps {
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  return (
    <ModalDialog
      title="Chuyển đổi tài khoản"
      subtitle="Đăng nhập hoặc tạo tài khoản khác trong Recycle Art Studio"
      onClose={onClose}
      maxWidthClass="max-w-md"
    >
      <AuthFormContent onAuthSuccess={onAuthSuccess} initialMode={initialMode} />
    </ModalDialog>
  );
};

export const AuthGateScreen: React.FC<AuthFormProps> = ({
  onAuthSuccess,
  initialMode = 'login',
}) => {
  return (
    <BackgroundLayout variant="auth">
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#059669] to-[#0284C7] flex items-center justify-center text-white shadow-sm shrink-0">
              <Recycle className="w-5 h-5" />
            </span>
            <span className="font-extrabold text-xl tracking-tight text-[#0A5C36]">
              Recycle Art Studio
            </span>
          </div>
          <p className="text-sm text-slate-600 text-balance">
            Vui lòng đăng nhập hoặc tạo tài khoản để truy cập hệ thống tái chế 3D & Kinh tế tuần hoàn.
          </p>
        </div>

        <div className="bg-white border border-emerald-200/80 rounded-2xl p-5 sm:p-6 shadow-xs">
          <AuthFormContent onAuthSuccess={onAuthSuccess} initialMode={initialMode} />
        </div>
      </div>
    </BackgroundLayout>
  );
};
