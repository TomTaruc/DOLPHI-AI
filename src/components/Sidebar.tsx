import { Trash2, Plus } from "lucide-react";

export function Sidebar({ conversations, currentConvId, onSelect, onNew, onDelete }) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="w-[260px] flex-shrink-0 flex flex-col h-screen h-[100dvh]" style={{ backgroundColor: 'var(--navy-800)' }}>
      <div className="p-4 flex flex-col flex-grow">
        <h1 className="text-[20px] font-bold mb-6 tracking-wide" style={{ fontFamily: 'var(--font-display)', color: 'var(--white)' }}>
          DOLPHI
        </h1>
        
        <button 
          onClick={onNew}
          className="w-full py-2.5 flex items-center justify-center rounded-[8px] font-semibold transition-colors hover:opacity-90"
          style={{ backgroundColor: 'var(--gold-400)', color: 'var(--navy-900)' }}
        >
          <Plus size={18} className="mr-2" strokeWidth={2.5}/> New Chat
        </button>

        <div className="text-[12px] font-semibold tracking-wider mb-3 mt-4" style={{ color: 'var(--navy-300)' }}>
          Recent
        </div>

        <div className="flex-1 overflow-y-auto w-full -mx-4 px-4 custom-scrollbar space-y-1">
          {conversations.map((conv: any) => {
            const isActive = conv.id === currentConvId;
            return (
              <div 
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className="group flex items-center justify-between h-[36px] px-[12px] cursor-pointer rounded-[4px] transition-colors"
                style={{
                  backgroundColor: isActive ? 'var(--navy-700)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--gold-400)' : '3px solid transparent',
                  color: isActive ? 'var(--white)' : 'var(--navy-100)'
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
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-white"
                  style={{ color: 'var(--navy-300)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="p-4" style={{ borderTop: '1px solid var(--navy-700)' }}>
        <div className="text-[11px]" style={{ color: 'var(--navy-300)' }}>
          DOLPHI AI v1.0
        </div>
      </div>
    </div>
  );
}
