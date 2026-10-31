import { readFileSync } from 'node:fs';

export const knowledge = JSON.parse(readFileSync(new URL('./knowledge.json', import.meta.url), 'utf8'));
const instruction = readFileSync(new URL('./system-instruction.txt', import.meta.url), 'utf8');
const approved = new Map(knowledge.answers.map(item => [item.id, item]));
if (approved.size !== knowledge.answers.length || approved.size === 0) throw new Error('Approved answer IDs must be unique.');
for (const item of knowledge.answers) {
  if (!/^[a-z0-9-]+$/.test(item.id) || typeof item.answer !== 'string' || !item.answer.trim() || item.answer.length > 1500) {
    throw new Error('Invalid knowledge entry. Review IDs and answer lengths.');
  }
}

export class ChatError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const normalize = text => text.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

/** Strictly validate visitor input. No client-supplied roles or system prompts are accepted. */
export function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['message', 'history'].includes(key))) {
    throw new ChatError(400, 'invalid_input', 'Please send a question about Mthandeki.');
  }
  if (typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 600) {
    throw new ChatError(400, 'invalid_input', 'Please use a question between 1 and 600 characters.');
  }
  const history = payload.history ?? [];
  if (!Array.isArray(history) || history.length > 6 ||
      history.some(item => typeof item !== 'string' || item.length > 600)) {
    throw new ChatError(400, 'invalid_history', 'Please clear the chat and try again.');
  }
  return { message: payload.message.trim(), history: history.map(item => item.trim()) };
}

/** Exact saved-question matching is a preview, not an imitation of live AI. */
export function previewReply(message) {
  const query = normalize(message);
  if (['hi', 'hello', 'hey', 'good morning', 'good afternoon'].includes(query)) return { reply: knowledge.greeting, mode: 'preview' };
  if (['thanks', 'thank you', 'thank you very much'].includes(query)) return { reply: knowledge.thanks, mode: 'preview' };
  const entry = knowledge.answers.find(item => item.previewQuestions.some(question => normalize(question) === query));
  return { reply: entry?.answer ?? knowledge.previewFallback, mode: 'preview' };
}

/** Model output is never displayed. Only known IDs can select owner-approved text. */
export function renderDecision(decision) {
  const statuses = ['answer', 'unknown', 'out_of_scope', 'greeting', 'thanks'];
  if (!decision || typeof decision !== 'object' || Array.isArray(decision) ||
      Object.keys(decision).some(key => !['status', 'answerIds'].includes(key)) ||
      !statuses.includes(decision.status) || !Array.isArray(decision.answerIds) ||
      decision.answerIds.length > 3 || decision.answerIds.some(id => typeof id !== 'string' || !approved.has(id))) {
    throw new ChatError(502, 'invalid_model_response', 'The assistant could not read that reply. Please try again.');
  }
  if (decision.status !== 'answer' && decision.answerIds.length) {
    throw new ChatError(502, 'invalid_model_response', 'The assistant could not read that reply. Please try again.');
  }
  if (decision.status === 'answer') {
    if (!decision.answerIds.length) return knowledge.unknown;
    return [...new Set(decision.answerIds)].map(id => approved.get(id).answer).join('\n\n');
  }
  return { unknown: knowledge.unknown, out_of_scope: knowledge.outOfScope, greeting: knowledge.greeting, thanks: knowledge.thanks }[decision.status];
}

/** Dependency injection keeps tests entirely offline; production uses Node's built-in fetch. */
export async function answerQuestion(payload, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const { message, history } = validatePayload(payload);
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return previewReply(message);
  const model = (env.GEMINI_MODEL || 'gemini-3.5-flash-lite').trim();
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) {
    throw new ChatError(503, 'configuration_error', 'The assistant is not configured yet. Please use the contact details on this page.');
  }
  const request = {
    systemInstruction: {
      parts: [{ text: `${instruction}\n\nAPPROVED KNOWLEDGE (owner-managed):\n${JSON.stringify(knowledge.answers.map(({ id, topic, answer }) => ({ id, topic, answer })))}` }],
    },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ recentVisitorMessages: history, currentVisitorMessage: message }) }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          status: { type: 'STRING', enum: ['answer', 'unknown', 'out_of_scope', 'greeting', 'thanks'] },
          answerIds: { type: 'ARRAY', items: { type: 'STRING', enum: [...approved.keys()] }, maxItems: 3 },
        },
        required: ['status', 'answerIds'],
      },
    },
  };
  let response;
  let data;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) {
      if (response.status === 429) throw new ChatError(429, 'provider_limit', 'The assistant has reached its current limit. Please try again later or contact Mthandeki directly.');
      if ([400, 401, 403, 404].includes(response.status)) throw new ChatError(503, 'provider_configuration', 'The assistant is not available right now. Please use the contact details on this page.');
      throw new ChatError(502, 'provider_unavailable', 'The assistant is temporarily unavailable. Please try again shortly.');
    }
    data = await response.json();
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new ChatError(504, 'provider_timeout', 'The assistant took too long to respond. Please try again.');
    throw new ChatError(502, 'provider_unavailable', 'The assistant could not connect. Please try again shortly.');
  }
  const candidate = data.candidates?.[0];
  if (!candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
    // Safety blocks, incomplete output and missing candidates never expose raw provider text.
    return { reply: knowledge.outOfScope, mode: 'gemini' };
  }
  const raw = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
  let decision;
  try { decision = JSON.parse(raw); }
  catch { throw new ChatError(502, 'invalid_model_response', 'The assistant could not read that reply. Please try again.'); }
  return { reply: renderDecision(decision), mode: 'gemini' };
}
