import { useState, useRef, useEffect, useCallback } from 'react';
import { auth } from '../lib/firebase';

export function useChatStreaming({ onSyncMessages, onAddConversation, apiFetch, uploadAttachments }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  // Auto scroll improvements
  useEffect(() => {
    const scrollElement = document.getElementById('scroll-container');
    if (!scrollElement) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      // If user scrolled up by more than 100px, consider them scrolling manually
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      isUserScrollingRef.current = !isAtBottom;
    };
    
    scrollElement.addEventListener('scroll', handleScroll);
    
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!isUserScrollingRef.current || force) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  }, []);

  const handleSendRequest = async (
    text: string, 
    rawAttachments: any[], 
    finalConvId: string | null, 
    token: string,
    historyContext: any[]
  ) => {
    const tempId = Math.random().toString();
    const streamingMsgId = crypto.randomUUID();
    
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
    
    setMessages(prev => [...prev, newMsg, { 
      id: streamingMsgId, 
      role: 'assistant', 
      content: '', 
      isStreaming: true,
      hasReceivedFirstToken: false
    }]);
    
    abortControllerRef.current = new AbortController();
    setIsGenerating(true);
    setGenerationError(null);

    try {
      let attachmentIds: string[] = [];
      if (rawAttachments.length > 0) {
        try {
          attachmentIds = await uploadAttachments(rawAttachments, finalConvId);
        } catch (err) {
          alert("Upload failed. Please try again.");
          setGenerationError("Upload failed");
          setMessages(prev => prev.filter(m => m.id !== tempId && m.id !== streamingMsgId));
          setIsGenerating(false);
          return;
        }
      }
      
      // Revoke object URLs once uploaded
      rawAttachments.forEach(att => {
          if (att.preview && att.preview.startsWith('blob:')) {
              URL.revokeObjectURL(att.preview);
          }
      });

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          message: text,
          conversation_id: finalConvId,
          attachment_ids: attachmentIds,
          history: historyContext
        }),
        signal: abortControllerRef.current.signal
      });

      if (!res.ok) throw new Error(`Server returned status: ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          setIsGenerating(false);
          setMessages(prev => prev.map(m => m.id === streamingMsgId ? { ...m, isStreaming: false } : m));
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'conversation_id') {
              finalConvId = data.id;
              setCurrentConvId(data.id);
              onAddConversation(data.id);
            } else if (data.type === 'token') {
              assistantContent += data.content;
              setMessages(prev => prev.map(m => m.id === streamingMsgId ? { 
                ...m, 
                content: assistantContent, 
                isStreaming: true,
                hasReceivedFirstToken: true
              } : m));
              scrollToBottom();
            } else if (data.type === 'done') {
              setIsGenerating(false);
              setMessages(prev => prev.map(m => m.id === streamingMsgId ? { ...m, isStreaming: false } : m));
              onAddConversation(data.conversation_id || finalConvId);
              if (finalConvId || data.conversation_id) {
                onSyncMessages(finalConvId || data.conversation_id);
              }
            }
          } catch (parseError) {
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('Stream failed:', err);
        setGenerationError(err.message || 'Error occurred');
        setMessages(prev => prev.map(m => m.id === streamingMsgId ? { 
          ...m, 
          content: m.content ? m.content : "Sorry, I encountered a temporary issue. Please try again.", 
          isStreaming: false,
          isError: true,
          originalText: text,
          originalAttachments: rawAttachments
        } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === streamingMsgId ? { ...m, isStreaming: false } : m));
      }
      setIsGenerating(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const retryGeneration = async (msgToRetry: any) => {
    if(!msgToRetry.originalText) return;
    setMessages(prev => prev.filter(m => m.id !== msgToRetry.id));
    const token = await auth.currentUser!.getIdToken();
    handleSendRequest(msgToRetry.originalText, msgToRetry.originalAttachments, currentConvId, token, messages.slice(0, -2).slice(-10).map(m => ({ role: m.role, content: m.content })));
  };

  return {
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
  };
}
