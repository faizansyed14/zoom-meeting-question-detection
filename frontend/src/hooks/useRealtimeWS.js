import { useCallback, useRef, useState } from 'react'

export function useRealtimeWS({ onTranscriptDelta, onTranscriptCompleted, onError } = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef(null)

  const connect = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return
    }

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/transcribe`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setIsConnected(true)
    ws.onclose = () => setIsConnected(false)
    ws.onerror = () => {
      setIsConnected(false)
      onError?.('WebSocket error')
    }

    ws.onmessage = (evt) => {
      let msg
      try {
        msg = JSON.parse(evt.data)
      } catch {
        return
      }

      const type = msg?.type
      if (type === 'conversation.item.input_audio_transcription.delta') {
        onTranscriptDelta?.(msg.delta || '')
        return
      }
      if (type === 'conversation.item.input_audio_transcription.completed') {
        onTranscriptCompleted?.(msg.transcript || '')
        return
      }
      if (type === 'error') {
        onError?.(msg?.error?.message || 'OpenAI error')
        return
      }
    }
  }, [onError, onTranscriptCompleted, onTranscriptDelta])

  const sendAudio = useCallback((base64) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'audio', data: base64 }))
  }, [])

  const disconnect = useCallback(() => {
    const ws = wsRef.current
    wsRef.current = null
    if (!ws) return
    try {
      ws.close()
    } catch {
      // ignore
    }
    setIsConnected(false)
  }, [])

  return { connect, sendAudio, disconnect, isConnected }
}

