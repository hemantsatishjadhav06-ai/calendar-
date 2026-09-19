import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, generateText, streamText, embed } from 'ai';
import { z } from 'zod';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';

const openai = env.OPENAI_API_KEY ? createOpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
const anthropic = env.ANTHROPIC_API_KEY ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export const aiAvailable = () => !!(openai || anthropic);

/** Provider-agnostic model picker (Buffer made theirs LLM-agnostic in 2026; we start that way). */
export function model(tier: 'fast' | 'quality' | 'vision') {
  const useAnthropic = env.AI_PROVIDER === 'anthropic' ? anthropic : null;
  if (useAnthropic) return useAnthropic(tier === 'fast' ? 'claude-3-5-haiku-latest' : 'claude-sonnet-4-5');
  if (!openai) throw new Error('No AI provider configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY)');
  return openai(tier === 'fast' ? 'gpt-4.1-mini' : tier === 'vision' ? 'gpt-4.1' : 'gpt-4.1');
}

// Rough per-1k-token prices (USD) for cost accounting; override via env later if needed
const PRICE: Record<string, [number, number]> = { 'gpt-4.1-mini': [0.0004, 0.0016], 'gpt-4.1': [0.002, 0.008], 'claude-3-5-haiku-latest': [0.0008, 0.004], 'claude-sonnet-4-5': [0.003, 0.015], 'text-embedding-3-small': [0.00002, 0] };
export async function recordUsage(o: { organizationId: string; accountId: string; feature: string; model: string; promptTokens: number; completionTokens: number }) {
  const [pin, pout] = PRICE[o.model] ?? [0.001, 0.003];
  await prismaAdmin.aiUsage.create({ data: { ...o, costUsd: (o.promptTokens / 1000) * pin + (o.completionTokens / 1000) * pout } }).catch(() => undefined);
}

export type AiAction = 'generate' | 'rephrase' | 'shorten' | 'expand' | 'casual' | 'formal' | 'repurpose' | 'summarize' | 'ideas' | 'alt_text' | 'hashtags' | 'translate';

const SYSTEM = `You are a social media copywriter inside a scheduling tool. Write in the user's language. Respect the target network's conventions and hard limits. Never add hashtags unless asked. Avoid clichés like "game-changer" and "unlock". Do not use em dashes. Output only the post text — no preamble, no quotes, no explanations.`;

export interface AssistantInput { action: AiAction; input: string; network?: string; maxChars?: number; brandVoice?: string; count?: number; organizationId: string; accountId: string; imageUrl?: string; targetLanguage?: string }

function prompt(a: AssistantInput) {
  const limits = a.network ? `Target network: ${a.network}.${a.maxChars ? ` Hard limit ${a.maxChars} characters.` : ''}` : '';
  const P: Record<AiAction, string> = {
    generate: `Write a social post about: ${a.input}. ${limits}`,
    rephrase: `Rephrase, keeping the meaning and roughly the same length:\n${a.input}`,
    shorten: `Shorten to fit ${a.maxChars ?? 280} characters, keep the key message:\n${a.input}`,
    expand: `Expand with one concrete detail or example${a.maxChars ? ` (stay under ${a.maxChars} characters)` : ''}:\n${a.input}`,
    casual: `Rewrite in a more casual, friendly tone:\n${a.input}`,
    formal: `Rewrite in a more professional tone:\n${a.input}`,
    repurpose: `Rewrite this post for ${a.network}${a.maxChars ? ` (max ${a.maxChars} characters)` : ''}, adapting format and tone:\n${a.input}`,
    summarize: `Summarize this long-form content into a single engaging social post${a.maxChars ? ` (max ${a.maxChars} characters)` : ''}:\n${a.input}`,
    ideas: `Give ${a.count ?? 5} distinct social post ideas for this business and audience. One idea per line, no numbering, no bullets:\n${a.input}`,
    alt_text: `Write concise alt text (max 125 characters) describing this image for screen-reader users. Do not start with "Image of" or "Picture of".`,
    hashtags: `Suggest up to 8 relevant, non-spammy hashtags for this post. Output them space-separated, nothing else:\n${a.input}`,
    translate: `Translate to ${a.targetLanguage ?? 'English'}, keeping tone, hashtags and mentions:\n${a.input}`,
  };
  return P[a.action];
}

/** Streaming assistant (composer side panel). Returns the ai-sdk stream result. */
export function runAssistant(a: AssistantInput) {
  if (a.input.length > 8000) throw new Error('Prompt too long');
  const tier = a.action === 'generate' || a.action === 'ideas' || a.action === 'summarize' ? 'quality' : a.action === 'alt_text' ? 'vision' : 'fast';
  const m = model(tier);
  const messages: any[] = a.action === 'alt_text' && a.imageUrl ? [{ role: 'user', content: [{ type: 'text', text: prompt(a) }, { type: 'image', image: new URL(a.imageUrl) }] }] : [{ role: 'user', content: prompt(a) }];
  return streamText({ model: m, system: SYSTEM + (a.brandVoice ? `\nBrand voice: ${a.brandVoice}` : ''), messages, temperature: a.action === 'shorten' || a.action === 'translate' ? 0.2 : 0.8, maxTokens: 700,
    onFinish: ({ usage }) => recordUsage({ organizationId: a.organizationId, accountId: a.accountId, feature: `assistant.${a.action}`, model: (m as any).modelId ?? 'unknown', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }) });
}

// ---- Community
const TriageSchema = z.object({ labels: z.array(z.enum(['question', 'complaint', 'purchase_intent', 'praise', 'spam', 'support_request', 'negative', 'urgent'])), sentiment: z.number().min(-1).max(1), triage: z.enum(['needs_review', 'simple_reply']), language: z.string() });
export type Triage = z.infer<typeof TriageSchema>;

export async function triageComment(c: { text: string; postText?: string; network: string; brandContext?: string; keywords?: string[] }): Promise<Triage> {
  const fallback: Triage = { labels: [], sentiment: 0, triage: 'simple_reply', language: 'und' };
  if (!c.text.trim() || !aiAvailable()) return fallback;
  const { object } = await generateObject({ model: model('fast'), schema: TriageSchema, temperature: 0,
    system: 'You classify social media comments for a brand community inbox. Be conservative with "spam". Use "needs_review" for complaints, factual questions, purchase intent and anything a human should see first.',
    prompt: `Network: ${c.network}\nBrand context: ${c.brandContext ?? 'n/a'}\nOriginal post: ${c.postText?.slice(0, 500) ?? 'n/a'}\nComment: ${c.text.slice(0, 1000)}` });
  // Deterministic keyword rules layered on top of the model
  const kw = (c.keywords ?? []).filter(k => c.text.toLowerCase().includes(k.toLowerCase()));
  if (kw.length && !object.labels.includes('purchase_intent')) object.labels.push('purchase_intent');
  return object;
}

export async function suggestReply(c: { text: string; postText?: string; network: string; toneExamples: string[]; savedReplies: { title: string; body: string }[]; organizationId: string; accountId: string }) {
  const m = model('fast');
  const { text, usage } = await generateText({ model: m, temperature: 0.7, maxTokens: 220,
    system: `You draft short, warm replies to social media comments on behalf of a brand. Match the brand's tone shown in the examples. Never invent facts, prices, dates or promises; if the comment asks something you cannot know, acknowledge it and offer to follow up. Output only the reply text. Max 2 sentences unless the network is LinkedIn.`,
    prompt: `Network: ${c.network}\nBrand tone examples:\n${c.toneExamples.slice(0, 8).map(t => '- ' + t).join('\n') || '- (none)'}\nRelevant saved replies:\n${c.savedReplies.slice(0, 3).map(s => `- ${s.title}: ${s.body}`).join('\n') || '- (none)'}\nPost: ${c.postText ?? ''}\nComment: ${c.text}` });
  await recordUsage({ organizationId: c.organizationId, accountId: c.accountId, feature: 'community.suggest_reply', model: (m as any).modelId ?? 'unknown', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
  return text.trim();
}

export async function embedText(text: string): Promise<number[]> {
  if (!openai) throw new Error('Embeddings require OPENAI_API_KEY');
  const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: text });
  return embedding;
}

/** Insights "Takeaways": deterministic detectors, phrased by the model (numbers never invented). */
export async function takeaways(facts: { label: string; detail: string }[], organizationId: string, accountId: string): Promise<string[]> {
  if (!facts.length) return [];
  if (!aiAvailable()) return facts.map(f => `${f.label}: ${f.detail}`);
  const m = model('fast');
  const { text, usage } = await generateText({ model: m, temperature: 0.3, maxTokens: 400, system: 'Turn each fact into one friendly, actionable sentence for a social media manager. Keep every number exactly as given. One sentence per line, no bullets.', prompt: facts.map(f => `${f.label}: ${f.detail}`).join('\n') });
  await recordUsage({ organizationId, accountId, feature: 'insights.takeaways', model: (m as any).modelId ?? 'unknown', promptTokens: usage.promptTokens, completionTokens: usage.completionTokens });
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}
