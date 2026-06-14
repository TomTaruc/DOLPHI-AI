import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import { Anthropic } from '@anthropic-ai/sdk';

export interface GenerateOptions {
    model?: string;
    contents: any;
    config?: any;
}

export const FALLBACK_ORDER = [
    process.env.PRIMARY_PROVIDER || 'gemini',
    process.env.FALLBACK_PROVIDER_1 || 'openai',
    process.env.FALLBACK_PROVIDER_2 || 'claude',
    process.env.EMERGENCY_PROVIDER || 'gemini15'
].filter(Boolean);

export interface AIProvider {
    generateContent(options: GenerateOptions): Promise<{ text: string | undefined }>;
    generateContentStream(options: GenerateOptions, signal?: AbortSignal): Promise<AsyncGenerator<{ text: string | undefined }>>;
    getProviderName(): string;
}

function parseContentsForNonGemini(contents: any[]) {
    let systemInstruction = '';
    const messages = [];
    
    if (typeof contents === 'string') {
        return { systemInstruction, messages: [{ role: 'user', content: contents }] };
    }

    for (const c of contents) {
        if (!c.role) continue;
        
        let contentStr = '';
        if (Array.isArray(c.parts)) {
            for (const p of c.parts) {
                if (p.text) contentStr += p.text + '\n';
                if (p.inlineData) {
                    contentStr += `\n[Image omitted in fallback]\n`;
                }
            }
        } else if (typeof c.parts === 'string') {
            contentStr = c.parts;
        }
        
        // Anthropic and OpenAI use 'assistant', not 'model'
        let role = (c.role === 'model' || c.role === 'assistant') ? 'assistant' as const : 'user' as const;
        
        // Anthropic requires alternating roles. If there are consecutive, we should merge them, but for now we push
        messages.push({ role, content: contentStr.trim() });
    }
    
    // Merge consecutive messages of the same role (required by Anthropic)
    const mergedMessages = [];
    for (const m of messages) {
        if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === m.role) {
            mergedMessages[mergedMessages.length - 1].content += `\n\n${m.content}`;
        } else {
            mergedMessages.push(m);
        }
    }
    
    // Anthropic and OpenAI must start with user message typically if assistant is used, but anthropic explicitly complains if not
    if (mergedMessages.length > 0 && mergedMessages[0].role !== 'user') {
       mergedMessages.unshift({ role: 'user', content: '(System constraint: start conversation)' });
    }

    return { systemInstruction, messages: mergedMessages };
}

export class GeminiProvider implements AIProvider {
    private ai: any;
    private name: string;
    private model: string;
    
    constructor(name: string, model: string) {
        this.name = name;
        this.model = model;
        this.ai = new GoogleGenAI({ 
            apiKey: process.env.GEMINI_API_KEY || 'dummy_key',
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });
    }

    getProviderName() { return this.name; }

    async generateContent(options: GenerateOptions) {
        const response = await this.ai.models.generateContent({
            model: this.model, // fallback the model to the provider's specific model
            contents: options.contents,
            config: options.config
        });
        return { text: response.text };
    }

    async generateContentStream(options: GenerateOptions, signal?: AbortSignal) {
        return await this.ai.models.generateContentStream({
            model: this.model,
            contents: options.contents,
            config: options.config
        });
    }
}

export class OpenAIProvider implements AIProvider {
    private openai: any;
    
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
    }
    
    getProviderName() { return 'openai'; }
    
    async generateContent(options: GenerateOptions) {
        const { systemInstruction, messages } = parseContentsForNonGemini(options.contents);
        
        const finalMessages = [];
        let sys = options.config?.systemInstruction || systemInstruction || '';
        if (typeof sys !== 'string' && sys.parts) {
            sys = sys.parts.map((p: any) => p.text).join('\n');
        }
        if (sys) {
             finalMessages.push({ role: 'system', content: sys });
        }
        
        finalMessages.push(...messages);
        
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: finalMessages,
            temperature: options.config?.temperature ?? 0.7,
            max_tokens: options.config?.maxOutputTokens ?? 1000
        });
        
        return { text: response.choices[0].message.content };
    }
    
    async generateContentStream(options: GenerateOptions, signal?: AbortSignal) {
        const { systemInstruction, messages } = parseContentsForNonGemini(options.contents);
        
        const finalMessages = [];
        let sys = options.config?.systemInstruction || systemInstruction || '';
        if (typeof sys !== 'string' && sys.parts) {
            sys = sys.parts.map((p: any) => p.text).join('\n');
        }
        if (sys) {
             finalMessages.push({ role: 'system', content: sys });
        }
        finalMessages.push(...messages);
        
        const stream = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: finalMessages,
            temperature: options.config?.temperature ?? 0.7,
            max_tokens: options.config?.maxOutputTokens ?? 1000,
            stream: true
        });
        
        async function* generator() {
            for await (const chunk of stream) {
                if (signal?.aborted) break;
                const text = chunk.choices[0]?.delta?.content || "";
                if (text) yield { text };
            }
        }
        return generator();
    }
}

export class ClaudeProvider implements AIProvider {
    private anthropic: any;
    constructor() {
        this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' });
    }
    
    getProviderName() { return 'claude'; }
    
    async generateContent(options: GenerateOptions) {
        const { systemInstruction, messages } = parseContentsForNonGemini(options.contents);
        
        let sys = options.config?.systemInstruction || systemInstruction || '';
        if (typeof sys !== 'string' && sys.parts) {
            sys = sys.parts.map((p: any) => p.text).join('\n');
        }
        
        const response = await this.anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            system: sys,
            messages: messages,
            max_tokens: options.config?.maxOutputTokens ?? 1000
        });
        
        return { text: response.content[0].text };
    }
    
    async generateContentStream(options: GenerateOptions, signal?: AbortSignal) {
        const { systemInstruction, messages } = parseContentsForNonGemini(options.contents);
        
        let sys = options.config?.systemInstruction || systemInstruction || '';
        if (typeof sys !== 'string' && sys.parts) {
            sys = sys.parts.map((p: any) => p.text).join('\n');
        }
        
        const stream = await this.anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            system: sys,
            messages: messages,
            max_tokens: options.config?.maxOutputTokens ?? 1000,
            stream: true
        });
        
        async function* generator() {
            for await (const chunk of stream) {
                if (signal?.aborted) break;
                if (chunk.type === 'content_block_delta' && chunk.delta && (chunk.delta as any).text) {
                    yield { text: (chunk.delta as any).text };
                }
            }
        }
        return generator();
    }
}

const providersCache: Record<string, AIProvider> = {
    'gemini': new GeminiProvider('gemini', 'gemini-flash-lite-latest'),
    'gemini15': new GeminiProvider('gemini15', 'gemini-flash-lite-latest'),
};

if (process.env.OPENAI_API_KEY) {
    providersCache['openai'] = new OpenAIProvider();
} else {
    // If test relies on openai being present but key isn't provided, use dummy.
    providersCache['openai'] = new OpenAIProvider();
}

if (process.env.ANTHROPIC_API_KEY) {
    providersCache['claude'] = new ClaudeProvider();
} else {
    providersCache['claude'] = new ClaudeProvider();
}

const providers = FALLBACK_ORDER.map(name => providersCache[name]).filter(Boolean);

function isFatalError(error: any) {
    const status = error.status;
    if (status === 400 || status === 401 || status === 403) {
        // Only treat auth failures as fatal if we actually had a key (otherwise it's just a dummy key failure, which means we should fallback)
        if (status === 401 && error.message?.includes('invalid x-api-key') && !process.env.ANTHROPIC_API_KEY) return false;
        if (status === 401 && !process.env.OPENAI_API_KEY) return false;
        return true;
    }
    if (status === 'INVALID_ARGUMENT' || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
        if (status === 'UNAUTHENTICATED' && !process.env.GEMINI_API_KEY) return false;
        return true;
    }
    return false;
}

export class AIService {
    static async generateContent(options: GenerateOptions): Promise<{ text: string | undefined }> {
        let lastError: any;
        let rateLimitError: any;
        for (const provider of providers) {
            try {
                console.log(`[AI SERVICE] Attempting generation with provider: ${provider.getProviderName()}`);
                const result = await provider.generateContent(options);
                return result;
            } catch (error: any) {
                console.info(`[AI SERVICE] Provider ${provider.getProviderName()} failed:`, error.message);
                lastError = error;
                if (error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) {
                    rateLimitError = error;
                }
                if (isFatalError(error)) {
                    throw error;
                }
            }
        }
        throw rateLimitError || lastError || new Error("I'm unable to process your request at this time. All providers failed.");
    }

    static async generateContentStream(options: GenerateOptions, signal?: AbortSignal): Promise<AsyncGenerator<{ text: string | undefined }>> {
        let lastError: any;
        let rateLimitError: any;
        for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            let yieldedAnything = false;
            try {
                console.log(`[AI SERVICE] Attempting stream with provider: ${provider.getProviderName()}`);
                const stream = await provider.generateContentStream(options, signal);
                // Return an async generator wrapping this stream so we can intercept errors that happen while yielding
                async function* wrapper() {
                    for await (const chunk of stream) {
                        if (signal?.aborted) break;
                        yield chunk;
                        yieldedAnything = true;
                    }
                }
                // We're returning the wrapper; if it hasn't failed the initial await above, we assume success. 
                // Wait, if it fails *during* iteration, the error bubbles up to the caller (server.ts), breaking the stream.
                // Re-running a fallback mid-stream is usually not feasible for server-sent events anyway, so this is fine.
                return wrapper();
            } catch (error: any) {
                console.info(`[AI SERVICE] Provider stream ${provider.getProviderName()} failed:`, error.message);
                lastError = error;
                if (error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) {
                    rateLimitError = error;
                }
                if (isFatalError(error)) {
                    throw error; 
                }
            }
        }
        throw rateLimitError || lastError || new Error("I'm unable to process your request at this time. All providers failed.");
    }
}
