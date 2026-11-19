import React, { useEffect, useId } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  open?: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  open = true,
  title,
  subtitle,
  onClose,
  maxWidthClass = 'max-w-lg',
  children,
}) => {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative w-full ${maxWidthClass} bg-white rounded-2xl border border-emerald-200/80 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]`}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-emerald-100 bg-[#F0FDF4]/60 sticky top-0 z-10">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base sm:text-lg font-bold text-[#0A5C36] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="min-w-[44px] min-h-[44px] -my-2 -mr-2 rounded-xl flex items-center justify-center text-slate-500 hover:text-[#0A5C36] hover:bg-emerald-100/70 transition cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto bg-white">{children}</div>
      </div>
    </div>
  );
};
