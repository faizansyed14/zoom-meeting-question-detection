import React, { useEffect, useMemo, useRef, useState } from 'react'
import StartScreen from './components/StartScreen.jsx'
import StatusBar from './components/StatusBar.jsx'
import TranscriptPanel from './components/TranscriptPanel.jsx'
import QuestionFeed from './components/QuestionFeed.jsx'
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
  return (q || '')
    .toLowerCase()
    .trim()
    .replace(/[?!.,"'`’“”]/g, '')
    .replace(/\s+/g, ' ')
}

function looksLikeQuestionSentence(sentence) {
  const s = (sentence || '').trim()
  if (!s) return false
  if (s.includes('?')) return true
  // Transcripts often omit punctuation; use simple leading-verb heuristic.
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
    s.includes('can you hear me') ||
    s.includes('can everyone hear me') ||
    s.includes('are you able to hear me') ||
    s.includes('can you hear us') ||
    s.includes('can you see my screen') ||
    s.includes('are you on mute') ||
    s.includes('you are on mute') ||
    s.includes('unmute') ||
    s.includes('mute') ||
    s.includes('audio check') ||
    s.includes('mic') ||
    s.includes('microphone')
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
  const [questions, setQuestions] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [fullTranscript, setFullTranscript] = useState({ participants: '', host: '' })
  const [interimText, setInterimText] = useState({ participants: '', host: '' })
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isTranscriptCollapsed, setIsTranscriptCollapsed] = useState(false)
  const [showHowTo, setShowHowTo] = useState(false)
  const [localError, setLocalError] = useState('')
  const [lastAnalysisAt, setLastAnalysisAt] = useState('')
  const [lastAnalysisError, setLastAnalysisError] = useState('')
  const [captureSources, setCaptureSources] = useState({ participants: true, host: true })

  const participantsAudioCbRef = useRef(null)
  const hostAudioCbRef = useRef(null)

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
      setInterimText((t) => ({ ...t, participants: appendSmooth(t.participants, clean).slice(-5000) }))
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
      setInterimText((t) => ({ ...t, host: appendSmooth(t.host, clean).slice(-5000) }))
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
        setQuestions(Array.isArray(msg?.questions) ? msg.questions : [])
        return
      }
      if (msg.type === 'questions.update') {
        setQuestions(Array.isArray(msg?.questions) ? msg.questions : [])
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

    sentencesSinceAnalysisRef.current[source] += 1

    if (looksLikeQuestionSentence(sentence) && !isAudioCheckFormalities(sentence)) {
      const tooLong = sentence.length > 160
      const multi = /\bwhether\b/i.test(sentence) || (sentence.match(/\bor\b/gi) || []).length >= 2
      if (!(tooLong && multi)) {
        const canon = canonicalizeQuestionText(sentence)
        const key = normalizeQuestion(`${source}:${canon.short}`)
        if (key && !questionKeysRef.current.has(key)) {
          questionKeysRef.current.add(key)
          setQuestions((prev) => [
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
              source,
              question: canon.short,
              rawQuestion: canon.full,
              context: '',
              type: 'other',
              detectedAtMs: Date.now(),
              timestamp: nowStamp(),
            },
            ...prev,
          ])
        }
      }
    }

    const urgent = looksLikeQuestionSentence(sentence)
    if (urgent) urgentAnalyzeRef.current[source] = true
    scheduleAnalyze({ urgent, source })
  }

  const fullTranscriptRef = useRef({ participants: '', host: '' })
  const questionKeysRef = useRef(new Set())
  const timerRef = useRef(null)
  const analyzeTimerRef = useRef({ participants: null, host: null })
  const sentencesSinceAnalysisRef = useRef({ participants: 0, host: 0 })
  const lastAnalyzeAtRef = useRef({ participants: 0, host: 0 })
  const urgentAnalyzeRef = useRef({ participants: false, host: false })
  const isStoppingRef = useRef(false)
  const wordCountRef = useRef(0)
  const [wordCount, setWordCount] = useState(0)

  const combinedError = useMemo(() => {
    return localError || participantsCapture.error || hostCapture.error || ''
  }, [hostCapture.error, localError, participantsCapture.error])

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

  async function handleLogin({ email, password }) {
    setAuthBusy(true)
    setAuthError('')
    try {
      const res = await fetch('/auth/login', {
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
    }, urgent ? 600 : 900)
  }

  async function analyzeForQuestions(source) {
    if (isStoppingRef.current) return
    if (isAnalyzing) return
    const now = Date.now()
    // Cost guard: per-source, faster but bounded.
    if (now - lastAnalyzeAtRef.current[source] < 1200) return
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
        setQuestions((prev) => {
          const next = [...prev]
          for (const item of found) {
            const canon = canonicalizeQuestionText(item.question)
            const key = normalizeQuestion(`${source}:${canon.short}`)
            if (!key) continue

            if (questionKeysRef.current.has(key)) {
              // Merge upgrade: replace existing heuristic entry with richer GPT type/context.
              const idx = next.findIndex((q) => normalizeQuestion(`${q.source}:${q.question}`) === key)
              if (idx !== -1) {
                next[idx] = {
                  ...next[idx],
                  question: canon.short || next[idx].question,
                  rawQuestion: canon.full || next[idx].rawQuestion,
                  context: item.context || next[idx].context,
                  type: item.type || next[idx].type,
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
              context: item.context,
              type: item.type,
              detectedAtMs: Date.now(),
              timestamp: nowStamp(),
            })
          }
          const pruned = pruneRedundantQuestions(next)
          // Rebuild dedupe set from pruned list.
          questionKeysRef.current = new Set(
            pruned.map((q) => normalizeQuestion(`${q.source}:${q.question}`)).filter(Boolean),
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
        body: JSON.stringify({ questions }),
      }).catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [authedRole, questions])

  async function handleStart() {
    setLocalError('')
    setQuestions([])
    setFullTranscript({ participants: '', host: '' })
    setInterimText({ participants: '', host: '' })
    setElapsedSeconds(0)
    fullTranscriptRef.current = { participants: '', host: '' }
    questionKeysRef.current = new Set()
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
    for (const [i, q] of questions.entries()) {
      lines.push(`${i + 1}. [${q.type}] ${q.question}`)
      if (q.context) lines.push(`   Context: ${q.context}`)
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
    return <LoginScreen onLogin={handleLogin} error={''} busy={true} defaultEmail="zoomadmin@alpha.ae" />
  }

  if (!authedEmail) {
    return <LoginScreen onLogin={handleLogin} error={authError} busy={authBusy} defaultEmail="zoomadmin@alpha.ae" />
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

        <div className="main-content">
          <TranscriptPanel
            transcript={fullTranscript}
            interimText={interimText}
            isCollapsed={isTranscriptCollapsed}
            onToggle={() => setIsTranscriptCollapsed((v) => !v)}
          />

          <QuestionFeed questions={questions} isLoading={false} lastAnalysisAt={''} lastAnalysisError={''} />
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
            <motion.button
              className="btn-export"
              onClick={handleExport}
              disabled={questions.length === 0}
              whileTap={{ scale: 0.96 }}
            >
              <span>↓</span> Export
            </motion.button>
            <motion.button className="btn-export" onClick={handleLogout} whileTap={{ scale: 0.96 }}>
              Logout
            </motion.button>
          </div>
        </div>
      </div>

      {combinedError ? <div className="error-toast">{combinedError}</div> : null}

      <div className="main-content">
        <TranscriptPanel
          transcript={fullTranscript}
          interimText={interimText}
          isCollapsed={isTranscriptCollapsed}
          onToggle={() => setIsTranscriptCollapsed((v) => !v)}
        />

        <QuestionFeed
          questions={questions}
          isLoading={isAnalyzing || questions.length === 0}
          lastAnalysisAt={lastAnalysisAt}
          lastAnalysisError={lastAnalysisError}
        />
      </div>

      {showHowTo ? <HowToModal onClose={() => setShowHowTo(false)} /> : null}
    </div>
  )
}

