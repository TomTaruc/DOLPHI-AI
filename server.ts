import 'dotenv/config';

console.log("=== ENV CHECK ===");
console.log("SUPABASE_URL:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_ANON_KEY:", !!process.env.SUPABASE_ANON_KEY);
console.log("GEMINI_API_KEY:", !!process.env.GEMINI_API_KEY);
console.log("DATABASE_URL:", !!process.env.DATABASE_URL);
console.log("=================");

import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { db, initDb } from "./src/db/index.ts";
import { conversations, messages, attachments, retrievalLogs, queryCache, suggestedPrompts, conversationSummaries } from "./src/db/schema.ts";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { indexKnowledgeBase } from "./src/lib/indexer.ts";
import { rewriteQuery, detectIntent, checkSemanticCache, verifyAnswer } from "./src/lib/pipeline.ts";
import { searchKnowledge, embedText } from "./src/lib/retriever.ts";
import fetch from "node-fetch";
import { AIService } from "./src/lib/provider.ts";
import { MAX_HISTORY_MESSAGES } from "./src/lib/constants.ts";

const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-flash-lite-latest';

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    console.info(`[API Attempt Failed] - Error: ${error?.message || error?.status || 'Unknown'}`);
    const isRateLimit = error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429');
    
    if (retries === 0) throw error;
    
    // For non-429 errors, retry only once and very quickly
    if (!isRateLimit && retries > 1) {
       retries = 1;
       delay = 500;
    }
    
    if (isRateLimit && error?.message) {
       const match = error.message.match(/retry in (\d+\.?\d*)s/i);
       if (match && match[1]) {
           const parsedDelay = parseFloat(match[1]) * 1000;
           if (!isNaN(parsedDelay) && parsedDelay > delay) {
               delay = parsedDelay + 500; // Add 500ms jitter/buffer
               console.info(`[RETRY] Parsed delay from error message: waiting ${delay}ms`);
           }
       }
    }
    
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, isRateLimit ? delay * 1.5 : delay * 2);
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
  console.log("Starting initDb...");
  await initDb();
  console.log("initDb success");
} catch (e) {
  console.error("initDb FAILED:");
  console.error(e);

  fs.writeFileSync(
    "server-crash.log",
    "initDb failed:\n" + String(e?.stack || e)
  );

  process.exit(1);
}

  const app = express();
const PORT = Number(process.env.PORT) || 3000;

  // CORS: allow Vite dev server and production origin
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.APP_URL
  ].filter(Boolean) as string[];
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, same-origin)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // In production, allow all origins since we use auth tokens
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }));

  app.use(express.json());

  // Index knowledge base in ALL environments (dev + production)
  indexKnowledgeBase().catch(e =>
    console.error("[KNOWLEDGE] Indexing failed:", e?.message || e)
  );
  // Cleanup orphaned attachments older than 1 day
  setInterval(async () => {
     try {
        const oldAttsRes = await db.execute(sql`SELECT * FROM attachments WHERE conversation_id IS NULL AND created_at < NOW() - INTERVAL '1 day'`);
        const oldAttsRows = (oldAttsRes as any).rows || [];
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

  // Protected reindex route — triggers Knowledge Base re-indexing
  app.post("/api/knowledge/reindex", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Optional: restrict to admin emails if ADMIN_EMAILS env var is set
      const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
      if (adminEmails.length > 0 && !adminEmails.includes(req.dbUser!.email.toLowerCase())) {
        return res.status(403).json({ error: "Forbidden: admin access required" });
      }
      console.log(`[KNOWLEDGE] Reindex triggered by user: ${req.dbUser!.email}`);
      const summary = await indexKnowledgeBase();
      res.json({ success: true, summary });
    } catch (e: any) {
      console.error("[KNOWLEDGE] Reindex failed:", e?.message || e);
      res.status(500).json({ error: "Reindexing failed", detail: e?.message });
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

  // Return only the logged-in user's conversations
  app.get("/api/conversations", requireAuth, async (req: AuthRequest, res) => {
    const results = await db.select().from(conversations).where(eq(conversations.userId, req.dbUser!.id)).orderBy(desc(conversations.updatedAt));
    res.json(results);
  });

  // Verify conversation belongs to the logged-in user before returning messages
  app.get("/api/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Ownership check
    const [conv] = await db.select().from(conversations).where(
      and(eq(conversations.id, id as string), eq(conversations.userId, req.dbUser!.id))
    );
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

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

  // Delete — verify ownership before deleting
  app.delete("/api/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
    const [deleted] = await db.delete(conversations).where(
      and(eq(conversations.id, req.params.id), eq(conversations.userId, req.dbUser!.id))
    ).returning();
    if (!deleted) return res.status(404).json({ error: "Conversation not found" });
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

  // Rename — verify ownership before renaming
  app.put("/api/conversations/:id/title", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { title } = req.body;
      if (!title) return res.status(400).json({ error: "Title required" });
      const [updated] = await db.update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.dbUser!.id)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Conversation not found" });
      res.json(updated);
    } catch(err) {
      res.status(500).json({ error: "Failed to rename" });
    }
  });

  // Pin — verify ownership before pinning
  app.put("/api/conversations/:id/pin", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { isPinned } = req.body;
      const [updated] = await db.update(conversations)
        .set({ isPinned: !!isPinned, updatedAt: new Date() })
        .where(and(eq(conversations.id, req.params.id), eq(conversations.userId, req.dbUser!.id)))
        .returning();
      if (!updated) return res.status(404).json({ error: "Conversation not found" });
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
            const response = await AIService.generateContent({
              model: CHAT_MODEL,
              contents: `Generate a concise and meaningful title (3-8 words) for a conversation based on this user query.
Requirements:
- Capture the primary topic or intent exactly (e.g., \"Network Segmentation\", \"Firewall Policies and ACLs\").
- NEVER use generic titles like \"New Conversation\", \"Beginning a New Conversation\", \"Hello\", \"Hi\", or \"Untitled Chat\".
- Base it on the core subject matter of the query.
- Output ONLY the title, no quotes, no prefix.

Examples:
Query: \"What is network segmentation?\"
Title: Network Segmentation
Query: \"Explain firewall policies and ACLs\"
Title: Firewall Policies and ACLs
Query: \"Summarize the uploaded cybersecurity textbook\"
Title: Cybersecurity Textbook Summary
Query: \"Compare IDS and IPS\"
Title: IDS vs IPS Comparison

Query: ${message}`
            });
            const title = response.text?.trim();
            if (title) {
              await db.update(conversations).set({ title }).where(eq(conversations.id, localConvId));
            }
          } catch (e: any) {
             console.info("Auto-title failed:", e?.message || "Unknown error");
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

         let systemPrompt = `You are DOLPHI AI, a helpful, intelligent school assistant for Mapua University.`;

         if (chunksUsed.length > 0) {
              // Build source citations from unique filenames
              const sourceFiles = [...new Set(chunksUsed.map((c: any) => c.sourceFile).filter(Boolean))];
              const sourceCitation = sourceFiles.length > 0 ? `\nSource documents: ${sourceFiles.join(', ')}` : '';
              systemPrompt += `\n\nRETRIEVED KNOWLEDGE BASE CONTENT (confidence: ${confidence.toFixed(2)}):${sourceCitation}\n\n${contextChunksText}\n\nINSTRUCTIONS:\n- Answer the user's question based on the retrieved Knowledge Base content above.\n- When your answer uses information from the Knowledge Base, cite the source document name(s).\n- If the retrieved content is clearly relevant and answers the question, base your response on it.\n- If the retrieved content is NOT relevant to the user's question, or does not contain enough information, say: "I couldn't find specific information about this in the school Knowledge Base." Then optionally provide a helpful answer using your general knowledge, clearly marking it as general information.\n- Do NOT invent or fabricate source references.\n- Do NOT pretend unrelated Knowledge Base content answers the question.`;
          } else if (attachment_ids && attachment_ids.length > 0) {
              systemPrompt += `\n\nINSTRUCTIONS: You have been provided with uploaded files. Analyze them carefully and directly answer the user's request based on their contents.`;
          } else {
              systemPrompt += `\n\nINSTRUCTIONS: Answer the user's query using your general knowledge and the provided conversation history. If the user is asking about school-specific policies, documents, or rules and you don't have that information, let them know that the specific document may not be in the Knowledge Base yet.`;
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

         console.log(`[TRACE] [STEP 5] Calling ${CHAT_MODEL} with ${sanitizedContents.length} contents entries.`);
         
         const ac = new AbortController();
         const timeoutId = setTimeout(() => ac.abort(new Error("TIMEOUT")), 300000); // 300s
         
         try {
             const responseStream = await Promise.race([
                 withRetry<any>(() => AIService.generateContentStream({
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
             console.info(`[STREAM] API Call failed or timed out:`, e?.message || e);
             throw e; // goes to outer catch
         }

         // Send enriched metadata including hybrid retrieval info
         res.write(`data: ${JSON.stringify({ 
           type: 'meta', 
           confidence, 
           sources: [...new Set(chunksUsed.slice(0, 5).map((c: any) => c.sourceFile).filter(Boolean))],
           retrieval: chunksUsed.slice(0, 3).map((c: any) => ({
             sourceFile: c.sourceFile,
             hybridScore: c.hybridScore,
             matchMethod: c.matchMethod
           }))
         })}\n\n`);
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
             const msgCount = parseInt(((allMsgsRes as any).rows && (allMsgsRes as any).rows[0] ? (allMsgsRes as any).rows[0].count : "0") as string);
             if (msgCount > 12) {
                 const oldHistoryRows = await db.select()
                     .from(messages)
                     .where(eq(messages.conversationId, convId))
                     .orderBy(messages.createdAt)
                     .limit(msgCount - 8);
                     
                 const oldText = oldHistoryRows.map((m: any) => `${m.role}: ${m.content}`).join('\n');
                 const response = await AIService.generateContent({
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
         } catch(e) { console.info("Summary failed", e); }
      })();

      res.write(`data: ${JSON.stringify({ type: 'done', message_id: asstMsg.id })}\n\n`);
      (res as any).flush?.();
    } catch (error: any) {
      console.info("Chat stream error:", error.message || error);
      if (!finalAnswer) {
          finalAnswer = "I'm having trouble thinking right now. Please try your request again.";
      }
      res.write(`data: ${JSON.stringify({ type: 'token', content: "\\n\\nI'm having trouble thinking right now. Please try your request again." })}\n\n`);
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
    console.info("Top level stream error:", outerError);
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
  console.log(`Server running on port ${PORT}`);
});
}

startServer();
