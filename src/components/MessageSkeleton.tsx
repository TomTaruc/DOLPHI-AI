import React from 'react';

export function MessageSkeleton() {
  return (
    <div className="w-full flex justify-start mb-4 group motion-safe:animate-pulse" aria-label="Assistant is generating a response." role="status">
      <div className="mr-5 mt-1.5 flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-lg bg-brand-primary text-brand-accent text-sm font-bold shadow-sm opacity-70">
        D
      </div>
      
      <div className="relative w-full max-w-3xl bg-white rounded-2xl rounded-tl-sm px-5 py-4 border border-gray-100 shadow-sm flex flex-col gap-3">
        <div className="h-4 bg-gray-200 rounded w-3/4 shimmer-effect"></div>
        <div className="h-4 bg-gray-200 rounded w-full shimmer-effect" style={{ animationDelay: '100ms' }}></div>
        <div className="h-4 bg-gray-200 rounded w-5/6 shimmer-effect" style={{ animationDelay: '200ms' }}></div>
        <div className="h-4 bg-gray-200 rounded w-1/2 shimmer-effect" style={{ animationDelay: '300ms' }}></div>
      </div>
    </div>
  );
}
