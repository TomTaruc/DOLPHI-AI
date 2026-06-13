import { Trash2, Plus } from "lucide-react";

export function Sidebar({ conversations, currentConvId, onSelect, onNew, onDelete }) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="w-[260px] flex-shrink-0 flex flex-col h-screen h-[100dvh]" style={{ backgroundColor: 'var(--graphite)' }}>
      <div className="p-4 flex flex-col flex-grow">
        <h1 className="text-[20px] italic mb-6" style={{ fontFamily: 'var(--font-display)', color: 'var(--bone)' }}>
          🐬 DOLPHI AI
        </h1>
        
        <button 
          onClick={onNew}
          className="w-full py-2 flex items-center justify-center rounded-[8px] border mb-6 transition-colors"
          style={{ backgroundColor: 'var(--slate)', borderColor: 'var(--green)', color: 'var(--bone)' }}
        >
          <Plus size={16} className="mr-2" style={{ color: 'var(--green)' }}/> New Chat
        </button>

        <div className="text-[11px] uppercase tracking-[0.08em] mb-2" style={{ color: 'var(--ash)' }}>
          ── Recent ──
        </div>

        <div className="flex-1 overflow-y-auto w-full -mx-4 px-4 custom-scrollbar space-y-1">
          {conversations.map((conv: any) => {
            const isActive = conv.id === currentConvId;
            return (
              <div 
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className="group flex items-center justify-between h-[36px] px-[12px] cursor-pointer"
                style={{
                  backgroundColor: isActive ? 'var(--graphite)' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--green)' : '2px solid transparent',
                  color: isActive ? 'var(--bone)' : 'var(--fog)'
                }}
              >
                <div className="truncate text-[14px]">
                  {conv.title}
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if(confirm('Delete conversation?')) onDelete(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1"
                >
                  <Trash2 size={14} style={{ color: 'var(--ash)' }} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="p-4" style={{ borderTop: '1px solid var(--mist)' }}>
        <div className="text-[11px]" style={{ color: 'var(--ash)' }}>
          DOLPHI AI v1.0
        </div>
      </div>
    </div>
  );
}
