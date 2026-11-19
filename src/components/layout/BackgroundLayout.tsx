import React from 'react';

interface BackgroundLayoutProps {
  variant?: 'app' | 'auth';
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const BackgroundLayout: React.FC<BackgroundLayoutProps> = ({
  variant = 'app',
  header,
  footer,
  children,
}) => {
  return (
    <div className="relative min-h-screen flex flex-col font-sans antialiased text-slate-900 selection:bg-[#059669] selection:text-white">
      {/* Layer 1: Exact Eco-Tech Recycling Background */}
      <div aria-hidden="true" className="fixed inset-0 z-0 eco-bg-canvas" />

      {/* Layer 2: Soft horizontal transition scrim keeping side-edge motifs clear */}
      <div aria-hidden="true" className="fixed inset-0 z-[1] eco-bg-scrim" />

      {/* Layer 3: Interactive Foreground */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {variant === 'auth' ? (
          <main className="flex-1 w-full flex items-center justify-center px-3 sm:px-6 py-8 sm:py-12">
            <div className="eco-content-shell w-full max-w-md p-6 sm:p-8 eco-page-enter">
              {children}
            </div>
          </main>
        ) : (
          <>
            {header}
            <main className="flex-1 w-full flex justify-center px-2.5 sm:px-6 lg:px-10 py-4 sm:py-6">
              <div className="eco-content-shell w-full max-w-[1220px] p-4 sm:p-6 lg:p-8 space-y-6">
                {children}
              </div>
            </main>
            {footer}
          </>
        )}
      </div>
    </div>
  );
};
