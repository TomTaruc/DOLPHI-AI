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
    <div className={`w-full flex ${isUser ? 'justify-end' : 'justify-start'} mb-6 group`}>
      {!isUser && (
        <div className="mr-3 mt-1 flex-shrink-0" style={{ fontSize: '28px' }}>🐬</div>
      )}
      
      <div 
        className="relative"
        style={{
          maxWidth: isUser ? '72%' : '80%',
          backgroundColor: isUser ? 'var(--slate)' : 'transparent',
          border: isUser ? '1px solid var(--mist)' : 'none',
          borderRadius: isUser ? '12px 12px 2px 12px' : '0px',
          padding: isUser ? '12px 16px' : '4px 0',
          color: 'var(--bone)',
          fontSize: '15px',
          lineHeight: '1.7',
        }}
      >
        {message.attachments?.map((att: any) => (
          <div key={att.id} className="mb-3">
            {att.isImage ? (
              <div 
                className="rounded-[8px] overflow-hidden" 
                style={{ border: '1px solid var(--mist)', maxWidth: '480px' }}
              >
                <img src={att.url || `/api/files/${att.id}`} alt="attachment" className="w-full h-auto object-cover max-h-[360px]" />
              </div>
            ) : (
              <a 
                href={att.url || `/api/files/${att.id}`} 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center rounded-[8px] px-[14px] scrollbar-hide py-[10px] w-max hover:opacity-80"
                style={{ backgroundColor: 'var(--slate)', border: '1px solid var(--mist)' }}
              >
                <File size={20} className="mr-3" style={{ color: 'var(--info)' }}/>
                <div>
                  <div className="text-[14px] truncate max-w-[200px]" style={{ color: 'var(--bone)' }}>{att.originalName}</div>
                  <div className="text-[12px]" style={{ color: 'var(--ash)' }}>
                    {Math.round(att.sizeBytes / 1024)} KB &middot; {att.mimeType.split('/')[1]?.toUpperCase()}
                  </div>
                </div>
              </a>
            )}
          </div>
        ))}
        
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div className="markdown-body">
            {!isUser && (
               <button 
                 onClick={copyCode}
                 className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
               >
                 <Copy size={16} style={{ color: copied ? 'var(--green)' : 'var(--ash)' }} />
               </button>
            )}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeHighlight]}
              components={{
                code(props: any) {
                  const {children, className, node, ...rest} = props
                  const match = /language-(\w+)/.exec(className || '')
                  return match ? (
                    <div className="rounded-[8px] my-4 overflow-hidden" style={{ border: '1px solid var(--mist)', backgroundColor: 'var(--ink)' }}>
                      <div className="px-4 py-2 text-[12px] flex justify-between" style={{ backgroundColor: 'var(--slate)', color: 'var(--ash)', borderBottom: '1px solid var(--mist)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{match[1]}</span>
                      </div>
                      <div className="p-4 overflow-x-auto text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>
                        <code {...rest} className={className}>
                          {children}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <code {...rest} className="px-1.5 py-0.5 rounded-[4px] mx-1 text-[13px]" style={{ backgroundColor: 'var(--slate)', color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                      {children}
                    </code>
                  )
                },
                a({node, ...props}) {
                  return <a {...props} target="_blank" rel="noreferrer" style={{ color: 'var(--green)' }} />
                },
                table({node, ...props}) {
                  return <div className="overflow-x-auto my-4 rounded-[8px]" style={{ border: '1px solid var(--mist)' }}><table className="min-w-full divide-y divide-[var(--mist)] text-sm" {...props} /></div>
                },
                th({node, ...props}) {
                  return <th className="px-4 py-3 text-left bg-[var(--slate)] font-medium" {...props} />
                },
                td({node, ...props}) {
                  return <td className="px-4 py-3 border-t border-[var(--mist)]" {...props} />
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
