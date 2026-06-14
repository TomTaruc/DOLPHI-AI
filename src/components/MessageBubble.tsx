import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { Copy, File } from 'lucide-react';
import { useState } from 'react';

export function MessageBubble({ message }: { message: any }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`w-full flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group`}>
      {!isUser && (
        <div className="mr-5 mt-1.5 flex-shrink-0 w-[36px] h-[36px] flex items-center justify-center rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden p-1" >
          <img src="/logo.png" alt="DOLPHI" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
        </div>
      )}
      
      <div 
        className="relative"
        style={{
          maxWidth: isUser ? '80%' : '100%',
          width: isUser ? 'auto' : '100%',
          backgroundColor: isUser ? '#0B2341' : '#ffffff',
          borderRadius: isUser ? '20px 20px 4px 20px' : '20px',
          padding: isUser ? '16px 22px' : '20px 28px',
          color: isUser ? '#ffffff' : '#111827',
          fontSize: '15px',
          lineHeight: '1.75',
          border: isUser ? 'none' : '1px solid #E5E7EB',
          boxShadow: isUser ? '0 2px 4px rgba(0,0,0,0.05)' : '0 4px 12px rgba(0,0,0,0.03)',
        }}
      >
        {message.attachments?.map((att: any) => (
          <div key={att.id} className={`mb-3 ${isUser ? '' : 'max-w-md'}`}>
            {att.isImage ? (
              <div className="rounded-xl overflow-hidden shadow-sm border border-gray-200">
                <img src={att.url || `/api/files/${att.id}`} alt="attachment" className="w-full h-auto max-h-80 object-contain bg-white" />
              </div>
            ) : (
              <a 
                href={att.url || `/api/files/${att.id}`} 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center rounded-xl p-3 w-max hover:bg-brand-light border border-brand-border bg-white transition-colors"
              >
                <File size={20} className="mr-3 flex-shrink-0 text-gray-500"/>
                <div>
                  <div className="text-sm font-medium text-gray-900 truncate max-w-[200px]">{att.originalName}</div>
                  <div className="text-xs text-gray-500">
                    {Math.round((att.sizeBytes || 0) / 1024)} KB &middot; {att.mimeType?.split('/')[1]?.toUpperCase()}
                  </div>
                </div>
              </a>
            )}
          </div>
        ))}
        
        {isUser ? (
          <div className="whitespace-pre-wrap relative group/md">
            <div className="absolute -top-6 right-0 flex gap-1 opacity-0 group-hover/md:opacity-100 transition-opacity bg-white border border-gray-200 rounded-md p-1 shadow-sm">
                <button className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-900" title="Edit text">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
            </div>
            {message.content}
          </div>
        ) : (
          <div className="markdown-body relative group/md">
            {!isUser && (
               <button 
                 onClick={copyCode}
                 className="absolute -top-3 -right-3 p-1.5 opacity-0 group-hover/md:opacity-100 transition-opacity hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-900 border border-transparent hover:border-gray-200 bg-white"
                 aria-label="Copy message"
               >
                 <Copy size={16} className={copied ? 'text-success' : ''} />
               </button>
            )}
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
        )}
      </div>
    </div>
  );
}
