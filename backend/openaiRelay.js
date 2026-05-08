import WebSocket from 'ws'

function makeOpenAIWS() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in environment.')

  // Realtime transcription: use intent=transcription (no model query param).
  // Then configure via transcription_session.update.
  return new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  })
}

function sendJson(ws, obj) {
  ws.send(JSON.stringify(obj))
}

export function createOpenAIRelay(browserWs) {
  let openaiWs = null
  let closed = false
  let didReconnect = false
  let lastCloseWasClean = false

  const queue = []

  const forward = (msg) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(msg)
    }
  }

  const connect = () => {
    if (closed) return

    openaiWs = makeOpenAIWS()

    openaiWs.on('open', () => {
      // Transcription session config (Realtime API).
      sendJson(openaiWs, {
        type: 'transcription_session.update',
        session: {
          input_audio_format: 'pcm16',
          input_audio_transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
          turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 600,
            threshold: 0.5,
          },
        },
      })

      // Flush any queued audio.
      while (queue.length) {
        const audio = queue.shift()
        sendJson(openaiWs, { type: 'input_audio_buffer.append', audio })
      }
    })

    openaiWs.on('message', (data) => {
      const txt = data.toString()
      forward(txt)

      // If server indicates this connection is treated as a realtime (non-transcription) session,
      // fall back to session.update schema (observed in some environments).
      try {
        const msg = JSON.parse(txt)
        if (
          msg?.type === 'error' &&
          typeof msg?.error?.message === 'string' &&
          msg.error.message.includes('transcription session update event')
        ) {
          sendJson(openaiWs, {
            type: 'session.update',
            input_audio_format: 'pcm16',
            audio: {
              input: {
                transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
                turn_detection: {
                  type: 'server_vad',
                  silence_duration_ms: 600,
                  threshold: 0.5,
                },
              },
            },
          })
        }
      } catch {
        // ignore
      }
    })

    openaiWs.on('error', (err) => {
      forward(
        JSON.stringify({
          type: 'error',
          error: { message: err?.message || 'OpenAI WS error' },
        }),
      )
    })

    openaiWs.on('close', (code, reason) => {
      lastCloseWasClean = code === 1000
      if (closed) return

      if (!didReconnect && !lastCloseWasClean) {
        didReconnect = true
        forward(JSON.stringify({ type: 'relay.reconnecting' }))
        connect()
        return
      }

      forward(
        JSON.stringify({
          type: 'relay.closed',
          code,
          reason: reason?.toString?.() || '',
        }),
      )
    })
  }

  connect()

  const send = (audioBase64) => {
    if (closed) return
    if (!audioBase64) return

    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      sendJson(openaiWs, { type: 'input_audio_buffer.append', audio: audioBase64 })
    } else {
      queue.push(audioBase64)
    }
  }

  const close = () => {
    closed = true
    try {
      openaiWs?.close?.(1000, 'browser disconnected')
    } catch {
      // ignore
    }
  }

  return { send, close }
}

