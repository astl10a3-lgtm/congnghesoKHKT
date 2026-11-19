import React from 'react';
import { LogIn, Recycle } from 'lucide-react';
import type { AuthUser } from '../types/account';

export type ActiveTab =
  | 'home'
  | 'scan'
  | 'inventory'
  | 'projects'
  | 'community'
  | 'saved'
  | 'guide'
  | 'admin';

interface NavbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  userProfile?: AuthUser | null;
  isAuthenticated?: boolean;
  onOpenProfile: () => void;
  onOpenAuth: () => void;
}

const BASE_NAV_ITEMS: { id: ActiveTab; label: string }[] = [
  { id: 'home', label: 'Trang chủ' },
  { id: 'scan', label: 'Quét 3D' },
  { id: 'inventory', label: 'Kho đồ' },
  { id: 'projects', label: 'Dự án' },
  { id: 'community', label: 'Cộng đồng' },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  userProfile,
  isAuthenticated = false,
  onOpenProfile,
  onOpenAuth,
}) => {
  const isScanOrGuide = activeTab === 'scan' || activeTab === 'guide';
  const navItems =
    isAuthenticated && userProfile?.role === 'admin'
      ? [...BASE_NAV_ITEMS, { id: 'admin' as ActiveTab, label: 'Quản trị' }]
      : BASE_NAV_ITEMS;

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-emerald-200/80 shadow-[0_4px_20px_-10px_rgba(10,92,54,0.12)]">
      <div className="max-w-[1220px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 sm:gap-8 h-14 sm:h-16">
          {/* Zone 1: Single-line Brand wordmark */}
          <button
            type="button"
            onClick={() => onTabChange('home')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer min-h-[44px]"
          >
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#059669] to-[#0284C7] flex items-center justify-center text-white shadow-xs shrink-0">
              <Recycle className="w-4 h-4" />
            </span>
            <span className="font-extrabold text-base sm:text-lg tracking-tight text-[#0A5C36]">
              Recycle Art Studio
            </span>
          </button>

          {/* Zone 2: Concise single-line text navigation links */}
          <nav
            aria-label="Điều hướng chính"
            className="hidden md:flex items-center gap-6 text-sm font-semibold"
          >
            {navItems.map((item) => {
              const isActive =
                item.id === activeTab || (item.id === 'scan' && isScanOrGuide);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`py-2 whitespace-nowrap shrink-0 cursor-pointer border-b-2 transition-colors ${
                    isActive
                      ? 'text-[#0A5C36] border-[#0284C7]'
                      : 'text-slate-600 border-transparent hover:text-[#0A5C36] hover:border-emerald-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single primary account action */}
          <div className="flex items-center shrink-0">
            {isAuthenticated && userProfile ? (
              <button
                type="button"
                onClick={onOpenProfile}
                title={`Tài khoản @${userProfile.username}`}
                className="min-h-[44px] px-2.5 py-1.5 rounded-xl border border-emerald-200/80 bg-white hover:border-[#059669] hover:bg-[#F0FDF4] flex items-center gap-2 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <img
                  src={userProfile.avatar || '/assets/aistudio/image_9cb5bb6a.png'}
                  alt={userProfile.name}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover bg-[#F0FDF4] ring-1 ring-emerald-200 shrink-0"
                />
                <span className="hidden sm:inline text-xs font-semibold text-[#0A5C36] max-w-[140px] truncate">
                  {userProfile.role === 'admin'
                    ? `${userProfile.username} (Admin)`
                    : userProfile.name}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="min-h-[44px] px-4 py-2 rounded-xl eco-btn-primary text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Đăng nhập</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Compact Mobile Navigation Row */}
      <nav
        aria-label="Điều hướng di động"
        className="md:hidden flex items-center gap-1 px-3 py-1.5 overflow-x-auto no-scrollbar border-t border-emerald-100 bg-white/95"
      >
        {navItems.map((item) => {
          const isActive =
            item.id === activeTab || (item.id === 'scan' && isScanOrGuide);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                isActive
                  ? 'eco-btn-primary text-white'
                  : 'text-slate-600 hover:bg-[#F0FDF4] hover:text-[#0A5C36]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
