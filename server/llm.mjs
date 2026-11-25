const env = (k, d = '') => process.env[k] || d;

export const llmEnabled = () => Boolean(env('LLM_API_KEY'));
export const sttEnabled = () => Boolean(env('STT_API_KEY') || (env('LLM_API_KEY') && /^https:\/\/api\.(openai|groq)\.com/.test(env('LLM_BASE_URL', 'https://api.openai.com/v1'))));

export async function chatJson(system, user, { timeoutMs = 12000 } = {}) {
  if (!llmEnabled()) return null;
  const base = env('LLM_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env('LLM_API_KEY') },
    body: JSON.stringify({
      model: env('LLM_MODEL', 'gpt-4o-mini'),
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('LLM ' + res.status);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || 'null');
}

export async function transcribe(wavBuffer) {
  if (!sttEnabled()) return null;
  const key = env('STT_API_KEY') || env('LLM_API_KEY');
  const base = (env('STT_BASE_URL') || env('LLM_BASE_URL', 'https://api.openai.com/v1')).replace(/\/$/, '');
  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', env('STT_MODEL', 'whisper-1'));
  form.append('language', 'en');
  const res = await fetch(base + '/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('STT ' + res.status);
  return String((await res.json()).text || '').trim();
}
