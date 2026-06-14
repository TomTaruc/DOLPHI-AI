import { useState, useMemo } from "react";
import { Plus, Search, MoreHorizontal, Check, X, Trash2, Edit2, Pin } from "lucide-react";
import { UserProfile } from "./UserProfile";

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24 && now.getDate() === date.getDate()) {
    return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear()) {
    return 'Yesterday';
  }
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
  
  if (diffDays < 30) {
    return 'Last week';
  }
  
  return date.toLocaleDateString();
}

function getGroup(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  
  if (date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
    return 'Today';
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth() && date.getFullYear() === yesterday.getFullYear()) {
    return 'Yesterday';
  }
  
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays < 7) return 'Previous 7 Days';
  if (diffDays < 30) return 'Previous 30 Days';
  return 'Older';
}

export function Sidebar({ conversations, currentConvId, onSelect, onNew, onDelete, onRename, onPin, isOpen, setIsOpen }: any) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showDeleteModalId, setShowDeleteModalId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    // Sort by updated at descending
    const sorted = [...conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sorted.filter(c => c.title?.toLowerCase().includes(search.toLowerCase()));
  }, [conversations, search]);

  const pinned = filtered.filter(c => c.isPinned);
  const recent = filtered.filter(c => !c.isPinned);

  const groupedRecent = useMemo(() => {
    const groups: Record<string, any[]> = {
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      'Older': []
    };
    recent.forEach(c => {
       const g = getGroup(c.updatedAt);
       if (groups[g]) groups[g].push(c);
    });
    return groups;
  }, [recent]);

  const startEdit = (e: any, conv: any) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
    setMenuOpenId(null);
  };

  const saveEdit = (e: any, id: string) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRename(id, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
         <div className="fixed inset-0 bg-gray-900 bg-opacity-50 z-30 md:hidden" onClick={() => setIsOpen(false)} />
      )}
      
      <div className={`fixed inset-y-0 left-0 w-[280px] bg-brand-primary border-r border-brand-primary z-40 transform transition-transform duration-200 ease-in-out flex flex-col h-full 
                       ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 md:flex`}
      >
        <div className="p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="DOLPHI Logo" className="w-8 h-8 object-contain rounded-md bg-white p-0.5" referrerPolicy="no-referrer" />
              <h1 className="text-lg font-bold tracking-tight text-white">DOLPHI</h1>
            </div>
            <button 
              onClick={onNew}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="New Chat"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input 
              type="text" 
              placeholder="Search conversations..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/5 border border-white/5 focus:border-white/20 focus:bg-white/10 text-white text-[13px] focus:outline-none transition-all placeholder-white/40 shadow-inner"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-6 custom-scrollbar mt-2">
          {pinned.length > 0 && (
            <div>
              <div className="px-3 mb-2 text-[11px] font-bold text-white/50 uppercase tracking-widest">Pinned</div>
              <div className="space-y-0.5">
                {pinned.map(c => <ChatItem key={c.id} conv={c} {...{currentConvId, onSelect, editingId, setEditingId, editTitle, setEditTitle, saveEdit, startEdit, menuOpenId, setMenuOpenId, onPin, setShowDeleteModalId}} />)}
              </div>
            </div>
          )}

          {recent.length > 0 ? (
            <div className="space-y-6">
               {Object.entries(groupedRecent).map(([groupName, convs]) => {
                  if (convs.length === 0) return null;
                  return (
                    <div key={groupName}>
                      <div className="px-3 mb-2 text-[11px] font-bold text-white/50 uppercase tracking-widest">{groupName}</div>
                      <div className="space-y-0.5">
                        {convs.map(c => <ChatItem key={c.id} conv={c} {...{currentConvId, onSelect, editingId, setEditingId, editTitle, setEditTitle, saveEdit, startEdit, menuOpenId, setMenuOpenId, onPin, setShowDeleteModalId}} showTime />)}
                      </div>
                    </div>
                  );
               })}
            </div>
          ) : (
             <div className="px-3 py-2 text-xs text-brand-accent/70 font-medium">No conversations yet.</div>
          )}
        </div>

        <UserProfile />
      </div>

      {showDeleteModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50">
          <div className="bg-white rounded-xl shadow-lg w-[320px] p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Conversation?</h3>
            <p className="text-sm text-gray-500 mb-6">This action cannot be undone.</p>
            <div className="flex items-center justify-end gap-3">
               <button 
                 onClick={() => setShowDeleteModalId(null)}
                 className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
               >
                 Cancel
               </button>
               <button 
                 onClick={() => {
                   onDelete(showDeleteModalId);
                   setShowDeleteModalId(null);
                 }}
                 className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 shadow-sm"
               >
                 Delete
               </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatItem({conv, currentConvId, onSelect, editingId, setEditingId, editTitle, setEditTitle, saveEdit, startEdit, menuOpenId, setMenuOpenId, onPin, setShowDeleteModalId, showTime}: any) {
  const isActive = conv.id === currentConvId;
  const isEditing = editingId === conv.id;
  const isMenuOpen = menuOpenId === conv.id;

  return (
    <div 
      className={`group relative flex items-center h-11 px-3 cursor-pointer rounded-lg transition-colors 
                  ${isActive ? 'bg-white/10 text-brand-accent font-semibold shadow-sm' : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'}`}
      onClick={() => { if(!isEditing) onSelect(conv.id); }}
    >
      {isEditing ? (
        <div className="flex w-full items-center gap-2" onClick={e => e.stopPropagation()}>
           <input 
             autoFocus
             type="text" 
             value={editTitle} 
             onChange={e => setEditTitle(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter') saveEdit(e, conv.id); if(e.key === 'Escape') setEditingId(null); }}
             className="flex-1 w-full bg-brand-primary border border-brand-accent rounded px-2 py-1 text-sm outline-none text-white focus:ring-1 focus:ring-brand-accent"
           />
           <button onClick={(e) => saveEdit(e, conv.id)} className="p-1 text-brand-accent hover:bg-white/10 rounded"><Check size={14}/></button>
           <button onClick={(e) => {e.stopPropagation(); setEditingId(null);}} className="p-1 text-white/50 hover:bg-white/10 rounded"><X size={14}/></button>
        </div>
      ) : (
        <>
          <div className="flex-1 flex flex-col min-w-0 pointer-events-none">
            <span className="truncate text-[14px]">{conv.title}</span>
            {showTime && !isActive && (
               <span className="text-[10px] text-white/40 mt-0.5 truncate tracking-wide hidden group-hover:block transition-opacity opacity-0 group-hover:opacity-100">
                  {formatRelativeTime(conv.updatedAt)}
               </span>
            )}
            {showTime && isActive && (
               <span className="text-[10px] text-brand-accent/70 mt-0.5 truncate tracking-wide block">
                  {formatRelativeTime(conv.updatedAt)}
               </span>
            )}
          </div>
          
          <button 
            onClick={(e) => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : conv.id) }}
            className={`flex-shrink-0 p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors ${isMenuOpen ? 'opacity-100 bg-white/10' : 'opacity-0 group-hover:opacity-100'}`}
          >
             <MoreHorizontal size={14} />
          </button>

          {isMenuOpen && (
             <div 
               className="absolute right-2 top-9 sm:right-6 sm:top-full w-40 bg-white border border-brand-border rounded-lg shadow-xl z-50 py-1 origin-top-right animate-in fade-in zoom-in-95 duration-100"
               onClick={e => e.stopPropagation()}
               onMouseLeave={() => setMenuOpenId(null)}
             >
                <button onClick={(e) => { e.stopPropagation(); onPin(conv.id, !conv.isPinned); setMenuOpenId(null); }} className="w-full flex items-center px-3 py-2.5 hover:bg-gray-50 text-sm text-gray-700 text-left font-medium">
                   <Pin size={14} className="mr-2.5 text-gray-400" /> {conv.isPinned ? 'Unpin Chat' : 'Pin Chat'}
                </button>
                <button onClick={(e) => startEdit(e, conv)} className="w-full flex items-center px-3 py-2.5 hover:bg-gray-50 text-sm text-gray-700 text-left font-medium">
                   <Edit2 size={14} className="mr-2.5 text-gray-400" /> Rename
                </button>
                <div className="h-px bg-gray-100 my-1"></div>
                <button onClick={(e) => { e.stopPropagation(); setShowDeleteModalId(conv.id); setMenuOpenId(null); }} className="w-full flex items-center px-3 py-2.5 hover:bg-red-50 text-sm text-red-600 text-left font-medium">
                   <Trash2 size={14} className="mr-2.5 text-red-500" /> Delete
                </button>
             </div>
          )}
        </>
      )}
    </div>
  );
}
