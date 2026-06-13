import { Paperclip, ArrowUp, X, Square } from 'lucide-react';
import { useRef, useState, useEffect } from 'react';

export function InputBar({ onSend, isGenerating, onStop }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim() && attachments.length === 0) return;
    onSend(text, attachments);
    setText('');
    setAttachments([]);
    if(textareaRef.current) {
        textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: any) => {
     setText(e.target.value);
     if(textareaRef.current) {
         textareaRef.current.style.height = 'auto';
         textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
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
    <div className="w-full relative">
      <div className="w-full flex flex-col group relative rounded-[16px] transition-all shadow-sm bg-brand-primary focus-within:shadow-[0_0_0_2px_rgba(245,197,24,0.5)]">
        
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 p-3 pb-0">
            {attachments.map((att, i) => (
              <div key={att.id} className="relative flex items-center rounded-xl bg-white/10 border border-white/20 pr-1 group/att">
                {att.isImage ? (
                  <div className="w-12 h-12 rounded-l-xl overflow-hidden bg-black/20 border-r border-white/20">
                    <img src={att.preview || ''} className="w-full h-full object-cover" alt="preview" />
                  </div>
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-lg ml-1 border border-white/10">
                    <span className="text-xl">📄</span>
                  </div>
                )}
                <div className="flex flex-col px-3 max-w-[140px]">
                   <span className="text-xs truncate font-medium text-white">{att.name}</span>
                   <span className="text-[11px] text-white/50 mt-0.5">{Math.round(att.size/1024)} KB</span>
                </div>
                <button 
                  onClick={() => removeAttachment(i)} 
                  className="absolute -top-2 -right-2 w-[22px] h-[22px] rounded-full bg-brand-accent hover:bg-[#e4b400] text-brand-primary flex items-center justify-center shadow-sm opacity-0 group-hover/att:opacity-100 transition-opacity z-10"
                >
                  <X size={12} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end p-2 pb-2">
          <button 
            className="p-2.5 mx-1 rounded-xl text-white hover:text-brand-accent hover:bg-white/10 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
          >
            <Paperclip size={22} />
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
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message DOLPHI..."
            className="flex-1 max-h-[250px] min-h-[44px] bg-transparent border-none outline-none resize-none py-[14px] px-2 custom-scrollbar text-[15px] text-white placeholder-white/65 min-w-0 leading-relaxed"
            rows={1}
            style={{ overflowY: text.split('\n').length > 5 ? 'auto' : 'hidden' }}
          />
          
          {isGenerating ? (
            <button 
              onClick={onStop}
              className="w-9 h-9 rounded-xl flex justify-center items-center m-1.5 transition-colors bg-white/20 hover:bg-white/30 text-white"
              title="Stop generating"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button 
              onClick={handleSend}
              disabled={!text.trim() && attachments.length === 0}
              className="w-9 h-9 flex-shrink-0 rounded-xl flex justify-center items-center m-1.5 transition-all disabled:opacity-50 disabled:bg-white/10 disabled:text-white/30 text-brand-primary bg-brand-accent hover:bg-[#e4b400]"
            >
              <ArrowUp size={18} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
