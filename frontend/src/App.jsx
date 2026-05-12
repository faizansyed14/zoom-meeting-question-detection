import React, { useEffect, useMemo, useRef, useState } from 'react'
import StartScreen from './components/StartScreen.jsx'
import StatusBar from './components/StatusBar.jsx'
import QuestionFeed from './components/QuestionFeed.jsx'
import QuestionCard from './components/QuestionCard.jsx'
import { useRealtimeWS } from './hooks/useRealtimeWS.js'
import { extractQuestions } from './utils/openai.js'
import { useAudioCapture } from './hooks/useAudioCapture.js'
import { motion } from 'framer-motion'
import LoginScreen from './components/LoginScreen.jsx'

function nowStamp() {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function normalizeQuestion(q) {
  let s = (q || '').toLowerCase().trim()
  // join spaced acronyms: "l lm" -> "llm", "g c p" -> "gcp"
  s = s.replace(/\b([a-z])\s+([a-z])\b/g, '$1$2')
  s = s.replace(/\b([a-z])\s+([a-z])\s+([a-z])\b/g, '$1$2$3')
  // run again to catch longer splits after first pass
  s = s.replace(/\b([a-z])\s+([a-z])\b/g, '$1$2')
  s = s.replace(/\b([a-z])\s+([a-z])\s+([a-z])\b/g, '$1$2$3')
  // remove any leftover punctuation/symbols
  s = s.replace(/[^a-z0-9\s]/g, '')
  s = s.replace(/\s+/g, ' ')
  return s
}

function looksLikeQuestionSentence(sentence) {
  const s = (sentence || '').trim()
  if (!s) return false
  if (s.includes('?')) return true
  // Transcripts often omit punctuation; use simple leading-verb heuristic.
  if (s.split(/\s+/).filter(Boolean).length < 3) return false
  return /^(what|why|how|when|where|who|whom|whose|can|could|would|should|do|does|did|is|are|am|will|may|might)\b/i.test(
    s,
  )
}

function sanitizeEnglishUi(text) {
  // UI-only filter: keep Latin letters/digits/common punctuation/spaces.
  // Removes other scripts so transcript display stays "English-only".
  const raw = String(text || '')
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    const code = raw.charCodeAt(i)
    const isBasicLatin = code >= 0x20 && code <= 0x7e
    if (isBasicLatin) out += ch
    else if (ch === '\n' || ch === '\t') out += ' '
    // else drop
  }
  return out.replace(/\s+/g, ' ').trim()
}

function appendSmooth(prev, next) {
  const a = (prev || '').trimEnd()
  const b = (next || '').trimStart()
  if (!b) return a
  if (!a) return b
  const needsSpace = !/[ \n\t]/.test(a[a.length - 1]) && !/^[ \n\t]/.test(b[0])
  return (a + (needsSpace ? ' ' : '') + b).replace(/\s+/g, ' ')
}

function isAudioCheckFormalities(sentence) {
  const s = (sentence || '').toLowerCase()
  // Explicitly ignore meeting formalities / audio checks.
  return (
    s.includes('good morning') ||
    s.includes('how are you') ||
    s.includes('can you hear me')
  )
}

function canonicalizeQuestionText(raw) {
  const text = sanitizeEnglishUi(raw)
  if (!text) return { short: '', full: '' }

  // Prefer last question-like sentence if model included context.
  const parts = text.split(/(?<=[.?!])\s+/g)
  const last = [...parts]
    .reverse()
    .map((p) => p.trim())
    .find((p) => looksLikeQuestionSentence(p))

  const picked = (last || text).trim()
  const withMark = picked.endsWith('?') ? picked : looksLikeQuestionSentence(picked) ? `${picked}?` : picked
  const MAX = 140
  const short = withMark.length > MAX ? withMark.slice(0, MAX - 1).trimEnd() + '…' : withMark
  return { short, full: text }
}

function extractLastQuestionFragment(liveText) {
  const t = String(liveText || '')
  const idx = t.lastIndexOf('?')
  if (idx === -1) return ''
  const left = t.slice(0, idx + 1)
  const start = Math.max(left.lastIndexOf('\n'), left.lastIndexOf('.'), left.lastIndexOf('!'))
  const frag = left.slice(start + 1).trim()
  return frag
}

function questionKey(source, canon) {
  const full = canon?.full || canon?.short || ''
  return normalizeQuestion(`${source}:${full}`)
}

function pruneRedundantQuestions(items) {
  const qs = [...items]
  // Prefer non-'other' and shorter questions.
  qs.sort((a, b) => {
    const ta = a.type === 'other' ? 1 : 0
    const tb = b.type === 'other' ? 1 : 0
    if (ta !== tb) return ta - tb
    return (a.question || '').length - (b.question || '').length
  })

  const keep = []
  for (const q of qs) {
    const qNorm = normalizeQuestion(q.question)
    if (!qNorm) continue
    const redundant = keep.some((k) => {
      const kNorm = normalizeQuestion(k.question)
      if (!kNorm) return false
      // If this question is basically a superset / contains another question, drop it.
      return qNorm.includes(kNorm) && qNorm !== kNorm
    })
    if (!redundant) keep.push(q)
  }

  // Restore newest-first ordering by detectedAtMs.
  keep.sort((a, b) => (b.detectedAtMs || 0) - (a.detectedAtMs || 0))
  return keep
}

function pickSupportedMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
  for (const c of candidates) {
    if (window.MediaRecorder?.isTypeSupported?.(c)) return c
  }
  return ''
}

function downloadTxt(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function HowToModal({ onClose }) {
  return (
    <div className="modalOverlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitle">How to use</div>
          <button className="btn-export modal-close" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="modalBody">
          <div>
            1. Join your Zoom meeting in another tab.
            <br />
            2. Click <span className="kbd">Start Listening</span> here.
            <br />
            3. In the share dialog, pick the Zoom tab and enable <span className="kbd">Share tab audio</span>.
          </div>
          <div style={{ marginTop: 10 }}>
            App streams 24kHz PCM audio to your local backend, which relays to OpenAI Realtime transcription.
          </div>
          <div style={{ marginTop: 10 }}>
            Limitation: tab audio capture best in Chrome/Edge. If you don’t see audio track, re-share and tick “Share tab
            audio”.
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [authedEmail, setAuthedEmail] = useState('')
  const [authedRole, setAuthedRole] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  const [status, setStatus] = useState('idle') // idle | connecting | live | stopped
  const [allQuestions, setAllQuestions] = useState([])
  const [approvedQuestions, setApprovedQuestions] = useState([])
  const [autoShareAll, setAutoShareAll] = useState(false)
  const [answeredQuestions, setAnsweredQuestions] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [fullTranscript, setFullTranscript] = useState({ participants: '', host: '' })
  const [interimText, setInterimText] = useState({ participants: '', host: '' })
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [showHowTo, setShowHowTo] = useState(false)
  const [localError, setLocalError] = useState('')
  const [lastAnalysisAt, setLastAnalysisAt] = useState('')
  const [lastAnalysisError, setLastAnalysisError] = useState('')
  const [captureSources, setCaptureSources] = useState({ participants: true, host: true })

  const participantsAudioCbRef = useRef(null)
  const hostAudioCbRef = useRef(null)
  const interimRef = useRef({ participants: '', host: '' })

  const participantsCapture = useAudioCapture({
    onAudioChunk: (b64) => participantsAudioCbRef.current?.(b64),
  })
  const hostCapture = useAudioCapture({
    onAudioChunk: (b64) => hostAudioCbRef.current?.(b64),
  })

  const participantsWS = useRealtimeWS({
    path: '/transcribe?source=participants',
    onTranscriptDelta: (delta) => {
      if (!delta) return
      const clean = sanitizeEnglishUi(delta)
      if (!clean) return
      interimRef.current.participants = appendSmooth(interimRef.current.participants, clean).slice(-5000)
      setInterimText((t) => ({ ...t, participants: interimRef.current.participants }))
      wordCountRef.current += clean.trim() ? clean.trim().split(/\s+/).length : 0
      setWordCount(wordCountRef.current)
    },
    onTranscriptCompleted: (t) => handleTranscriptCompleted('participants', t),
    onError: (msg) => setLocalError(msg || 'Realtime error'),
  })

  const hostWS = useRealtimeWS({
    path: '/transcribe?source=host',
    onTranscriptDelta: (delta) => {
      if (!delta) return
      const clean = sanitizeEnglishUi(delta)
      if (!clean) return
      interimRef.current.host = appendSmooth(interimRef.current.host, clean).slice(-5000)
      setInterimText((t) => ({ ...t, host: interimRef.current.host }))
      wordCountRef.current += clean.trim() ? clean.trim().split(/\s+/).length : 0
      setWordCount(wordCountRef.current)
    },
    onTranscriptCompleted: (t) => handleTranscriptCompleted('host', t),
    onError: (msg) => setLocalError(msg || 'Realtime error'),
  })

  const watchWS = useRealtimeWS({
    path: '/watch',
    onMessage: (msg) => {
      if (!msg) return
      if (msg.type === 'state.snapshot') {
        setFullTranscript({
          participants: String(msg?.transcript?.participants || ''),
          host: String(msg?.transcript?.host || ''),
        })
        setInterimText({ participants: '', host: '' })
        const incoming = Array.isArray(msg?.questions) ? msg.questions : []
        setApprovedQuestions(
          incoming.filter((q) => !answeredKeysRef.current.has(normalizeQuestion(`${q?.source || 'participants'}:${q?.question || ''}`))),
        )
        return
      }
      if (msg.type === 'questions.update') {
        const incoming = Array.isArray(msg?.questions) ? msg.questions : []
        setApprovedQuestions(
          incoming.filter((q) => !answeredKeysRef.current.has(normalizeQuestion(`${q?.source || 'participants'}:${q?.question || ''}`))),
        )
        return
      }
      if (msg.type === 'transcript.completed') {
        const source = msg.source === 'host' ? 'host' : 'participants'
        const sentence = sanitizeEnglishUi(msg.transcript || '')
        if (!sentence) return
        setFullTranscript((prev) => ({
          ...prev,
          [source]: prev[source] ? `${prev[source]}\n${sentence}` : sentence,
        }))
        setInterimText((prev) => ({ ...prev, [source]: '' }))
        return
      }
      if (msg.type === 'transcript.delta') {
        const source = msg.source === 'host' ? 'host' : 'participants'
        const clean = sanitizeEnglishUi(msg.delta || '')
        if (!clean) return
        setInterimText((t) => ({ ...t, [source]: appendSmooth(t[source], clean).slice(-5000) }))
      }
    },
    onError: (msg) => setLocalError(msg || 'Watch WS error'),
  })

  function handleTranscriptCompleted(source, t) {
    const sentence = sanitizeEnglishUi(t)
    if (!sentence) return

    setFullTranscript((prev) => ({
      ...prev,
      [source]: prev[source] ? `${prev[source]}\n${sentence}` : sentence,
    }))

    fullTranscriptRef.current[source] = fullTranscriptRef.current[source]
      ? `${fullTranscriptRef.current[source]}\n${sentence}`
      : sentence

    setInterimText((prev) => ({ ...prev, [source]: '' }))
    interimRef.current[source] = ''

    // Hybrid: instant add on question-like completed sentence + LLM backfill scan
    if (!isAudioCheckFormalities(sentence) && looksLikeQuestionSentence(sentence)) {
      const canon = canonicalizeQuestionText(sentence)
      const key = questionKey(source, canon)
      if (key && !questionKeysRef.current.has(key)) {
        questionKeysRef.current.add(key)
        setAllQuestions((prev) => [
          {
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            source,
            question: canon.short,
            rawQuestion: canon.full,
            about: '',
            detectedAtMs: Date.now(),
            timestamp: nowStamp(),
          },
          ...prev,
        ])
      }
    }

    if (isAudioCheckFormalities(sentence)) return
    // Use rolling window so long/continuous speech still extracts questions.
    const next = `${lastCompletedRef.current[source]}\n${sentence}`.trim()
    lastCompletedRef.current[source] = next.slice(-3500)
    queueLLMExtract(source, lastCompletedRef.current[source])
  }

  const llmInFlightRef = useRef({ participants: false, host: false })
  const llmPendingRef = useRef({ participants: null, host: null })
  const llmLastAtRef = useRef({ participants: 0, host: 0 })
  const lastCompletedRef = useRef({ participants: '', host: '' })

  function queueLLMExtract(source, sentence) {
    llmPendingRef.current[source] = sentence
    if (llmInFlightRef.current[source]) return
    runLLMExtractLoop(source).catch(() => {})
  }

  async function runLLMExtractLoop(source) {
    llmInFlightRef.current[source] = true
    try {
      while (llmPendingRef.current[source]) {
        const sentence = llmPendingRef.current[source]
        llmPendingRef.current[source] = null

        const now = Date.now()
        const wait = 350 - (now - llmLastAtRef.current[source])
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        llmLastAtRef.current[source] = Date.now()

        setIsAnalyzing(true)
        setLastAnalysisError('')
        const found = await extractQuestions(sentence)

        if (found?.length) {
          setAllQuestions((prev) => {
            const next = [...prev]
            for (const item of found) {
              const canon = canonicalizeQuestionText(item.question)
              const key = questionKey(source, canon)
              if (!key) continue
              if (questionKeysRef.current.has(key)) {
                const idx = next.findIndex((q) => normalizeQuestion(`${q.source}:${q.rawQuestion || q.question}`) === key)
                if (idx !== -1) {
                  next[idx] = {
                    ...next[idx],
                    question: canon.short || next[idx].question,
                    rawQuestion: canon.full || next[idx].rawQuestion,
                    about: item.about || next[idx].about || '',
                  }
                }
                continue
              }
              questionKeysRef.current.add(key)
              next.push({
                id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                source,
                question: canon.short,
                rawQuestion: canon.full,
                about: item.about || '',
                detectedAtMs: Date.now(),
                timestamp: nowStamp(),
              })
            }
            return pruneRedundantQuestions(next)
          })
        }

        setLastAnalysisAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      }
    } catch (e) {
      const msg = e?.message || 'Question extraction failed.'
      setLocalError(msg)
      setLastAnalysisError(msg)
    } finally {
      llmInFlightRef.current[source] = false
      setIsAnalyzing(false)
    }
  }

  const fullTranscriptRef = useRef({ participants: '', host: '' })
  const questionKeysRef = useRef(new Set())
  const timerRef = useRef(null)
  const analyzeTimerRef = useRef({ participants: null, host: null })
  const sentencesSinceAnalysisRef = useRef({ participants: 0, host: 0 })
  const lastAnalyzeAtRef = useRef({ participants: 0, host: 0 })
  const lastInstantAtRef = useRef({ participants: 0, host: 0 })
  const urgentAnalyzeRef = useRef({ participants: false, host: false })
  const isStoppingRef = useRef(false)
  const wordCountRef = useRef(0)
  const [wordCount, setWordCount] = useState(0)

  const combinedError = useMemo(() => {
    return localError || participantsCapture.error || hostCapture.error || ''
  }, [hostCapture.error, localError, participantsCapture.error])

  useEffect(() => {
    if (status !== 'live') return
    const tick = () => {
      for (const source of ['participants', 'host']) {
        const live = interimRef.current[source] || ''
        if (live.trim().length < 80) continue
        const combined = `${lastCompletedRef.current[source]}\n${live}`.trim().slice(-3500)
        queueLLMExtract(source, combined)
      }
    }
    const id = setInterval(tick, 700)
    return () => clearInterval(id)
  }, [status])

  const newestAll = useMemo(() => {
    return [...(allQuestions || [])].sort((a, b) => (b.detectedAtMs || 0) - (a.detectedAtMs || 0))
  }, [allQuestions])

  const newestApproved = useMemo(() => {
    return [...(approvedQuestions || [])].sort((a, b) => (b.detectedAtMs || 0) - (a.detectedAtMs || 0))
  }, [approvedQuestions])

  const newestAnswered = useMemo(() => {
    return [...(answeredQuestions || [])].sort((a, b) => (b.answeredAtMs || 0) - (a.answeredAtMs || 0))
  }, [answeredQuestions])

  const answeredKeysRef = useRef(new Set())

  function markAnswered(q) {
    if (!q?.question) return
    const key = normalizeQuestion(`${q.source || 'participants'}:${q.rawQuestion || q.question}`)
    answeredKeysRef.current.add(key)
    setApprovedQuestions((prev) =>
      prev.filter((x) => normalizeQuestion(`${x.source || 'participants'}:${x.rawQuestion || x.question || ''}`) !== key),
    )
    setAnsweredQuestions((prev) => {
      const exists = prev.some(
        (x) => normalizeQuestion(`${x.source || 'participants'}:${x.rawQuestion || x.question || ''}`) === key,
      )
      if (exists) return prev
      return [{ ...q, answeredAtMs: Date.now() }, ...prev]
    })
  }

  function approveQuestion(q) {
    if (!q?.question) return
    const key = normalizeQuestion(`${q.source || 'participants'}:${q.rawQuestion || q.question}`)
    setApprovedQuestions((prev) => {
      const exists = prev.some(
        (x) => normalizeQuestion(`${x.source || 'participants'}:${x.rawQuestion || x.question || ''}`) === key,
      )
      if (exists) return prev
      return pruneRedundantQuestions([{ ...q }, ...prev])
    })
  }

  useEffect(() => {
    const k = 'zqt_auto_share_all'
    const v = localStorage.getItem(k)
    if (v === '1') setAutoShareAll(true)
  }, [])

  useEffect(() => {
    const k = 'zqt_auto_share_all'
    localStorage.setItem(k, autoShareAll ? '1' : '0')
  }, [autoShareAll])

  useEffect(() => {
    if (!autoShareAll) return
    if (!newestAll.length) return
    // Auto-approve anything new
    for (const q of newestAll) approveQuestion(q)
  }, [autoShareAll, newestAll])

  function removeApproved(q) {
    if (!q) return
    const key = normalizeQuestion(`${q.source || 'participants'}:${q.rawQuestion || q.question || ''}`)
    setApprovedQuestions((prev) =>
      prev.filter((x) => normalizeQuestion(`${x.source || 'participants'}:${x.rawQuestion || x.question || ''}`) !== key),
    )
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/auth/me', { credentials: 'include' })
        if (!res.ok) throw new Error('unauthorized')
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        setAuthedEmail(String(data?.email || ''))
        setAuthedRole(String(data?.role || ''))
        setAuthError('')
      } catch {
        if (cancelled) return
        setAuthedEmail('')
        setAuthedRole('')
      } finally {
        if (cancelled) return
        setAuthChecked(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogin({ email, password, mode }) {
    setAuthBusy(true)
    setAuthError('')
    try {
      const endpoint = mode === 'viewer' ? '/auth/login-viewer' : '/auth/login-admin'
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const msg =
          data?.error === 'too_many_requests'
            ? 'Too many attempts. Wait a bit.'
            : data?.error === 'invalid_credentials'
              ? 'Invalid email or password.'
              : 'Login failed.'
        throw new Error(msg)
      }
      const me = await fetch('/auth/me', { credentials: 'include' })
      const data = await me.json().catch(() => ({}))
      setAuthedEmail(String(data?.email || email || ''))
      setAuthedRole(String(data?.role || ''))
      setAuthError('')
    } catch (e) {
      setAuthedEmail('')
      setAuthedRole('')
      setAuthError(e?.message || 'Login failed.')
    } finally {
      setAuthBusy(false)
      setAuthChecked(true)
    }
  }

  async function handleLogout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {}
    setAuthedEmail('')
    setAuthedRole('')
    setAuthError('')
    setStatus('idle')
  }

  useEffect(() => {
    const k = 'zqt_seen_howto'
    const seen = localStorage.getItem(k)
    if (!seen) {
      setShowHowTo(true)
      localStorage.setItem(k, '1')
    }
  }, [])

  useEffect(() => {
    if (status !== 'live') return
    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000)
      setElapsedSeconds(elapsed)
    }, 250)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [status])

  useEffect(() => {
    return () => {
      try {
        participantsWS.disconnect()
        hostWS.disconnect()
        watchWS.disconnect()
      } catch {}
      try {
        participantsCapture.stop()
        hostCapture.stop()
      } catch {}
    }
  }, [])

  const scheduleAnalyze = ({ urgent, source } = {}) => {
    const src = source || 'participants'
    if (analyzeTimerRef.current[src]) clearTimeout(analyzeTimerRef.current[src])
    analyzeTimerRef.current[src] = setTimeout(() => {
      analyzeTimerRef.current[src] = null
      analyzeForQuestions(src).catch(() => {})
    }, urgent ? 120 : 350)
  }

  async function analyzeForQuestions(source) {
    if (isStoppingRef.current) return
    if (isAnalyzing) return
    const now = Date.now()
    // Cost guard: per-source, faster but bounded.
    if (now - lastAnalyzeAtRef.current[source] < 250) return
    const urgent = urgentAnalyzeRef.current[source]
    // Always allow after 1 completed sentence; urgent just uses shorter debounce.
    if (!urgent && sentencesSinceAnalysisRef.current[source] < 1) return
    if (urgent && sentencesSinceAnalysisRef.current[source] < 1) return
    lastAnalyzeAtRef.current[source] = now
    urgentAnalyzeRef.current[source] = false

    setIsAnalyzing(true)
    try {
      setLastAnalysisError('')
      const t = fullTranscriptRef.current[source] || ''
      const recent = t.slice(-2000)
      const found = await extractQuestions(recent)
      if (found?.length) {
        setAllQuestions((prev) => {
          const next = [...prev]
          for (const item of found) {
            const canon = canonicalizeQuestionText(item.question)
            const key = questionKey(source, canon)
            if (!key) continue

            if (questionKeysRef.current.has(key)) {
              // Merge upgrade: replace existing heuristic entry with richer LLM about field.
              const idx = next.findIndex((q) => normalizeQuestion(`${q.source}:${q.rawQuestion || q.question}`) === key)
              if (idx !== -1) {
                next[idx] = {
                  ...next[idx],
                  question: canon.short || next[idx].question,
                  rawQuestion: canon.full || next[idx].rawQuestion,
                  about: item.about || next[idx].about || '',
                }
              }
              continue
            }

            questionKeysRef.current.add(key)
            next.push({
              id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
              source,
              question: canon.short,
              rawQuestion: canon.full,
              about: item.about || '',
              detectedAtMs: Date.now(),
              timestamp: nowStamp(),
            })
          }
          const pruned = pruneRedundantQuestions(next)
          // Rebuild dedupe set from pruned list.
          questionKeysRef.current = new Set(
            pruned.map((q) => normalizeQuestion(`${q.source}:${q.rawQuestion || q.question}`)).filter(Boolean),
          )
          return pruned
        })
      }
      sentencesSinceAnalysisRef.current[source] = 0
      setLastAnalysisAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch (e) {
      const msg = e?.message || 'Question extraction failed.'
      setLocalError(msg)
      setLastAnalysisError(msg)
    } finally {
      setIsAnalyzing(false)
    }
  }

  useEffect(() => {
    if (!authedRole || authedRole !== 'admin') return
    // Keep viewers in sync with admin-visible questions.
    const t = setTimeout(() => {
      fetch('/sync/questions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: approvedQuestions }),
      }).catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [approvedQuestions, authedRole])

  async function handleStart() {
    setLocalError('')
    setAllQuestions([])
    setApprovedQuestions([])
    setFullTranscript({ participants: '', host: '' })
    setInterimText({ participants: '', host: '' })
    setElapsedSeconds(0)
    fullTranscriptRef.current = { participants: '', host: '' }
    questionKeysRef.current = new Set()
    lastCompletedRef.current = { participants: '', host: '' }
    setIsAnalyzing(false)
    setWordCount(0)
    wordCountRef.current = 0
    sentencesSinceAnalysisRef.current = { participants: 0, host: 0 }
      setLastAnalysisAt('')
      setLastAnalysisError('')
    isStoppingRef.current = false

    try {
      setStatus('connecting')
      if (captureSources.participants) {
        if (!participantsCapture.isCapturing) await participantsCapture.start({ source: 'tab' })
        participantsWS.connect()
        participantsAudioCbRef.current = (b64) => participantsWS.sendAudio(b64)
      } else {
        participantsCapture.stop()
        participantsWS.disconnect()
      }

      if (captureSources.host) {
        if (!hostCapture.isCapturing) await hostCapture.start({ source: 'mic' })
        hostWS.connect()
        hostAudioCbRef.current = (b64) => hostWS.sendAudio(b64)
      } else {
        hostCapture.stop()
        hostWS.disconnect()
      }

      setStatus('live')
    } catch (e) {
      setLocalError(e?.message || 'Failed to start.')
      participantsCapture.stop()
      hostCapture.stop()
      participantsWS.disconnect()
      hostWS.disconnect()
      setStatus('idle')
    }
  }

  // StartScreen button now calls handleStart directly.

  function handleStop() {
    isStoppingRef.current = true
    if (analyzeTimerRef.current.participants) clearTimeout(analyzeTimerRef.current.participants)
    if (analyzeTimerRef.current.host) clearTimeout(analyzeTimerRef.current.host)
    analyzeTimerRef.current = { participants: null, host: null }
    participantsCapture.stop()
    hostCapture.stop()
    participantsWS.disconnect()
    hostWS.disconnect()
    setStatus('stopped')
  }

  function handleExport() {
    const lines = []
    lines.push(`Meeting Question Tracker export (${new Date().toLocaleString()})`)
    lines.push('')
    for (const [i, q] of approvedQuestions.entries()) {
      const src = q.source === 'host' ? 'Host' : 'Participants'
      lines.push(`${i + 1}. [${src}] ${q.question}`)
      if (q.about) lines.push(`   About: ${q.about}`)
      if (q.timestamp) lines.push(`   Detected: ${q.timestamp}`)
      lines.push('')
    }
    downloadTxt('meeting-questions.txt', lines.join('\n'))
  }

  function handleNewSession() {
    setLocalError('')
    setPhase('idle')
  }

  const capturingOk =
    status === 'live' &&
    ((captureSources.participants && participantsCapture.isCapturing && participantsWS.isConnected) ||
      (captureSources.host && hostCapture.isCapturing && hostWS.isConnected))
  const isCapturing = participantsCapture.isCapturing || hostCapture.isCapturing
  const canStart = captureSources.participants || captureSources.host

  if (!authChecked) {
    return <LoginScreen onLogin={handleLogin} error={''} busy={true} defaultEmail="" />
  }

  if (!authedEmail) {
    return <LoginScreen onLogin={handleLogin} error={authError} busy={authBusy} defaultEmail="" />
  }

  if (authedRole && authedRole !== 'admin') {
    if (!watchWS.isConnected) watchWS.connect()
    return (
      <div className="app-wrapper">
        <StatusBar isCapturing={false} status={'live'} elapsedSeconds={elapsedSeconds} isAnalyzing={false} />

        <div className="controls-bar">
          <div className="controls-header">
            <span className="app-name">Question Tracker</span>
            <span className="app-tag">VIEW ONLY</span>
          </div>
          <div className="controls-buttons">
            <div className="controls-actions">
              <motion.button className="btn-export" onClick={handleLogout} whileTap={{ scale: 0.96 }}>
                Logout
              </motion.button>
            </div>
          </div>
        </div>

        {combinedError ? <div className="error-toast">{combinedError}</div> : null}

        <div className="main-content" style={{ flexDirection: 'column' }}>
          <div className="feed-panel">
            <div className="feed-header">
              <span className="label">Questions</span>
              {newestApproved.length > 0 ? <span className="feed-count">{newestApproved.length}</span> : null}
            </div>

            <div className="feed-list">
              {newestApproved.length === 0 ? (
                <div className="feed-empty">
                  <p className="feed-empty-title">No questions</p>
                  <p className="feed-empty-sub">Waiting for admin to share questions</p>
                </div>
              ) : null}

              {newestApproved.map((q, i) => (
                <div key={q.id} style={{ position: 'relative' }}>
                  <QuestionCard question={q} index={newestApproved.length - i} />
                  <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
                    <motion.button
                      className="btn-export"
                      style={{ padding: '8px 10px' }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => markAnswered(q)}
                      type="button"
                    >
                      Answered
                    </motion.button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="feed-panel">
            <div className="feed-header">
              <span className="label">Answered questions</span>
              {newestAnswered.length > 0 ? <span className="feed-count">{newestAnswered.length}</span> : null}
            </div>

            <div className="feed-list">
              {newestAnswered.length === 0 ? (
                <div className="feed-empty">
                  <p className="feed-empty-title">None answered yet</p>
                  <p className="feed-empty-sub">Click Accepted to move a question here</p>
                </div>
              ) : null}

              {newestAnswered.map((q, i) => (
                <div key={`${q.id}_ans`} style={{ position: 'relative', opacity: 0.55 }}>
                  <QuestionCard question={q} index={newestAnswered.length - i} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'idle') {
    return (
      <div className="app-wrapper">
        {showHowTo ? <HowToModal onClose={() => setShowHowTo(false)} /> : null}
        <StartScreen
          captureSources={captureSources}
          setCaptureSources={setCaptureSources}
          onStart={handleStart}
          onLogout={handleLogout}
          error={combinedError}
          disabled={false}
        />
      </div>
    )
  }

  return (
    <div className="app-wrapper">
      <StatusBar
        isCapturing={capturingOk}
        status={status}
        elapsedSeconds={elapsedSeconds}
        isAnalyzing={isAnalyzing}
      />

      <div className="controls-bar">
        <div className="controls-header">
          <span className="app-name">Question Tracker</span>
          <span className="app-tag">ZOOM MEETING LISTENER</span>
        </div>
        <div className="controls-buttons">
          <div className="controls-actions">
            <motion.button className="btn-stop" onClick={handleStop} disabled={!isCapturing} whileTap={{ scale: 0.96 }}>
              <span>■</span> Stop
            </motion.button>
            <motion.button className="btn-export" onClick={handleExport} disabled={approvedQuestions.length === 0} whileTap={{ scale: 0.96 }}>
              <span>↓</span> Export
            </motion.button>
            <motion.button className="btn-export" onClick={handleLogout} whileTap={{ scale: 0.96 }}>
              Logout
            </motion.button>
          </div>
          <div className="controls-actions" style={{ marginTop: 10 }}>
            <div className="setup-toggle-row" style={{ width: '100%' }}>
              <div className="setup-toggle-left">
                <div className="setup-toggle-name">Auto-share all</div>
                <div className="setup-toggle-help">Automatically send all detected questions to viewer</div>
              </div>
              <button
                type="button"
                className={`pill-toggle ${autoShareAll ? 'on' : 'off'}`}
                onClick={() => setAutoShareAll((v) => !v)}
                aria-pressed={autoShareAll}
              >
                <span className="pill-knob" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {combinedError ? <div className="error-toast">{combinedError}</div> : null}

      <div className="main-content">
        <div className="feed-panel">
          <div className="feed-header">
            <span className="label">All Questions (auto-detected)</span>
            {newestAll.length > 0 ? <span className="feed-count">{newestAll.length}</span> : null}
          </div>

          <div className="feed-list">
            {newestAll.length === 0 ? (
              <div className="feed-empty">
                <p className="feed-empty-title">Waiting for questions</p>
                <p className="feed-empty-sub">Detected questions appear here instantly</p>
              </div>
            ) : null}

            {newestAll.map((q, i) => {
              const key = normalizeQuestion(`${q.source || 'participants'}:${q.question || ''}`)
              const isApproved = newestApproved.some(
                (a) => normalizeQuestion(`${a.source || 'participants'}:${a.question || ''}`) === key,
              )

              return (
                <div key={q.id} style={{ position: 'relative' }}>
                  <QuestionCard question={q} index={newestAll.length - i} />
                  <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
                    <motion.button
                      className="btn-export"
                      style={{ padding: '8px 10px' }}
                      whileTap={{ scale: 0.96 }}
                      disabled={isApproved}
                      onClick={() => approveQuestion(q)}
                      type="button"
                    >
                      ✓
                    </motion.button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="feed-panel">
          <div className="feed-header">
            <span className="label">Viewer Questions (approved)</span>
            {newestApproved.length > 0 ? <span className="feed-count">{newestApproved.length}</span> : null}
          </div>

          <div className="feed-list">
            {newestApproved.length === 0 ? (
              <div className="feed-empty">
                <p className="feed-empty-title">Nothing shared yet</p>
                <p className="feed-empty-sub">Click ✓ on a question to show it to the viewer</p>
              </div>
            ) : null}

            {newestApproved.map((q, i) => (
              <div key={q.id} style={{ position: 'relative' }}>
                <QuestionCard question={q} index={newestApproved.length - i} />
                <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
                  <motion.button
                    className="btn-stop"
                    style={{ padding: '8px 10px' }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => removeApproved(q)}
                    type="button"
                  >
                    ✕
                  </motion.button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showHowTo ? <HowToModal onClose={() => setShowHowTo(false)} /> : null}
    </div>
  )
}

