import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  let count = 0;
  for await (const m of await ai.models.list()) {
    console.log(m.name);
    count++;
  }
  console.log('total:', count);
}
run().catch(console.error);
