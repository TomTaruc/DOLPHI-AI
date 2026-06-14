import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { MessageSkeleton } from './MessageSkeleton';
import { TypingIndicator } from './TypingIndicator';
import { RefreshCw } from 'lucide-react';

export function StreamingMessage({ message, onRetry }: { message: any, onRetry?: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let interval: any;
    if (message.isStreaming && !message.isError) {
      interval = setInterval(() => {
        setElapsed(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [message.isStreaming, message.isError]);

  if (message.isError) {
    return (
      <div className="w-full flex justify-start mb-4 group relative">
        <div className="mr-5 mt-1.5 flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-lg bg-red-100 text-red-600 text-sm font-bold shadow-sm" >
          !
        </div>
        <div className="relative border border-red-200 w-full max-w-3xl bg-white rounded-[16px] rounded-tl-sm px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
           <p className="text-red-600 text-[15px] font-medium">{message.content}</p>
           {onRetry && (
             <button onClick={onRetry} className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg transition-colors">
               <RefreshCw size={14} /> Retry Generation
             </button>
           )}
        </div>
      </div>
    );
  }

  if (!message.content && !message.hasReceivedFirstToken) {
    return (
      <div className="relative">
         <MessageSkeleton />
         <div className="absolute top-0 left-[54px] right-0 bottom-0 flex items-center bg-white/60 backdrop-blur-[1px] transition-opacity duration-500 ease-out opacity-100 rounded-2xl">
            <div className="ml-5">
              <TypingIndicator />
            </div>
         </div>
      </div>
    );
  }

  // Render markdown with streaming cursor
  return (
    <div className="w-full flex justify-start mb-4 group relative">
      <div className="mr-5 mt-1.5 flex-shrink-0 w-[36px] h-[36px] flex items-center justify-center rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden p-1" >
        <img src="/logo.png" alt="DOLPHI" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
      </div>
      
      <div 
        className="relative "
        style={{
          width: '100%',
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          padding: '20px 28px',
          color: '#111827',
          fontSize: '15px',
          lineHeight: '1.75',
          border: '1px solid #E5E7EB',
          boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
        }}
      >
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeHighlight]}
            components={{
              a({node, ...props}) {
                return <a {...props} target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium" />
              },
              table({node, ...props}) {
                return <div className="overflow-x-auto my-4 rounded-lg border border-gray-200"><table className="min-w-full divide-y divide-gray-200 text-sm" {...props} /></div>
              },
              th({node, ...props}) {
                return <th className="px-4 py-3 text-left bg-gray-50 font-medium text-gray-900" {...props} />
              },
              td({node, ...props}) {
                return <td className="px-4 py-3 border-t border-gray-200" {...props} />
              },
              blockquote({node, ...props}) {
                return <blockquote className="border-l-4 border-gray-300 pl-4 py-1 my-4 italic text-gray-600 bg-gray-50 rounded-r-lg" {...props} />
              }
            }}
          >
            {message.content + (message.isStreaming ? ' ▋' : '')}
          </ReactMarkdown>
        </div>
        
        {message.isStreaming && (
          <div className="absolute bottom-2 right-4 text-xs text-gray-400 font-medium mt-2">
            {elapsed}s
          </div>
        )}
      </div>
    </div>
  );
}
