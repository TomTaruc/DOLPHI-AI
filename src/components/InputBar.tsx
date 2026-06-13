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
      <div className="w-full max-w-4xl flex flex-col group relative rounded-2xl transition-all shadow-custom" 
           style={{ backgroundColor: 'var(--white)', border: '1.5px solid var(--gray-300)' }}>
        
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 pb-0">
            {attachments.map((att, i) => (
              <div key={att.id} className="flex items-center rounded-[8px] px-3 py-1.5" style={{ backgroundColor: 'var(--navy-50)', border: '1px solid var(--navy-100)' }}>
                {att.isImage ? <span className="mr-2">🖼</span> : <span className="mr-2">📄</span>}
                <span className="text-[13px] truncate max-w-[120px] mr-3 font-medium" style={{ color: 'var(--navy-800)' }}>{att.name}</span>
                <button onClick={() => removeAttachment(i)} className="hover:opacity-80">
                  <X size={14} style={{ color: 'var(--navy-600)' }}/>
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
            <Paperclip size={20} className="hover:text-[var(--navy-800)] transition-colors" style={{ color: 'var(--navy-300)' }} />
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
            className="flex-1 max-h-[200px] min-h-[44px] bg-transparent border-none outline-none resize-none py-3 custom-scrollbar text-[15px]"
            style={{ color: 'var(--navy-900)' }}
            rows={1}
          />
          
          {isGenerating ? (
            <button 
              onClick={onStop}
              className="w-[36px] h-[36px] rounded-full flex justify-center items-center m-1 hover:opacity-80 transition-opacity"
              style={{ backgroundColor: 'var(--navy-100)' }}
            >
              <Square size={14} fill="var(--navy-600)" style={{ color: 'var(--navy-600)' }} />
            </button>
          ) : (
            <button 
              onClick={handleSend}
              disabled={!text.trim() && attachments.length === 0}
              className="w-[36px] h-[36px] rounded-full flex justify-center items-center m-1 transition-colors disabled:opacity-50"
              style={{ 
                backgroundColor: (text.trim() || attachments.length > 0) ? 'var(--navy-800)' : 'var(--gray-200)',
                color: 'var(--white)'
              }}
            >
              <ArrowRight size={18} strokeWidth={2.5} color="var(--white)" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
