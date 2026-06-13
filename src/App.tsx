import { useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { InputBar } from './components/InputBar';
import { AuthScreen } from './components/AuthScreen';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [suggestedPrompts, setSuggestedPrompts] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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
    }
  }, [user]);

  const loadSuggestedPrompts = async () => {
    const res = await apiFetch('/api/suggested-prompts');
    if (res?.ok) {
      setSuggestedPrompts(await res.json());
    }
  };

  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
    } else {
      setMessages([]);
    }
  }, [currentConvId]);

  const apiFetch = async (url: string, options: any = {}) => {
    if (!auth.currentUser) return null;
    try {
      const token = await auth.currentUser.getIdToken();
      return await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`
        }
      });
    } catch (err) {
      console.warn("Network error during apiFetch (server might be restarting):", err);
      return null;
    }
  };

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
    setCurrentConvId(null);
  };

  const uploadAttachments = async (attachments: any[], convId: string | null) => {
    const formData = new FormData();
    attachments.forEach(att => formData.append('file', att.file));
    if (convId) formData.append('conversation_id', convId);
    
    // In our backend it handles single upload 'file' from multer upload.single
    // So we'll upload them iteratively to match standard multer setup, or modify server?
    // We used upload.single in server.ts! So we loop and upload one by one.
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

  const handleSend = async (text: string, rawAttachments: any[]) => {
    // 1. Optimistic UI first
    const tempId = Math.random().toString();
    const newMsg = {
      id: tempId,
      role: 'user',
      content: text,
      attachments: rawAttachments.map(f => ({ 
         id: Math.random(), 
         isImage: f.isImage, 
         originalName: f.name, 
         sizeBytes: f.size, 
         mimeType: f.type, 
         url: f.preview 
      }))
    };
    
    setMessages(prev => [...prev, newMsg, { role: 'assistant', content: '', isStreaming: true }]);
    abortControllerRef.current = new AbortController();

    // 2. Upload attachments gracefully
    let aidList: string[] = [];
    if (rawAttachments.length > 0) {
      try {
        aidList = await uploadAttachments(rawAttachments, currentConvId);
        // We could theoretically update the message attachment IDs here, but mostly it doesn't matter for the UI since they have object URLs
      } catch (err) {
        alert("Image upload failed. Please try again.");
        // Rollback
        setMessages(prev => prev.filter(m => m.id !== tempId && m.role !== 'assistant'));
        return;
      }
    }

    // 3. Initiate the Stream
    const token = await auth.currentUser!.getIdToken();
    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          message: text,
          conversation_id: currentConvId,
          attachment_ids: aidList,
          history: messages.slice(-10)
        }),
        signal: abortControllerRef.current.signal
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      setIsGenerating(true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));
          
          if (data.type === 'conversation_id') {
            setCurrentConvId(data.id);
            loadConversations();
          } else if (data.type === 'token') {
            assistantContent += data.content;
            setMessages(prev => {
              const newMsgs = [...prev];
              newMsgs[newMsgs.length - 1] = { role: 'assistant', content: assistantContent, isStreaming: true };
              return newMsgs;
            });
          } else if (data.type === 'done') {
            setIsGenerating(false);
            setMessages(prev => {
              const newMsgs = [...prev];
              if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1]) {
                newMsgs[newMsgs.length - 1].isStreaming = false;
              }
              return newMsgs;
            });
            loadConversations();
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn(err);
      }
      setIsGenerating(false);
      setMessages(prev => {
        const newMsgs = [...prev];
        if (newMsgs.length > 0 && newMsgs[newMsgs.length - 1]) {
          newMsgs[newMsgs.length - 1].isStreaming = false;
        }
        return newMsgs;
      });
    }
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView();
    }
  }, [messages]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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
        <div className="h-16 flex flex-row items-center justify-between px-4 sm:px-6 shrink-0 z-10 bg-brand-primary text-white border-0 shadow-sm">
          <div className="flex items-center gap-2">
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden p-1.5 -ml-2 text-white/70 hover:bg-white/10 rounded-md transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
             </button>
             <div className="hidden sm:flex w-7 h-7 bg-brand-accent rounded items-center justify-center text-brand-primary text-sm font-bold mr-1">D</div>
             <h2 className="text-base font-bold tracking-tight text-white">DOLPHI</h2>
             {isGenerating && <div className="ml-2 w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></div>}
          </div>
          <div className="flex-1 px-4 flex justify-center overflow-hidden whitespace-nowrap text-ellipsis max-w-md text-[15px] text-white/80 font-medium">
             {currentConvId ? conversations.find(c => c.id === currentConvId)?.title : ''}
          </div>
          <div className="flex items-center gap-4 w-[120px]">
             {/* Removed Search and Settings per user request */}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 custom-scrollbar flex justify-center">
          <div className="w-full max-w-[900px]">
          {messages.length === 0 ? (
            <div className="flex flex-col justify-center items-center mt-8 mb-8 px-4">
              <div className="w-14 h-14 bg-brand-primary rounded-xl shadow-sm flex items-center justify-center mb-4">
                <span className="text-2xl font-bold text-brand-accent">D</span>
              </div>
              <h1 className="text-2xl font-bold mb-2 text-brand-primary tracking-tight">Welcome to DOLPHI</h1>
              <p className="text-[15px] mb-8 text-gray-500 max-w-lg text-center leading-relaxed">Your intelligent document, knowledge base, and conversation assistant.</p>
              
              {suggestedPrompts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl w-full">
                  {suggestedPrompts.map((item) => (
                    <button 
                      key={item.id}
                      onClick={() => handlePromptClick(item.title)}
                      className="p-4 rounded-xl flex flex-col text-left transition-all bg-white border border-brand-border hover:border-brand-accent hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] group shadow-sm h-full w-full"
                    >
                      {item.icon && <div className="text-xl mb-2">{item.icon}</div>}
                      <span className="text-[15px] font-semibold text-brand-primary mb-1">{item.title}</span>
                      {item.description && <span className="text-[13px] text-gray-500 leading-snug">{item.description}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pb-10">
              {messages.map((m, i) => (
                <MessageBubble key={m.id || i} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
          </div>
        </div>

        <div className="shrink-0 pt-2 pb-6 px-4 flex justify-center bg-brand-light">
          <div className="w-full max-w-[900px]">
            <InputBar onSend={handleSend} isGenerating={isGenerating} onStop={handleStop} />
            
            <div className="text-center mt-4">
               <div className="text-[12px] text-[#64748b] font-normal">
                 Developed by Taruc & Alcantara | CSS140-1 | EM01-1
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
