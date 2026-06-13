import { useState, useMemo } from "react";
import { Plus, Search, MoreHorizontal, Check, X, Trash2, Edit2, Pin } from "lucide-react";
import { UserProfile } from "./UserProfile";

export function Sidebar({ conversations, currentConvId, onSelect, onNew, onDelete, onRename, onPin, isOpen, setIsOpen }) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showDeleteModalId, setShowDeleteModalId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return conversations.filter(c => c.title?.toLowerCase().includes(search.toLowerCase()));
  }, [conversations, search]);

  const pinned = filtered.filter(c => c.isPinned);
  const recent = filtered.filter(c => !c.isPinned);

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
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="w-8 h-8 rounded bg-brand-accent flex items-center justify-center text-brand-primary font-bold text-lg">D</div>
            <h1 className="text-xl font-bold tracking-tight text-white">DOLPHI</h1>
          </div>
          <button 
            onClick={onNew}
            className="w-full h-10 px-4 flex items-center justify-between rounded-lg font-medium transition-colors bg-brand-accent hover:bg-[#e4b400] text-brand-primary shadow-sm"
          >
            <span className="text-sm font-semibold">New Chat</span>
            <Plus size={16} />
          </button>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
            <input 
              type="text" 
              placeholder="Search conversations..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/10 border-transparent focus:border-white/20 focus:bg-white/15 text-white text-sm focus:outline-none transition-all placeholder-white/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-6 custom-scrollbar">
          {pinned.length > 0 && (
            <div>
              <div className="px-3 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wider">Pinned</div>
              <div className="space-y-0.5">
                {pinned.map(c => <ChatItem key={c.id} conv={c} {...{currentConvId, onSelect, editingId, setEditingId, editTitle, setEditTitle, saveEdit, startEdit, menuOpenId, setMenuOpenId, onPin, setShowDeleteModalId}} />)}
              </div>
            </div>
          )}

          <div>
            <div className="px-3 mb-2 text-xs font-semibold text-white/50 uppercase tracking-wider">{pinned.length > 0 ? 'Recent' : 'Conversations'}</div>
            <div className="space-y-0.5">
              {recent.length > 0 ? (
                recent.map(c => <ChatItem key={c.id} conv={c} {...{currentConvId, onSelect, editingId, setEditingId, editTitle, setEditTitle, saveEdit, startEdit, menuOpenId, setMenuOpenId, onPin, setShowDeleteModalId}} />)
              ) : (
                <div className="px-3 py-2 text-xs text-brand-accent/70 font-medium">No conversations yet.</div>
              )}
            </div>
          </div>
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

function ChatItem({conv, currentConvId, onSelect, editingId, setEditingId, editTitle, setEditTitle, saveEdit, startEdit, menuOpenId, setMenuOpenId, onPin, setShowDeleteModalId}) {
  const isActive = conv.id === currentConvId;
  const isEditing = editingId === conv.id;
  const isMenuOpen = menuOpenId === conv.id;

  return (
    <div 
      className={`group relative flex items-center h-10 px-3 cursor-pointer rounded-lg transition-colors border-l-[3px]
                  ${isActive ? 'bg-[rgba(245,197,24,0.15)] border-brand-accent text-white font-medium' : 'border-transparent text-white/80 hover:bg-white/10 hover:text-white'}`}
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
             className="flex-1 w-full bg-brand-primary border border-brand-accent rounded px-2 py-1 text-sm outline-none text-white"
           />
           <button onClick={(e) => saveEdit(e, conv.id)} className="p-1 text-brand-accent hover:bg-white/10 rounded"><Check size={14}/></button>
           <button onClick={(e) => {e.stopPropagation(); setEditingId(null);}} className="p-1 text-white/50 hover:bg-white/10 rounded"><X size={14}/></button>
        </div>
      ) : (
        <>
          <div className="truncate flex-1 text-sm">{conv.title}</div>
          
          <button 
            onClick={(e) => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : conv.id) }}
            className={`flex-shrink-0 p-1.5 rounded-md text-white/50 hover:text-white transition-colors ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
             <MoreHorizontal size={14} />
          </button>

          {isMenuOpen && (
             <div 
               className="absolute right-2 top-9 sm:right-0 sm:top-full w-40 bg-white border border-brand-border rounded-lg shadow-lg z-50 py-1"
               onClick={e => e.stopPropagation()}
               onMouseLeave={() => setMenuOpenId(null)}
             >
                <button onClick={(e) => { e.stopPropagation(); onPin(conv.id, !conv.isPinned); setMenuOpenId(null); }} className="w-full flex items-center px-3 py-2 hover:bg-gray-50 text-sm text-[var(--foreground)] text-left">
                   <Pin size={14} className="mr-2 text-gray-500" /> {conv.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button onClick={(e) => startEdit(e, conv)} className="w-full flex items-center px-3 py-2 hover:bg-gray-50 text-sm text-[var(--foreground)] text-left">
                   <Edit2 size={14} className="mr-2 text-gray-500" /> Rename
                </button>
                <button onClick={(e) => { e.stopPropagation(); setShowDeleteModalId(conv.id); setMenuOpenId(null); }} className="w-full flex items-center px-3 py-2 hover:bg-red-50 text-sm text-[var(--error)] text-left">
                   <Trash2 size={14} className="mr-2 text-[var(--error)] opacity-70" /> Delete
                </button>
             </div>
          )}
        </>
      )}
    </div>
  );
}
