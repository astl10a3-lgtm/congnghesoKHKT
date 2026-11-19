import React from 'react';
import { AlertCircle, RefreshCw, Sparkles, Inbox } from 'lucide-react';

interface LoadingStateProps {
  title?: string;
  description?: string;
  compact?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  title = 'Đang xử lý dữ liệu...',
  description,
  compact = false,
}) => (
  <div
    role="status"
    aria-live="polite"
    className={`rounded-2xl border border-slate-200 bg-white flex items-center gap-3 ${
      compact ? 'p-3.5 text-xs' : 'p-6 text-sm'
    }`}
  >
    <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin shrink-0" />
    <div className="min-w-0">
      <p className="font-semibold text-slate-900">{title}</p>
      {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
    </div>
  </div>
);

interface ErrorBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  title = 'Không thể hoàn tất thao tác',
  message,
  onRetry,
  retryLabel = 'Thử lại',
}) => (
  <div
    role="alert"
    className="p-4 sm:p-5 rounded-2xl border border-rose-200 bg-rose-50 text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
  >
    <div className="flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
      <div className="space-y-0.5 text-xs sm:text-sm">
        <p className="font-bold text-rose-950">{title}</p>
        <p className="text-rose-800 leading-relaxed">{message}</p>
      </div>
    </div>
    {onRetry && (
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition"
      >
        <RefreshCw className="w-4 h-4" />
        <span>{retryLabel}</span>
      </button>
    )}
  </div>
);

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <div className="p-8 rounded-2xl border border-dashed border-slate-300 bg-white text-center space-y-3">
    <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 mx-auto flex items-center justify-center">
      <Inbox className="w-5 h-5" />
    </div>
    <div className="space-y-1 max-w-md mx-auto">
      <h4 className="text-base font-bold text-slate-900">{title}</h4>
      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">{description}</p>
    </div>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition"
      >
        <Sparkles className="w-4 h-4" />
        <span>{actionLabel}</span>
      </button>
    )}
  </div>
);
