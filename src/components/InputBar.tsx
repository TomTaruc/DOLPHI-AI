import { Paperclip, ArrowRight, X, Square } from 'lucide-react';
import { useRef, useState } from 'react';

export function InputBar({ onSend, isGenerating, onStop }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!text.trim() && attachments.length === 0) return;
    onSend(text, attachments);
    setText('');
    setAttachments([]);
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: any) => {
    const files = Array.from(e.target.files) as File[];
    const validFiles = [];
    for (const f of files) {
       const ext = f.name.split('.').pop()?.toLowerCase();
       const isImage = f.type.startsWith('image/');
       if (isImage && f.size > 10 * 1024 * 1024) {
          alert(`File ${f.name} exceeds 10MB limit for images.`);
          continue;
       } else if (!isImage && f.size > 20 * 1024 * 1024) {
          alert(`File ${f.name} exceeds 20MB limit for documents.`);
          continue;
       }
       validFiles.push(f);
    }

    const newAtts = validFiles.map((f: File) => ({
      file: f,
      id: Math.random().toString(),
      name: f.name,
      size: f.size,
      isImage: f.type.startsWith('image/'),
      type: f.type,
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null
    }));
    setAttachments([...attachments, ...newAtts]);
    if(fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="w-full flex justify-center px-6">
      <div className="w-full max-w-4xl flex flex-col group relative rounded-[12px] focus-within:border-[var(--green-dim)] transition-colors" 
           style={{ backgroundColor: 'var(--slate)', border: '1px solid var(--mist)' }}>
        
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 pb-0">
            {attachments.map((att, i) => (
              <div key={att.id} className="flex items-center rounded-[8px] px-3 py-1.5" style={{ backgroundColor: 'var(--slate)', border: '1px solid var(--mist)' }}>
                {att.isImage ? <span className="mr-2">🖼</span> : <span className="mr-2">📄</span>}
                <span className="text-[13px] truncate max-w-[120px] mr-3" style={{ color: 'var(--fog)' }}>{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="hover:opacity-80">
                  <X size={14} style={{ color: 'var(--ash)' }}/>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end p-2 pb-2">
          <button 
            className="p-2.5 mx-1"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={18} style={{ color: 'var(--ash)' }} />
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            multiple 
            accept="image/*,.pdf,.txt,.md,.csv,.js,.ts,.py,.json,.yaml,.xml,.html,.css"
            onChange={handleFileChange}
          />
          
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            className="flex-1 max-h-[200px] min-h-[44px] bg-transparent border-none outline-none resize-none py-3 custom-scrollbar"
            style={{ color: 'var(--bone)' }}
            rows={1}
          />
          
          {isGenerating ? (
            <button 
              onClick={onStop}
              className="w-[32px] h-[32px] rounded-full flex justify-center items-center m-1 hover:opacity-80 transition-opacity"
              style={{ backgroundColor: 'var(--slate)', border: '1px solid var(--mist)' }}
            >
              <Square size={14} fill="var(--mist)" style={{ color: 'var(--mist)' }} />
            </button>
          ) : (
            <button 
              onClick={handleSend}
              disabled={!text.trim() && attachments.length === 0}
              className="w-[32px] h-[32px] rounded-full flex justify-center items-center m-1 transition-colors disabled:opacity-50"
              style={{ 
                backgroundColor: (text.trim() || attachments.length > 0) ? 'var(--green)' : 'var(--mist)',
              }}
            >
              <ArrowRight size={16} strokeWidth={2.5} style={{ color: 'var(--ink)' }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
