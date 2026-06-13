import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { db } from "./src/db/index.ts";
import { conversations, messages, attachments, retrievalLogs, queryCache } from "./src/db/schema.ts";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { indexKnowledgeBase } from "./src/lib/indexer.ts";
import { rewriteQuery, detectIntent, checkSemanticCache, verifyAnswer } from "./src/lib/pipeline.ts";
import { searchKnowledge } from "./src/lib/retriever.ts";
import fetch from "node-fetch";
import { GoogleGenAI } from '@google/genai';

// File upload setup
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const today = new Date().toISOString().split('T')[0];
    const convId = req.body.conversation_id || 'unassigned';
    const dir = path.join(UPLOAD_DIR, today, convId);
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
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Wait for indexing
  await indexKnowledgeBase();

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

  app.get("/api/files/:id", requireAuth, async (req: AuthRequest, res) => {
    const [att] = await db.select().from(attachments).where(eq(attachments.id, req.params.id));
    if (!att) return res.status(404).json({ error: "Not found" });
    
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader('Content-Disposition', att.isImage ? 'inline' : 'attachment');
    const stream = fs.createReadStream(att.storagePath);
    stream.pipe(res);
  });

  app.post("/api/chat/stream", requireAuth, async (req: AuthRequest, res) => {
    const { message, conversation_id, attachment_ids, history } = req.body;
    let convId = conversation_id;

    if (!convId) {
      const [conv] = await db.insert(conversations).values({
        userId: req.dbUser!.id,
        title: message.slice(0, 40)
      }).returning();
      convId = conv.id;
      // Also update any attachments that were uploaded before the conv existed
      if (attachment_ids?.length) {
         for (const aid of attachment_ids) {
            await db.execute(sql`UPDATE attachments SET conversation_id = ${convId} WHERE id = ${aid}`);
         }
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    if (!conversation_id) res.write(`data: ${JSON.stringify({ type: 'conversation_id', id: convId })}\n\n`);

    const startTime = Date.now();
    let finalAnswer = "";
    
    try {
      const intent = await detectIntent(message);
      
      const [userMsg] = await db.insert(messages).values({
        conversationId: convId,
        role: "user",
        content: message
      }).returning();

      if (attachment_ids && attachment_ids.length > 0) {
        for (const aid of attachment_ids) {
           await db.execute(sql`UPDATE attachments SET message_id = ${userMsg.id} WHERE id = ${aid}`);
        }
      }

      // Check cache
      const cached = await checkSemanticCache(message);
      if (cached) {
         finalAnswer = cached;
         res.write(`data: ${JSON.stringify({ type: 'token', content: finalAnswer })}\n\n`);
      } else {
         let contextChunksText = "";
         let chunksUsed = [];
         let confidence = 0.9;
         let rewritten = message;
         
         if (['knowledge_search', 'general_question'].includes(intent)) {
            rewritten = await rewriteQuery(message, history);
            const chunks = await searchKnowledge(rewritten);
            chunksUsed = chunks;
            
            if (chunks.length > 0) {
               confidence = chunks[0].similarity;
            }
            contextChunksText = chunks.map(c => c.content).join('\n\n');
         }

         const systemPrompt = `You are DOLPHI AI...\n\nRETRIEVED KNOWLEDGE (confidence: ${confidence}):\n${contextChunksText}\n\nINSTRUCTIONS:\nAnswer based on the retrieved knowledge. Priority Order:\n1. Uploaded Files\n2. Retrieved Knowledge\n3. Conversation Memory\n4. Model Knowledge\nIf retrieval fails or confidence < 0.3, continue answering using general model knowledge, clearly distinguishing it.`;

         const aiSdk = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
         const responseStream = await aiSdk.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: systemPrompt + "\\n\\nUser: " + message
         });

         for await (const chunk of responseStream) {
            const text = chunk.text;
            finalAnswer += text;
            res.write(`data: ${JSON.stringify({ type: 'token', content: text })}\n\n`);
         }

         res.write(`data: ${JSON.stringify({ type: 'meta', confidence, sources: chunksUsed.slice(0, 3).map(c => c.sourceFile) })}\n\n`);

         // Save to query cache implicitly
         await db.insert(queryCache).values({
            queryText: message,
            answer: finalAnswer,
         });

         // Log analytics
         await db.insert(retrievalLogs).values({
            conversationId: convId,
            query: message,
            rewrittenQuery: rewritten,
            confidence: confidence,
            responseTimeMs: Date.now() - startTime,
            chunksUsed: JSON.stringify(chunksUsed)
         });
      }

      const [asstMsg] = await db.insert(messages).values({
        conversationId: convId,
        role: "assistant",
        content: finalAnswer
      }).returning();

      res.write(`data: ${JSON.stringify({ type: 'done', message_id: asstMsg.id })}\n\n`);
    } catch (error: any) {
      console.warn("Chat stream error:", error.message || error);
      res.write(`data: ${JSON.stringify({ type: 'token', content: "\\n[Connection lost, or API rate limit exceeded. Please try again.]" })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', message_id: null })}\n\n`);
    }
    
    res.end();
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
