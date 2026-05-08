import { useCallback, useRef, useState } from 'react'

function bufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function useTabCapture({ onAudioChunk } = {}) {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState('')

  const streamRef = useRef(null)
  const acRef = useRef(null)
  const sourceRef = useRef(null)
  const nodeRef = useRef(null)
  const accRef = useRef(new Int16Array(0))

  const stopCapture = useCallback(() => {
    setIsCapturing(false)
    try {
      nodeRef.current?.disconnect?.()
    } catch {
      // ignore
    }
    try {
      sourceRef.current?.disconnect?.()
    } catch {
      // ignore
    }
    try {
      acRef.current?.close?.()
    } catch {
      // ignore
    }
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop()
    }
    streamRef.current = null
    acRef.current = null
    sourceRef.current = null
    nodeRef.current = null
    accRef.current = new Int16Array(0)
  }, [])

  const startCapture = useCallback(async () => {
    setError('')
    const hasMediaDevices = !!navigator.mediaDevices
    const hasGDM = !!navigator.mediaDevices?.getDisplayMedia
    const secure = typeof window !== 'undefined' ? window.isSecureContext : true

    if (!hasMediaDevices || !hasGDM) {
      const hints = []
      if (!secure) hints.push('not a secure context (use https or localhost)')
      hints.push('use Chrome/Edge')
      hints.push('open app at http://localhost:5173 (not file://)')
      setError(`Not supported: tab audio capture unavailable (${hints.join(', ')}).`)
      throw new Error('getDisplayMedia not supported')
    }

    // Must run directly from click handler (user gesture).
    let stream
    try {
      // Chrome/Edge: tab audio often only available when video is also requested.
      stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    } catch (e) {
      const name = e?.name || ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Capture blocked/canceled. In picker select Zoom tab and enable Share tab audio.')
      } else {
        setError(e?.message || 'Failed to start capture.')
      }
      throw e
    }

    // Defensive: stop any video tracks if browser returns them.
    try {
      stream.getVideoTracks().forEach((t) => t.stop())
    } catch {
      // ignore
    }

    streamRef.current = stream

    const ac = new AudioContext({ sampleRate: 24000 })
    acRef.current = ac

    const source = ac.createMediaStreamSource(stream)
    sourceRef.current = source

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

      // Emit ~250ms at 24kHz => ~6000 samples.
      const EMIT_SAMPLES = 6000
      if (accRef.current.length >= EMIT_SAMPLES) {
        const out = accRef.current.slice(0, EMIT_SAMPLES)
        accRef.current = accRef.current.slice(EMIT_SAMPLES)
        const base64 = bufferToBase64(out.buffer)
        onAudioChunk?.(base64)
      }
    }

    // Connect graph: source -> worklet. No destination needed.
    source.connect(node)

    // Some browsers suspend until resume called after gesture.
    if (ac.state !== 'running') {
      await ac.resume()
    }

    setIsCapturing(true)
    return true
  }, [onAudioChunk])

  return { startCapture, stopCapture, isCapturing, error }
}

