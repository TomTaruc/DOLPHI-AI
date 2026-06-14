import { useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { InputBar } from './components/InputBar';
import { AuthScreen } from './components/AuthScreen';
import { StreamingMessage } from './components/StreamingMessage';
import { useChatStreaming } from './hooks/useChatStreaming';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [suggestedPrompts, setSuggestedPrompts] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (user) {
      loadConversations();
      loadSuggestedPrompts();
      
      const lastConvId = localStorage.getItem('lastOpenedConvId');
      if (lastConvId) {
         setCurrentConvId(lastConvId);
      }
    }
  }, [user]);

  const apiFetch = async (url: string, options: any = {}) => {
    if (!auth.currentUser) return { ok: false, json: async () => ({}) };
    try {
      const token = await auth.currentUser.getIdToken();
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`
        }
      });
      return response;
    } catch (err) {
      console.warn("Network error during apiFetch:", err);
      return { ok: false, json: async () => ({}) };
    }
  };

  const uploadAttachments = async (attachments: any[], convId: string | null) => {
    const attIds = [];
    for (const att of attachments) {
      const fd = new FormData();
      fd.append('file', att.file);
      if (convId) fd.append('conversation_id', convId);
      
      try {
        const token = await auth.currentUser!.getIdToken();
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
        if (res.ok) {
          const data = await res.json();
          attIds.push(data.id);
        }
      } catch(err) {
        console.warn("Upload failed:", err);
      }
    }
    return attIds;
  };

  const {
    messages,
    setMessages,
    isGenerating,
    setIsGenerating,
    currentConvId,
    setCurrentConvId,
    generationError,
    messagesEndRef,
    scrollToBottom,
    handleSendRequest,
    cancelGeneration,
    retryGeneration
  } = useChatStreaming({
    onSyncMessages: (id: string) => loadMessages(id),
    onAddConversation: () => loadConversations(),
    apiFetch,
    uploadAttachments
  });

  const loadSuggestedPrompts = async () => {
    const res = await apiFetch('/api/suggested-prompts');
    if (res?.ok) {
      setSuggestedPrompts(await res.json());
    }
  };

  useEffect(() => {
    if (currentConvId && !isGenerating) {
      loadMessages(currentConvId);
      localStorage.setItem('lastOpenedConvId', currentConvId);
    } else if (!currentConvId) {
      setMessages([]);
      localStorage.removeItem('lastOpenedConvId');
    }
  }, [currentConvId]);

  const loadConversations = async () => {
    const res = await apiFetch('/api/conversations');
    if (res?.ok) {
      const data = await res.json();
      setConversations(data);
    }
  };

  const loadMessages = async (id: string) => {
    const res = await apiFetch(`/api/conversations/${id}/messages`);
    if (res?.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  };

  const handleNewChat = () => {
    cancelGeneration();
    setCurrentConvId(null);
    setMessages([]);
  };

  const handleSend = async (text: string, rawAttachments: any[]) => {
    const token = await auth.currentUser!.getIdToken();
    handleSendRequest(text, rawAttachments, currentConvId, token, messages.slice(-10).map((m: any) => ({ role: m.role, content: m.content })));
  };

  const handleStop = () => {
    cancelGeneration();
  };

  const handlePromptClick = (prompt: string) => {
    handleSend(prompt, []);
  };

  if (loading) return null;

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className="w-full flex h-[100dvh] bg-background text-foreground overflow-hidden">
      <Sidebar 
        conversations={conversations} 
        currentConvId={currentConvId} 
        onSelect={(id: string) => { setCurrentConvId(id); setSidebarOpen(false); }} 
        onNew={() => { handleNewChat(); setSidebarOpen(false); }}
        onDelete={async (id: string) => {
          await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
          if(currentConvId === id) setCurrentConvId(null);
          loadConversations();
        }}
        onRename={async (id: string, newTitle: string) => {
          await apiFetch(`/api/conversations/${id}/title`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: newTitle}) });
          loadConversations();
        }}
        onPin={async (id: string, isPinned: boolean) => {
          await apiFetch(`/api/conversations/${id}/pin`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({isPinned}) });
          loadConversations();
        }}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
      />
      
      <div className="flex-1 flex flex-col relative h-full bg-brand-light">
        <div className="h-13 sm:h-14 flex flex-row items-center justify-between px-4 sm:px-6 shrink-0 z-10 bg-white border-b border-gray-200 relative">
          <div className="flex items-center gap-2 relative z-10">
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden p-1.5 -ml-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 rounded-md transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
             </button>
             {isGenerating && <div className="hidden md:block ml-2 w-2 h-2 rounded-full bg-brand-accent animate-pulse"></div>}
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-12">
            <span className="text-[15px] text-gray-800 font-semibold truncate pointer-events-auto max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-lg text-center tracking-tight">
               {currentConvId ? conversations.find(c => c.id === currentConvId)?.title : ''}
            </span>
          </div>
          <div className="flex items-center gap-4 min-w-[32px] md:w-[120px] justify-end relative z-10">
          </div>
        </div>

        <div id="scroll-container" className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 custom-scrollbar flex justify-center">
          <div className="w-full max-w-[900px]">
          {messages.length === 0 ? (
            <div className="flex flex-col justify-center items-center mt-8 mb-8 px-4 h-full min-h-[50vh] animate-in fade-in zoom-in-95 duration-500">
              <img src="/logo.png" alt="DOLPHI Logo" className="w-16 h-16 mb-6 object-contain mix-blend-multiply" referrerPolicy="no-referrer" />
              <h1 className="text-[28px] font-bold mb-3 text-gray-900 tracking-tight text-center">How can I help you today?</h1>
              <p className="text-[15px] mb-10 text-gray-500 max-w-lg text-center leading-relaxed">I can answer questions, analyze documents, and search your secure knowledge base.</p>
              
              {suggestedPrompts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl w-full">
                  {suggestedPrompts.map((item) => (
                    <button 
                      key={item.id}
                      onClick={() => handlePromptClick(item.title)}
                      className="p-4 rounded-xl flex flex-col text-left transition-all bg-white border border-gray-200 hover:border-gray-300 hover:bg-gray-50 hover:shadow-md group shadow-sm w-full focus:outline-none focus:ring-2 focus:ring-gray-200"
                    >
                      <div className="flex items-center gap-2 mb-2">
                         {item.icon && <span className="text-lg opacity-80 group-hover:opacity-100 transition-opacity">{item.icon}</span>}
                         <span className="text-[14px] font-semibold text-gray-900">{item.title}</span>
                      </div>
                      {item.description && <span className="text-[13px] text-gray-500 leading-snug line-clamp-2">{item.description}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pb-10">
              {messages.map((m: any, i: number) => {
                if (m.isStreaming || m.isError) {
                  return <StreamingMessage key={m.id || i} message={m} onRetry={() => retryGeneration(m)} />
                }
                return <MessageBubble key={m.id || i} message={m} />;
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
          </div>
        </div>

        <div className="shrink-0 pt-2 pb-6 px-4 flex justify-center bg-brand-light">
          <div className="w-full max-w-[900px]">
            <InputBar onSend={handleSend} isGenerating={isGenerating} onStop={handleStop} />
            
            <div className="text-center mt-4">
               <div className="text-[12px] text-gray-400 font-normal">
                 Developed by Taruc & Alcantara | CSS140-1 | EM01-1
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
