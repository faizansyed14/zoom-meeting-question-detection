import { useCallback, useRef, useState } from 'react'

function bufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Generic PCM16 (24kHz mono) capture helper using AudioWorklet.
// - source: "tab" uses getDisplayMedia (audio+video:true for tab audio reliability; video tracks stopped)
// - source: "mic" uses getUserMedia
export function useAudioCapture({ onAudioChunk } = {}) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState('')

  const streamRef = useRef(null)
  const acRef = useRef(null)
  const sourceRef = useRef(null)
  const nodeRef = useRef(null)
  const accRef = useRef(new Int16Array(0))

  const stop = useCallback(() => {
    setIsCapturing(false)
    try {
      nodeRef.current?.disconnect?.()
    } catch {}
    try {
      sourceRef.current?.disconnect?.()
    } catch {}
    try {
      acRef.current?.close?.()
    } catch {}
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
    }
    streamRef.current = null
    acRef.current = null
    sourceRef.current = null
    nodeRef.current = null
    accRef.current = new Int16Array(0)
  }, [])

  const start = useCallback(
    async ({ source } = {}) => {
      setError('')
      const secure = typeof window !== 'undefined' ? window.isSecureContext : true
      if (!navigator.mediaDevices) {
        setError('MediaDevices not supported. Use Chrome or Edge.')
        throw new Error('mediaDevices not supported')
      }
      if (!secure) {
        setError('Not secure context. Use https or localhost.')
        throw new Error('not secure context')
      }

      let stream = null
      if (source === 'tab') {
        if (!navigator.mediaDevices.getDisplayMedia) {
          setError('Tab capture not supported. Use Chrome or Edge.')
          throw new Error('getDisplayMedia not supported')
        }
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
        } catch (e) {
          const name = e?.name || ''
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            setError('Tab capture blocked/canceled. Select Zoom tab and enable Share tab audio.')
          } else {
            setError(e?.message || 'Failed to capture tab audio.')
          }
          throw e
        }
        try {
          stream.getVideoTracks().forEach((t) => t.stop())
        } catch {}
      } else if (source === 'mic') {
        if (!navigator.mediaDevices.getUserMedia) {
          setError('Microphone capture not supported.')
          throw new Error('getUserMedia not supported')
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
        } catch (e) {
          setError('Microphone permission denied. Allow mic access to capture host voice.')
          throw e
        }
      } else {
        setError('Unknown capture source.')
        throw new Error('unknown source')
      }

      if (!stream.getAudioTracks().length) {
        for (const t of stream.getTracks()) t.stop()
        setError('No audio track found. Enable tab audio and/or allow microphone.')
        throw new Error('no audio track')
      }

      streamRef.current = stream

      const ac = new AudioContext({ sampleRate: 24000 })
      acRef.current = ac

      const src = ac.createMediaStreamSource(stream)
      sourceRef.current = src

      await ac.audioWorklet.addModule('/pcm-processor.js')
      const node = new AudioWorkletNode(ac, 'pcm-processor')
      nodeRef.current = node

      node.port.onmessage = (evt) => {
        const buf = evt.data
        if (!buf) return
        const chunk = new Int16Array(buf)
        const prev = accRef.current
        const merged = new Int16Array(prev.length + chunk.length)
        merged.set(prev, 0)
        merged.set(chunk, prev.length)
        accRef.current = merged

        const EMIT_SAMPLES = 6000 // ~250ms
        if (accRef.current.length >= EMIT_SAMPLES) {
          const out = accRef.current.slice(0, EMIT_SAMPLES)
          accRef.current = accRef.current.slice(EMIT_SAMPLES)
          onAudioChunk?.(bufferToBase64(out.buffer))
        }
      }

      src.connect(node)
      if (ac.state !== 'running') await ac.resume()

      setIsCapturing(true)
      return true
    },
    [onAudioChunk],
  )

  return { start, stop, isCapturing, error }
}

