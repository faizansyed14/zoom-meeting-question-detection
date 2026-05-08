import React, { useEffect, useMemo, useRef, useState } from 'react'
import StartScreen from './components/StartScreen.jsx'
import StatusBar from './components/StatusBar.jsx'
import TranscriptPanel from './components/TranscriptPanel.jsx'
import QuestionFeed from './components/QuestionFeed.jsx'
import { useTabCapture } from './hooks/useTabCapture.js'
import { useRealtimeWS } from './hooks/useRealtimeWS.js'
import { extractQuestions } from './utils/openai.js'

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
          <button className="btnGhost" onClick={onClose} type="button">
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
  const [status, setStatus] = useState('idle') // idle | connecting | live | stopped
  const [questions, setQuestions] = useState([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [fullTranscript, setFullTranscript] = useState('')
  const [interimText, setInterimText] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isTranscriptCollapsed, setIsTranscriptCollapsed] = useState(false)
  const [showHowTo, setShowHowTo] = useState(false)
  const [localError, setLocalError] = useState('')
  const [lastAnalysisAt, setLastAnalysisAt] = useState('')
  const [lastAnalysisError, setLastAnalysisError] = useState('')

  const audioCbRef = useRef(null)
  const { startCapture, stopCapture, isCapturing, error: captureError } = useTabCapture({
    onAudioChunk: (b64) => audioCbRef.current?.(b64),
  })

  const { connect, sendAudio, disconnect, isConnected } = useRealtimeWS({
    onTranscriptDelta: (delta) => {
      if (!delta) return
      const clean = sanitizeEnglishUi(delta)
      if (!clean) return
      setInterimText((t) => appendSmooth(t, clean).slice(-5000))
      wordCountRef.current += clean.trim() ? clean.trim().split(/\s+/).length : 0
      setWordCount(wordCountRef.current)
    },
    onTranscriptCompleted: (t) => {
      const sentence = sanitizeEnglishUi(t)
      if (!sentence) return
      setFullTranscript((prev) => (prev ? `${prev}\n${sentence}` : sentence))
      fullTranscriptRef.current = fullTranscriptRef.current ? `${fullTranscriptRef.current}\n${sentence}` : sentence
      setInterimText('')
      sentencesSinceAnalysisRef.current += 1

      // Immediate UI: heuristic question detector (fast, no API).
      if (looksLikeQuestionSentence(sentence) && !isAudioCheckFormalities(sentence)) {
        // Skip heuristic when sentence looks like multiple merged questions.
        const tooLong = sentence.length > 160
        const multi = /\bwhether\b/i.test(sentence) || (sentence.match(/\bor\b/gi) || []).length >= 2
        if (tooLong && multi) return

        const canon = canonicalizeQuestionText(sentence)
        const key = normalizeQuestion(canon.short)
        if (key && !questionKeysRef.current.has(key)) {
          questionKeysRef.current.add(key)
          setQuestions((prev) => [
            {
              id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
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

      const urgent = looksLikeQuestionSentence(sentence)
      if (urgent) urgentAnalyzeRef.current = true
      scheduleAnalyze({ urgent })
    },
    onError: (msg) => setLocalError(msg || 'Realtime error'),
  })

  const fullTranscriptRef = useRef('')
  const questionKeysRef = useRef(new Set())
  const timerRef = useRef(null)
  const analyzeTimerRef = useRef(null)
  const sentencesSinceAnalysisRef = useRef(0)
  const lastAnalyzeAtRef = useRef(0)
  const urgentAnalyzeRef = useRef(false)
  const isStoppingRef = useRef(false)
  const wordCountRef = useRef(0)
  const [wordCount, setWordCount] = useState(0)

  const combinedError = useMemo(() => localError || captureError, [captureError, localError])

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
        disconnect()
      } catch {}
      try {
        stopCapture()
      } catch {}
    }
  }, [disconnect, stopCapture])

  const scheduleAnalyze = ({ urgent } = {}) => {
    if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current)
    analyzeTimerRef.current = setTimeout(() => {
      analyzeTimerRef.current = null
      analyzeForQuestions().catch(() => {})
    }, 3000)
  }

  async function analyzeForQuestions() {
    if (isStoppingRef.current) return
    if (isAnalyzing) return
    const now = Date.now()
    // Cost guard: never more than once per 3s.
    if (now - lastAnalyzeAtRef.current < 3000) return
    const urgent = urgentAnalyzeRef.current
    // Always allow after 1 completed sentence; urgent just uses shorter debounce.
    if (!urgent && sentencesSinceAnalysisRef.current < 1) return
    if (urgent && sentencesSinceAnalysisRef.current < 1) return
    lastAnalyzeAtRef.current = now
    urgentAnalyzeRef.current = false

    setIsAnalyzing(true)
    try {
      setLastAnalysisError('')
      const t = fullTranscriptRef.current
      const recent = t.slice(-2000)
      const found = await extractQuestions(recent)
      if (found?.length) {
        setQuestions((prev) => {
          const next = [...prev]
          for (const item of found) {
            const canon = canonicalizeQuestionText(item.question)
            const key = normalizeQuestion(canon.short)
            if (!key) continue

            if (questionKeysRef.current.has(key)) {
              // Merge upgrade: replace existing heuristic entry with richer GPT type/context.
              const idx = next.findIndex((q) => normalizeQuestion(q.question) === key)
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
          questionKeysRef.current = new Set(pruned.map((q) => normalizeQuestion(q.question)).filter(Boolean))
          return pruned
        })
      }
      sentencesSinceAnalysisRef.current = 0
      setLastAnalysisAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch (e) {
      const msg = e?.message || 'Question extraction failed.'
      setLocalError(msg)
      setLastAnalysisError(msg)
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleStart() {
    setLocalError('')
    setQuestions([])
    setFullTranscript('')
    setInterimText('')
    setElapsedSeconds(0)
    fullTranscriptRef.current = ''
    questionKeysRef.current = new Set()
    setIsAnalyzing(false)
    setWordCount(0)
    wordCountRef.current = 0
    sentencesSinceAnalysisRef.current = 0
      setLastAnalysisAt('')
      setLastAnalysisError('')
    isStoppingRef.current = false

    try {
      setStatus('connecting')
      await startCapture()
      connect()
      audioCbRef.current = (b64) => sendAudio(b64)
      setStatus('live')
    } catch (e) {
      setLocalError(e?.message || 'Failed to start.')
      stopCapture()
      disconnect()
      setStatus('idle')
    }
  }

  function handleStop() {
    isStoppingRef.current = true
    if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current)
    analyzeTimerRef.current = null
    stopCapture()
    disconnect()
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

  if (status === 'idle') {
    return (
      <div className="appShell">
        {showHowTo ? <HowToModal onClose={() => setShowHowTo(false)} /> : null}
        <StartScreen onStart={handleStart} error={combinedError} onShowHowTo={() => setShowHowTo(true)} />
      </div>
    )
  }

  if (status === 'stopped') {
    return (
      <div className="appShell">
        <StatusBar
        isLive={false}
          elapsedSeconds={elapsedSeconds}
          questionCount={questions.length}
          isAnalyzing={false}
          wordCount={wordCount}
        />
        <div className="main">
          <div className="grid">
            <div className="panel">
              <div className="panelHeader">
                <div className="panelTitle">Transcript</div>
              </div>
              <div className="panelBody">
                <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                  {fullTranscript || '(empty)'}
                </div>
              </div>
            </div>

          <QuestionFeed
            questions={questions}
            isLoading={false}
            lastAnalysisAt={lastAnalysisAt}
            lastAnalysisError={lastAnalysisError}
          />
          </div>

          <div className="btnRow">
            <button className="btnGhost" type="button" onClick={() => setShowHowTo(true)}>
              How to use
            </button>
            <button className="btnPrimary" type="button" onClick={handleExport} disabled={questions.length === 0}>
              Export
            </button>
            <button className="btnPrimary" type="button" onClick={handleNewSession}>
              Start New Session
            </button>
          </div>

          {combinedError ? <div className="errorText">{combinedError}</div> : null}
        </div>
        {showHowTo ? <HowToModal onClose={() => setShowHowTo(false)} /> : null}
      </div>
    )
  }

  return (
    <div className="appShell">
      <StatusBar
        isLive={status === 'live' && isCapturing && isConnected}
        elapsedSeconds={elapsedSeconds}
        questionCount={questions.length}
        isAnalyzing={isAnalyzing}
        wordCount={wordCount}
      />

      <div className="main">
        <div className="grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <div className="panelHeader">
                <div className="panelTitle">Controls</div>
              </div>
              <div className="panelBody">
                <div className="muted">
                  Tip: in share dialog, pick Zoom tab and enable <span className="kbd">Share tab audio</span>.
                </div>
                <div className="btnRow" style={{ justifyContent: 'flex-start' }}>
                  <button className="btnDanger" onClick={handleStop} type="button">
                    Stop
                  </button>
                  <button className="btnGhost" onClick={() => setShowHowTo(true)} type="button">
                    How to use
                  </button>
                  <button className="btnGhost" onClick={() => setIsTranscriptCollapsed((v) => !v)} type="button">
                    {isTranscriptCollapsed ? 'Show transcript' : 'Hide transcript'}
                  </button>
                </div>
                {combinedError ? <div className="errorText">{combinedError}</div> : null}
              </div>
            </div>

            <TranscriptPanel
              transcript={fullTranscript}
              interimText={interimText}
              isCollapsed={isTranscriptCollapsed}
              onToggle={() => setIsTranscriptCollapsed((v) => !v)}
            />
          </div>

          <QuestionFeed
            questions={questions}
            isLoading={isAnalyzing || questions.length === 0}
            lastAnalysisAt={lastAnalysisAt}
            lastAnalysisError={lastAnalysisError}
          />
        </div>
      </div>

      {showHowTo ? <HowToModal onClose={() => setShowHowTo(false)} /> : null}
    </div>
  )
}

