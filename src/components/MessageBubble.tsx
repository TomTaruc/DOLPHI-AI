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
        <div className="mr-3 mt-1 flex-shrink-0 w-[28px] h-[28px] flex items-center justify-center rounded-full" 
             style={{ backgroundColor: 'var(--navy-800)', border: '2px solid var(--gold-400)', fontSize: '14px' }}>
          🐬
        </div>
      )}
      
      <div 
        className="relative"
        style={{
          maxWidth: isUser ? '72%' : '80%',
          backgroundColor: isUser ? 'var(--navy-800)' : 'transparent',
          borderRadius: isUser ? '1rem 1rem 0.125rem 1rem' : '0px',
          padding: isUser ? '12px 16px' : '4px 0',
          color: isUser ? 'var(--white)' : 'var(--navy-900)',
          fontSize: '15px',
          lineHeight: '1.7',
        }}
      >
        {message.attachments?.map((att: any) => (
          <div key={att.id} className="mb-3">
            {att.isImage ? (
              <div 
                className="rounded-[8px] overflow-hidden shadow-sm" 
                style={{ border: '1.5px solid var(--gray-200)', maxWidth: '480px' }}
              >
                <img src={att.url || `/api/files/${att.id}`} alt="attachment" className="w-full h-auto object-cover max-h-[360px]" />
              </div>
            ) : (
              <a 
                href={att.url || `/api/files/${att.id}`} 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center rounded-[8px] px-[14px] scrollbar-hide py-[10px] w-max hover:opacity-80 transition-opacity whitespace-pre-wrap"
                style={{ backgroundColor: isUser ? 'var(--navy-600)' : 'var(--white)', border: isUser ? 'none' : '1.5px solid var(--gray-200)' }}
              >
                <File size={20} className="mr-3 flex-shrink-0" style={{ color: isUser ? 'var(--navy-100)' : 'var(--navy-800)' }}/>
                <div>
                  <div className="text-[14px] truncate max-w-[200px]" style={{ color: isUser ? 'var(--white)' : 'var(--navy-900)' }}>{att.originalName}</div>
                  <div className="text-[12px]" style={{ color: isUser ? 'var(--navy-300)' : 'var(--navy-600)' }}>
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
                 <Copy size={16} style={{ color: copied ? 'var(--gold-400)' : 'var(--navy-300)' }} />
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
                    <div className="rounded-[8px] my-4 overflow-hidden" style={{ backgroundColor: 'var(--navy-900)' }}>
                      <div className="px-4 py-2 text-[12px] flex justify-between" style={{ backgroundColor: 'var(--navy-800)', color: 'var(--navy-300)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{match[1]}</span>
                      </div>
                      <div className="p-4 overflow-x-auto text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>
                        <code {...rest} className={className} style={{ color: 'var(--white)' }}>
                          {children}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <code {...rest} className="px-1.5 py-0.5 rounded-[4px] mx-1 text-[13px]" style={{ backgroundColor: 'var(--navy-100)', color: 'var(--navy-900)', fontFamily: 'var(--font-mono)' }}>
                      {children}
                    </code>
                  )
                },
                a({node, ...props}) {
                  return <a {...props} target="_blank" rel="noreferrer" style={{ color: 'var(--gold-400)' }} />
                },
                table({node, ...props}) {
                  return <div className="overflow-x-auto my-4 rounded-[8px]" style={{ border: '1px solid var(--gray-300)' }}><table className="min-w-full divide-y divide-[var(--gray-300)] text-sm" {...props} /></div>
                },
                th({node, ...props}) {
                  return <th className="px-4 py-3 text-left bg-[var(--gray-50)] font-medium" {...props} />
                },
                td({node, ...props}) {
                  return <td className="px-4 py-3 border-t border-[var(--gray-300)]" {...props} />
                },
                blockquote({node, ...props}) {
                  return <blockquote className="border-l-4 my-4 pl-4 py-1" style={{ borderColor: 'var(--gold-400)', backgroundColor: 'var(--navy-50)' }} {...props} />
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
