import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

dotenv.config({ path: new URL('../.env', import.meta.url) })

import express from 'express'
import cors from 'cors'
import http from 'http'
import { WebSocketServer } from 'ws'
import { createOpenAIRelay } from './openaiRelay.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3001)

const app = express()
app.set('trust proxy', 1)
app.use(cors())

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
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/transcribe' })

wss.on('connection', (browserWs) => {
  let relay
  try {
    relay = createOpenAIRelay(browserWs)
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

