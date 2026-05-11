const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY

function requireKey() {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing VITE_OPENAI_API_KEY. Copy .env.example to .env and set your key.')
  }
}

async function openaiFetch(path, options) {
  requireKey()
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      ...(options?.headers || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI error ${res.status}: ${text || res.statusText}`)
  }

  return res
}

// NOTE: Prototype only. In production, never call OpenAI directly from browser.

function safeParseJsonArray(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []

  const first = raw.indexOf('[')
  const last = raw.lastIndexOf(']')
  if (first === -1 || last === -1 || last <= first) return []

  const slice = raw.slice(first, last + 1)
  try {
    const parsed = JSON.parse(slice)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function extractQuestions(transcript) {
  const trimmed = (transcript || '').trim()
  if (!trimmed) return []

  const system =
    "Extract questions from transcript. Return ONLY JSON array of {question, about}. question MUST be verbatim substring from transcript (even if no '?' punctuation). about MUST be verbatim substring from transcript (<=8 words) describing what the question refers to; if unsure use ''. Exclude ONLY: 'good morning', 'how are you', 'can you hear me'. Return [] if none."

  const res = await openaiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Transcript:\n${trimmed}` },
      ],
    }),
  })

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  const arr = safeParseJsonArray(content)

  return arr
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      question: String(x.question || '').trim(),
      about: String(x.about || '').trim(),
    }))
    .filter((x) => x.question.length > 0)
}

