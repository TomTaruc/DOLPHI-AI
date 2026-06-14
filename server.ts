import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { db, initDb } from "./src/db/index.ts";
import { conversations, messages, attachments, retrievalLogs, queryCache, suggestedPrompts, conversationSummaries } from "./src/db/schema.ts";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { indexKnowledgeBase } from "./src/lib/indexer.ts";
import { rewriteQuery, detectIntent, checkSemanticCache, verifyAnswer } from "./src/lib/pipeline.ts";
import { searchKnowledge, embedText } from "./src/lib/retriever.ts";
import fetch from "node-fetch";
import { GoogleGenAI } from "@google/genai";
import { MAX_HISTORY_MESSAGES } from "./src/lib/constants.ts";

const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-3.5-flash';

function getGenAI() {
  return new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY || 'dummy',
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    console.warn(`[API Attempt Failed] - Error: ${error?.message || error?.status || 'Unknown'}`);
    const isRateLimit = error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429');
    
    if (retries === 0) throw error;
    
    // For non-429 errors, retry only once and very quickly
    if (!isRateLimit && retries > 1) {
       retries = 1;
       delay = 500;
    }
    
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// File upload setup
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const today = new Date().toISOString().split('T')[0];
    const dir = path.join(UPLOAD_DIR, 'temp', today);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } 
});

async function startServer() {
  process.on('uncaughtException', err => {
    fs.writeFileSync('server-crash.log', 'Uncaught: ' + err.stack);
    process.exit(1);
  });
  process.on('unhandledRejection', err => {
    fs.writeFileSync('server-crash.log', 'Unhandled: ' + (err as any).stack);
    process.exit(1);
  });
  
  try {
    await initDb();
  } catch(e) {
    fs.writeFileSync('server-crash.log', 'initDb failed: ' + e.stack);
    process.exit(1);
  }

  const app = express();
  const PORT = 3000;

  app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }));

  app.use(express.json());

  // Wait for indexing
  indexKnowledgeBase().catch(e => console.error("Indexing failed:", e));

  // Cleanup orphaned attachments older than 1 day
  setInterval(async () => {
     try {
        const oldAttsRes = await db.execute(sql`SELECT * FROM attachments WHERE conversation_id IS NULL AND created_at < NOW() - INTERVAL '1 day'`);
        const oldAttsRows = oldAttsRes.rows || [];
        for (const att of oldAttsRows) {
           if (fs.existsSync(att.storage_path as string)) {
              fs.unlinkSync(att.storage_path as string);
           }
        }
        await db.execute(sql`DELETE FROM attachments WHERE conversation_id IS NULL AND created_at < NOW() - INTERVAL '1 day'`);
     } catch(e) {}
  }, 1000 * 60 * 60 * 12); // run every 12 hours

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/knowledge/meta", requireAuth, (req, res) => {
    try {
      const metaPath = path.join(process.env.KNOWLEDGE_DIR || path.join(process.cwd(), 'knowledge'), 'metadata.json');
      if (fs.existsSync(metaPath)) {
        res.json(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
      } else {
        res.json({ version: "1.0.0", last_updated: new Date().toISOString() });
      }
    } catch {
      res.json({ version: "1.0.0", last_updated: new Date().toISOString() });
    }
  });

  app.get("/api/suggested-prompts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const prompts = await db.select().from(suggestedPrompts).limit(4);
      res.json(prompts);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch prompts" });
    }
  });

  app.get("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    const results = await db.select().from(conversations).where(eq(conversations.userId, req.dbUser!.id)).orderBy(desc(conversations.updatedAt));
    res.json(results);
  });

  app.get("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    const { id } = req.params;
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id as string)).orderBy(messages.createdAt);
    const resultMessages = [];
    
    for (const msg of msgs) {
       const atts = await db.select().from(attachments).where(eq(attachments.messageId, msg.id));
       resultMessages.push({
         ...msg,
         attachments: atts
       });
    }

    res.json({
      conversation_id: id,
      messages: resultMessages
    });
  });

  app.delete("/api/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
    await db.delete(conversations).where(eq(conversations.id, req.params.id));
    res.json({ success: true });
  });

  app.post("/api/upload", requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const { originalname, mimetype, size, path: filepath } = req.file;
    const isImg = mimetype.startsWith('image/');
    
    // Create attachment record early
    let convId = req.body.conversation_id;
    if (convId === "null" || !convId) convId = null;

    const [att] = await db.insert(attachments).values({
      conversationId: convId, // Dummy if unbound yet, handled later
      originalName: originalname,
      storedName: path.basename(filepath),
      mimeType: mimetype,
      sizeBytes: size,
      storagePath: filepath,
      isImage: isImg
    }).returning();

    res.json({
      id: att.id,
      original_name: originalname,
      mime_type: mimetype,
      size_bytes: size,
      is_image: isImg,
      url: `/api/files/${att.id}`
    });
  });

  app.put("/api/conversations/:id/title", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title } = req.body;
      if (!title) return res.status(400).json({ error: "Title required" });
      const [updated] = await db.update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(eq(conversations.id, req.params.id))
        .returning();
      res.json(updated);
    } catch(err) {
      res.status(500).json({ error: "Failed to rename" });
    }
  });

  app.put("/api/conversations/:id/pin", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { isPinned } = req.body;
      const [updated] = await db.update(conversations)
        .set({ isPinned: !!isPinned, updatedAt: new Date() })
        .where(eq(conversations.id, req.params.id))
        .returning();
      res.json(updated);
    } catch(err) {
      res.status(500).json({ error: "Failed to pin" });
    }
  });

  app.get("/api/files/:id", requireAuth, async (req: AuthRequest, res) => {
    const [att] = await db.select().from(attachments).where(eq(attachments.id, req.params.id));
    if (!att) return res.status(404).json({ error: "Not found" });
    
    if (att.conversationId) {
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, att.conversationId));
      if (conv && conv.userId !== req.dbUser!.id) return res.status(403).json({ error: "Forbidden" });
    }
    
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', att.isImage ? 'inline' : 'attachment');
    const stream = fs.createReadStream(att.storagePath);
    stream.pipe(res);
  });

  app.post("/api/chat/stream", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { message, conversation_id, attachment_ids, history } = req.body;
      let convId = conversation_id;

      if (!convId) {
        const [conv] = await db.insert(conversations).values({
          userId: req.dbUser!.id,
          title: message.slice(0, 40)
        }).returning();
        convId = conv.id;
        
        // Update attachments that were uploaded before the conv existed
        if (attachment_ids?.length) {
           for (const aid of attachment_ids) {
              await db.execute(sql`UPDATE attachments SET conversation_id = ${convId} WHERE id = ${aid}`);
           }
        }

        const localConvId = convId;

        // Generate a better title async
        (async () => {
          try {
            const ai = getGenAI();
            const response = await ai.models.generateContent({
              model: CHAT_MODEL,
              contents: `Generate a short title (3-6 words) for a conversation starting with this message. Output ONLY the title, no quotes or prefix.\n\nMessage: ${message}`
            });
            const title = response.text?.trim();
            if (title) {
              await db.update(conversations).set({ title }).where(eq(conversations.id, localConvId));
            }
          } catch (e: any) {
             console.warn("Auto-title failed:", e?.message || "Unknown error");
          }
        })();
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      if (!conversation_id) {
         res.write(`data: ${JSON.stringify({ type: 'conversation_id', id: convId })}\n\n`);
         (res as any).flush?.();
      }

      const startTime = Date.now();
      let finalAnswer = "";
      let chunksUsed: any[] = [];
      let contextChunksText = "";
      let confidence = 0.9;
      let rewritten = message;
      
      console.log(`[TRACE] [STEP 1] User message received. Conv=${convId}`);
      try {
        const intent = await detectIntent(message);
      console.log(`[TRACE] [STEP 2] detectIntent done, intent=${intent}`);
      
      const [userMsg] = await db.insert(messages).values({
        conversationId: convId,
        role: "user",
        content: message
      }).returning();

      await db.update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, convId));

      if (attachment_ids && attachment_ids.length > 0) {
        for (const aid of attachment_ids) {
           await db.execute(sql`UPDATE attachments SET message_id = ${userMsg.id} WHERE id = ${aid}`);
        }
      }

      // Check cache
      // --- CRITICAL FIX 3A: Bypass cache if there is conversation history ---
      const isFreshQuery = !history || history.length === 0;
      const hasNoAttachments = !attachment_ids || attachment_ids.length === 0;
      
      const cached = (isFreshQuery && hasNoAttachments) 
          ? await checkSemanticCache(message, intent, attachment_ids, history.length) 
          : null;
      // ----------------------------------------------------------------------
      console.log(`[STREAM] Cache check done | hit=${!!cached}`);
      
      if (cached) {
         finalAnswer = cached;
         res.write(`data: ${JSON.stringify({ type: 'token', content: finalAnswer })}\n\n`);
         (res as any).flush?.();
      } else {
         const hasAttachments = attachment_ids && attachment_ids.length > 0;

         console.log(`[TRACE] [STEP 3] Search/Retrieval started.`);
         if (!hasAttachments && ['knowledge_search', 'general_question'].includes(intent)) {
            rewritten = await rewriteQuery(message, history);
            const searchResult = await searchKnowledge(rewritten);
            chunksUsed = searchResult.results;
            
            if (searchResult.error || chunksUsed.length === 0) {
               confidence = 0.0;
            } else {
               confidence = chunksUsed[0].similarity || 0;
            }
            contextChunksText = chunksUsed.map((c: any) => c.content).join('\n\n');
         }
         console.log(`[TRACE] [STEP 4] Search/Retrieval completed.`);

         let systemPrompt = `You are DOLPHI AI, a helpful, intelligent assistant.`;

         if (chunksUsed.length > 0) {
             systemPrompt += `\n\nRETRIEVED KNOWLEDGE (confidence: ${confidence}):\n${contextChunksText}\n\nINSTRUCTIONS: Answer based on the retrieved knowledge if it contains the answer. If the retrieved knowledge is irrelevant or insufficient, explicitly use your general model knowledge to fully answer the user.`;
         } else if (attachment_ids && attachment_ids.length > 0) {
             systemPrompt += `\n\nINSTRUCTIONS: You have been provided with uploaded files. Analyze them carefully and directly answer the user's request based on their contents.`;
         } else {
             systemPrompt += `\n\nINSTRUCTIONS: Answer the user's query using your general knowledge and the provided conversation history.`;
         }

         const contents: any[] = [];
         
         const [latestSummary] = await db.select().from(conversationSummaries)
            .where(eq(conversationSummaries.conversationId, convId))
            .orderBy(desc(conversationSummaries.createdAt))
            .limit(1);

         if (latestSummary && latestSummary.summary) {
             contents.push({ role: "user", parts: [{ text: "Here is context from earlier in our conversation." }] });
             contents.push({ role: "model", parts: [{ text: "PREVIOUS CONVERSATION SUMMARY:\n" + latestSummary.summary }] });
         }

         // Add history from db using Drizzle
         const messageRows = await db.select()
            .from(messages)
            .where(sql`${messages.conversationId} = ${convId} AND ${messages.id} != ${userMsg.id}`)
            .orderBy(desc(messages.createdAt))
            .limit(MAX_HISTORY_MESSAGES);
         
         messageRows.reverse();

         for (const h of messageRows) {
             let hParts: any[] = [{ text: h.content || "" }];
             const attachmentRows = await db.select().from(attachments).where(eq(attachments.messageId, h.id));
             
             for (const att of attachmentRows) {
                 if (att.isImage || att.mimeType === 'application/pdf') {
                    try {
                      const base64Img = fs.readFileSync(att.storagePath, 'base64');
                      hParts.push({ inlineData: { mimeType: att.mimeType, data: base64Img } });
                    } catch(e) {}
                 }
             }
             contents.push({ role: h.role === "user" ? "user" : "model", parts: hParts });
         }

         let parts: any[] = [];
         parts.push({ text: message });

         const textMimes = ['text/plain', 'text/csv', 'text/markdown', 'application/json'];

         if (attachment_ids && attachment_ids.length > 0) {
            for (const aid of attachment_ids) {
               const [att] = await db.select().from(attachments).where(eq(attachments.id, aid));
               if (att) {
                  if (att.isImage || att.mimeType === 'application/pdf') {
                     const base64Img = fs.readFileSync(att.storagePath, 'base64');
                     parts.push({
                        inlineData: {
                          mimeType: att.mimeType,
                          data: base64Img
                        }
                     });
                  } else if (textMimes.includes(att.mimeType)) {
                     const txtContent = fs.readFileSync(att.storagePath, 'utf8');
                     parts.push({
                        text: `\n\n[Attached File: ${att.originalName}]\n${txtContent.substring(0, 10000)}`
                     });
                  } else {
                     parts.push({ text: `\n\n[Attached File: ${att.originalName}]\n(System Note: The contents of this file format (${att.mimeType || 'unknown'}) cannot be directly read as text. Inform the user they must provide a PDF, TXT, or CSV file for deep analysis.)` });
                  }
               }
            }
         }

         contents.push({ role: "user", parts: parts });

         const sanitizedContents: any[] = [];
         for (const c of contents) {
            if (sanitizedContents.length > 0 && sanitizedContents[sanitizedContents.length - 1].role === c.role) {
                sanitizedContents[sanitizedContents.length - 1].parts.push(...c.parts);
            } else {
                sanitizedContents.push(c);
            }
         }

         const ai = getGenAI();
         console.log(`[TRACE] [STEP 5] Calling ${CHAT_MODEL} with ${sanitizedContents.length} contents entries.`);
         
         const ac = new AbortController();
         const timeoutId = setTimeout(() => ac.abort(new Error("TIMEOUT")), 25000);
         
         try {
             const responseStream = await Promise.race([
                 withRetry<any>(() => ai.models.generateContentStream({
                     model: CHAT_MODEL,
                     contents: sanitizedContents,
                     config: { systemInstruction: systemPrompt }
                 })),
                 new Promise<any>((_, reject) => {
                     ac.signal.addEventListener('abort', () => reject(ac.signal.reason));
                 })
             ]);
    
             console.log("[TRACE] [STEP 6] Stream opened");
             let gotFirst = false;
             for await (const chunk of responseStream) {
                if (!gotFirst) {
                    console.log("[TRACE] [STEP 7] First token received");
                    gotFirst = true;
                }
                const text = (chunk as any).text || "";
                if (text) {
                   finalAnswer += text;
                   res.write(`data: ${JSON.stringify({ type: 'token', content: text })}\n\n`);
                   (res as any).flush?.();
                }
             }
             clearTimeout(timeoutId);
             console.log(`[TRACE] [STEP 8] Response completed for conv=${convId}`);
         } catch(e: any) {
             clearTimeout(timeoutId);
             console.warn(`[STREAM] API Call failed or timed out:`, e?.message || e);
             throw e; // goes to outer catch
         }

         res.write(`data: ${JSON.stringify({ type: 'meta', confidence, sources: chunksUsed.slice(0, 3).map((c: any) => c.sourceFile) })}\n\n`);
         (res as any).flush?.();

         // Save to query cache implicitly
         const finalEmbedding = await embedText(message).catch(e => null);
         
         // --- CRITICAL FIX 3B: ONLY save zero-shot global queries to the cache ---
         if (isFreshQuery && hasNoAttachments && finalEmbedding && finalEmbedding.length > 0) {
            await db.insert(queryCache).values({
               queryText: message,
               queryEmbedding: finalEmbedding,
               answer: finalAnswer,
            });
         }
         // ------------------------------------------------------------------------

         // Log analytics
         await db.insert(retrievalLogs).values({
            conversationId: convId,
            query: message,
            rewrittenQuery: rewritten,
            confidence: confidence,
            chunksUsed: JSON.stringify(chunksUsed),
            responseTimeMs: Date.now() - startTime
         });
      }

      const [asstMsg] = await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: finalAnswer
      }).returning();
      
      if (['knowledge_search', 'document_analysis'].includes(intent) && !!finalAnswer) {
          verifyAnswer(message, chunksUsed, finalAnswer).catch(e => {}); // Optional async call
      }
      
      // Async rolling summary update
      (async () => {
         try {
             const allMsgsRes = await db.execute(sql`SELECT COUNT(id) as count FROM messages WHERE conversation_id = ${convId}`);
             const msgCount = parseInt((allMsgsRes.rows && allMsgsRes.rows[0] ? allMsgsRes.rows[0].count : "0") as string);
             if (msgCount > 12) {
                 const oldHistoryRows = await db.select()
                     .from(messages)
                     .where(eq(messages.conversationId, convId))
                     .orderBy(messages.createdAt)
                     .limit(msgCount - 8);
                     
                 const ai = getGenAI();
                 const oldText = oldHistoryRows.map((m: any) => `${m.role}: ${m.content}`).join('\n');
                 const response = await ai.models.generateContent({
                     model: CHAT_MODEL,
                     contents: `Summarize the key information, context, and user constraints from this older conversation history. Keep it concise but factual.\n\n${oldText}`
                 });
                 const newSummary = (response.text || "").trim();
                 if (newSummary) {
                     await db.insert(conversationSummaries).values({
                         conversationId: convId,
                         summary: newSummary
                     });
                 }
             }
         } catch(e) { console.warn("Summary failed", e); }
      })();

      res.write(`data: ${JSON.stringify({ type: 'done', message_id: asstMsg.id })}\n\n`);
      (res as any).flush?.();
    } catch (error: any) {
      console.warn("Chat stream error:", error.message || error);
      if (!finalAnswer) {
          finalAnswer = "[Connection lost, or API rate limit exceeded. Please try again.]";
      }
      res.write(`data: ${JSON.stringify({ type: 'token', content: "\\n\\n[Connection lost, or API rate limit exceeded. Please try again.]" })}\n\n`);
      (res as any).flush?.();
      
      const [asstMsg] = await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: finalAnswer
      }).returning();
      
      res.write(`data: ${JSON.stringify({ type: 'done', message_id: asstMsg.id })}\n\n`);
      (res as any).flush?.();
    }
    
    res.end();
  } catch (outerError: any) {
    console.error("Top level stream error:", outerError);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate reply" });
    } else {
      res.end();
    }
  }
});

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
