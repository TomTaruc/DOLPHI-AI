import React, { useState, useEffect } from 'react';

const statuses = [
  "Searching knowledge base...",
  "Analyzing documents...",
  "Retrieving relevant information...",
  "Generating response...",
  "Finalizing answer..."
];

export function TypingIndicator() {
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIndex(prev => (prev + 1) % statuses.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 opacity-80 h-6">
        <span className="w-1.5 h-1.5 bg-[#f59e0b] rounded-full motion-safe:animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 bg-[#f59e0b] rounded-full motion-safe:animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 bg-[#f59e0b] rounded-full motion-safe:animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <div className="text-sm text-gray-500 font-medium motion-safe:animate-pulse transition-all duration-500">
        DOLPHI is thinking...
      </div>
      <div className="text-xs text-gray-400 italic transition-opacity duration-500">
        {statuses[statusIndex]}
      </div>
    </div>
  );
}
