import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

dotenv.config({ path: new URL('../.env', import.meta.url) })

import express from 'express'
import cors from 'cors'
import http from 'http'
import { WebSocketServer } from 'ws'
import session from 'express-session'
import rateLimit from 'express-rate-limit'
import { createOpenAIRelay } from './openaiRelay.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || process.env.AUTH_EMAIL || '').trim().toLowerCase()
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || process.env.AUTH_PASSWORD || '')
const VIEWER_EMAIL = String(process.env.VIEWER_EMAIL || '').trim().toLowerCase()
const VIEWER_PASSWORD = String(process.env.VIEWER_PASSWORD || '')
const SESSION_SECRET = String(process.env.SESSION_SECRET || '')

const app = express()
app.set('trust proxy', 1)
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
)
app.use(express.json({ limit: '32kb' }))

const sessionParser = session({
  secret: SESSION_SECRET || 'dev_only_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
})
app.use(sessionParser)

function requireAuth(req, res, next) {
  if (req.session?.user?.email) return next()
  res.status(401).json({ error: 'unauthorized' })
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next()
  res.status(403).json({ error: 'forbidden' })
}

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
  keyGenerator: (req) => {
    const ip = req.ip || 'ip'
    const email = String(req.body?.email || '').trim().toLowerCase()
    return `${ip}:${email || 'noemail'}`
  },
})

app.get('/auth/me', (req, res) => {
  if (req.session?.user?.email) {
    res.json({ ok: true, email: req.session.user.email, role: req.session.user.role || 'viewer' })
    return
  }
  res.status(401).json({ ok: false })
})

app.post('/auth/login', loginLimiter, (req, res) => {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase()
  const password = String(req.body?.password || '')

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    res.status(500).json({ error: 'auth_not_configured' })
    return
  }

  const isAdmin = email === ADMIN_EMAIL && password === ADMIN_PASSWORD
  const isViewer = VIEWER_EMAIL && VIEWER_PASSWORD && email === VIEWER_EMAIL && password === VIEWER_PASSWORD

  if (!isAdmin && !isViewer) {
    res.status(401).json({ error: 'invalid_credentials' })
    return
  }

  req.session.user = { email, role: isAdmin ? 'admin' : 'viewer' }
  res.json({ ok: true })
})

app.post('/auth/logout', (req, res) => {
  req.session?.destroy?.(() => {
    res.clearCookie('connect.sid')
    res.json({ ok: true })
  })
})

// Shared meeting state (in-memory)
const meetingState = {
  transcript: { participants: [], host: [] },
  questions: [],
  updatedAtMs: 0,
}

const watchers = new Set()

function broadcastToWatchers(watchers, payloadObj) {
  const msg = JSON.stringify(payloadObj)
  for (const ws of watchers) {
    try {
      if (ws.readyState === 1) ws.send(msg)
    } catch {}
  }
}

app.get('/sync/state', requireAuth, (req, res) => {
  res.json({
    transcript: {
      participants: meetingState.transcript.participants.join('\n'),
      host: meetingState.transcript.host.join('\n'),
    },
    questions: meetingState.questions,
    updatedAtMs: meetingState.updatedAtMs,
  })
})

app.post('/sync/questions', requireAuth, requireAdmin, (req, res) => {
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : null
  if (!questions) {
    res.status(400).json({ error: 'bad_request' })
    return
  }
  meetingState.questions = questions
  meetingState.updatedAtMs = Date.now()
  broadcastToWatchers(watchers, { type: 'questions.update', questions: meetingState.questions, updatedAtMs: meetingState.updatedAtMs })
  res.json({ ok: true })
})

// Render / load balancers: fast health (no auth)
app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ status: 'ok', ts: Date.now() })
})

app.head('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.status(200).end()
})

// Production: single server serves Vite build + API + WebSocket
const distDir = path.join(__dirname, '..', 'frontend', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/transcribe')) return next()
    if (req.path.startsWith('/auth')) return next()
    if (req.path.startsWith('/health')) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const isTranscribe = req.url?.startsWith('/transcribe')
  const isWatch = req.url?.startsWith('/watch')
  if (!isTranscribe && !isWatch) return

  sessionParser(req, {}, () => {
    if (!req.session?.user?.email) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    if (isTranscribe && req.session?.user?.role !== 'admin') {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })
})

wss.on('connection', (browserWs, _req) => {
  const url = _req?.url || ''
  const isWatch = url.startsWith('/watch')

  if (isWatch) {
    watchers.add(browserWs)
    // send initial snapshot
    try {
      browserWs.send(
        JSON.stringify({
          type: 'state.snapshot',
          transcript: {
            participants: meetingState.transcript.participants.join('\n'),
            host: meetingState.transcript.host.join('\n'),
          },
          questions: meetingState.questions,
          updatedAtMs: meetingState.updatedAtMs,
        }),
      )
    } catch {}

    browserWs.on('close', () => watchers.delete(browserWs))
    browserWs.on('error', () => watchers.delete(browserWs))
    return
  }

  let sourceFromReq = 'participants'
  try {
    const u = new URL(url, 'http://local')
    const s = u.searchParams.get('source')
    if (s === 'host') sourceFromReq = 'host'
    else if (s === 'participants') sourceFromReq = 'participants'
  } catch {}

  let relay
  try {
    relay = createOpenAIRelay(browserWs, {
      onOpenAIMessage: (msg) => {
        if (msg?.type === 'conversation.item.input_audio_transcription.completed' && typeof msg.transcript === 'string') {
          const source = sourceFromReq
          const line = msg.transcript.trim()
          if (line) meetingState.transcript[source].push(line)
          // keep bounded
          if (meetingState.transcript[source].length > 500) meetingState.transcript[source].shift()
          meetingState.updatedAtMs = Date.now()
          broadcastToWatchers(watchers, {
            type: 'transcript.completed',
            source,
            transcript: line,
            updatedAtMs: meetingState.updatedAtMs,
          })
          return
        }
        if (msg?.type === 'conversation.item.input_audio_transcription.delta' && typeof msg.delta === 'string') {
          broadcastToWatchers(watchers, { type: 'transcript.delta', source: sourceFromReq, delta: msg.delta })
        }
      },
      onOpenAIMessageRaw: (txt) => {
        // ignore
      },
    })
  } catch (e) {
    browserWs.send(
      JSON.stringify({
        type: 'error',
        error: { message: e?.message || 'Failed to start OpenAI relay' },
      }),
    )
    browserWs.close()
    return
  }

  browserWs.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      browserWs.send(JSON.stringify({ type: 'error', error: { message: 'Invalid JSON from browser' } }))
      return
    }

    if (msg?.type === 'audio' && typeof msg.data === 'string') {
      relay.send(msg.data)
      return
    }

    browserWs.send(JSON.stringify({ type: 'error', error: { message: 'Unknown message type' } }))
  })

  browserWs.on('close', () => {
    relay.close()
  })

  browserWs.on('error', () => {
    relay.close()
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ${PORT} (health: /health, ws: /transcribe)`)
  if (!fs.existsSync(distDir)) {
    console.warn('frontend/dist missing — run frontend build for production static files')
  }
})

