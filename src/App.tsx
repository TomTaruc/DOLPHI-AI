import { useEffect, useState, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { Sidebar } from './components/Sidebar';
import { MessageBubble } from './components/MessageBubble';
import { InputBar } from './components/InputBar';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
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
    }
  }, [user]);

  useEffect(() => {
    if (currentConvId) {
      loadMessages(currentConvId);
    } else {
      setMessages([]);
    }
  }, [currentConvId]);

  const apiFetch = async (url: string, options: any = {}) => {
    if (!auth.currentUser) return null;
    const token = await auth.currentUser.getIdToken();
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    });
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
      setMessages(data.messages);
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
    }
    return attIds;
  };

  const handleSend = async (text: string, rawAttachments: any[]) => {
    let aidList: string[] = [];
    if (rawAttachments.length > 0) {
      aidList = await uploadAttachments(rawAttachments, currentConvId);
    }

    const newMsg = {
      id: Math.random().toString(),
      role: 'user',
      content: text,
      attachments: rawAttachments.map((f, i) => ({ id: aidList[i] || Math.random(), isImage: f.isImage, originalName: f.name, sizeBytes: f.size, mimeType: f.type, url: f.preview }))
    };
    
    // Optimistic UI
    setMessages(prev => [...prev, newMsg, { role: 'assistant', content: '', isStreaming: true }]);
    
    abortControllerRef.current = new AbortController();

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
    return (
      <div className="h-screen w-full flex items-center justify-center bg-[var(--ink)]">
        <div className="text-center p-8 border border-[var(--mist)] rounded-2xl bg-[var(--graphite)]">
          <h1 className="text-3xl mb-6 font-[var(--font-display)] text-[var(--bone)]">DOLPHI AI</h1>
          <p className="mb-6 text-[var(--fog)] max-w-sm">Secure Cloud SQL setup requires authentication. Please sign in to access your database.</p>
          <button 
            onClick={() => signInWithPopup(auth, provider)}
            className="px-6 py-2 bg-[var(--green)] text-[var(--ink)] rounded-full font-medium"
          >
            Google Sign-in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex h-screen h-[100dvh]">
      <Sidebar 
        conversations={conversations} 
        currentConvId={currentConvId} 
        onSelect={setCurrentConvId} 
        onNew={handleNewChat}
        onDelete={async (id: string) => {
          await apiFetch(`/api/conversations/${id}`, { method: 'DELETE' });
          if(currentConvId === id) setCurrentConvId(null);
          loadConversations();
        }}
      />
      
      <div className="flex-1 flex flex-col relative h-full">
        <div className="h-[56px] flex items-center px-6 shrink-0" style={{ backgroundColor: 'var(--graphite)', borderBottom: '1px solid var(--mist)' }}>
          <h2 className="text-[16px] italic font-[var(--font-display)]" style={{ color: 'var(--bone)' }}>DOLPHI AI</h2>
        </div>

        <div className="flex-1 overflow-y-auto px-[10%] pt-8 pb-4 custom-scrollbar">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-center -mt-10">
              <h1 className="text-[32px] mb-2 font-[var(--font-display)]" style={{ color: 'var(--bone)' }}>DOLPHI AI</h1>
              <p className="text-[16px] mb-12" style={{ color: 'var(--fog)' }}>What can I help you with?</p>
              
              <div className="grid grid-cols-2 gap-4 max-w-2xl w-full">
                {[
                  { icon: '📋', text: 'Summarize docs' },
                  { icon: '🔍', text: 'Search knowledge' },
                  { icon: '🖼️', text: 'Analyze image' },
                  { icon: '📊', text: 'Compare options' },
                ].map((item, i) => (
                  <button 
                    key={i}
                    onClick={() => handlePromptClick(item.text)}
                    className="p-4 rounded-[12px] flex items-center text-left transition-colors group hover:border-[var(--green-dim)]"
                    style={{ backgroundColor: 'var(--slate)', border: '1px solid var(--mist)' }}
                  >
                    <span className="mr-3 text-lg">{item.icon}</span>
                    <span className="text-[14px] group-hover:text-[var(--bone)]" style={{ color: 'var(--fog)' }}>{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto w-full">
              {messages.map((m, i) => (
                <MessageBubble key={m.id || i} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="shrink-0 pt-2 pb-6" style={{ background: 'linear-gradient(to bottom, transparent, var(--ink) 10%)' }}>
          <InputBar onSend={handleSend} isGenerating={isGenerating} onStop={handleStop} />
          
          <div className="text-center mt-4">
             <div className="text-[11px]" style={{ color: 'var(--ash)' }}>
               Powered by DOLPHI AI &middot; AI responses may contain mistakes
             </div>
             <div className="text-[11px]" style={{ color: 'var(--ash)' }}>
               Knowledge Base v1.0.0 &middot; Last updated {new Date().toLocaleDateString()}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
