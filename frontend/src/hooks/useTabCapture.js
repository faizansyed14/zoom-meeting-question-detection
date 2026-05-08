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

  const tabStreamRef = useRef(null)
  const micStreamRef = useRef(null)
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
    if (tabStreamRef.current) for (const t of tabStreamRef.current.getTracks()) t.stop()
    if (micStreamRef.current) for (const t of micStreamRef.current.getTracks()) t.stop()
    tabStreamRef.current = null
    micStreamRef.current = null
    acRef.current = null
    sourceRef.current = null
    nodeRef.current = null
    accRef.current = new Int16Array(0)
  }, [])

  const startCapture = useCallback(async ({ includeTab = true, includeMic = false } = {}) => {
    setError('')
    const hasMediaDevices = !!navigator.mediaDevices
    const hasGDM = !!navigator.mediaDevices?.getDisplayMedia
    const hasGUM = !!navigator.mediaDevices?.getUserMedia
    const secure = typeof window !== 'undefined' ? window.isSecureContext : true

    if (!includeTab && !includeMic) {
      setError('Select at least one source: Participants or Host.')
      throw new Error('No capture sources selected')
    }

    if (!hasMediaDevices) {
      setError('MediaDevices not supported in this browser. Use Chrome or Edge.')
      throw new Error('mediaDevices not supported')
    }

    if (includeTab && !hasGDM) {
      const hints = []
      if (!secure) hints.push('not a secure context (use https or localhost)')
      hints.push('use Chrome/Edge')
      hints.push('open app at http://localhost:5173 (not file://)')
      setError(`Not supported: tab audio capture unavailable (${hints.join(', ')}).`)
      throw new Error('getDisplayMedia not supported')
    }

    if (includeMic && !hasGUM) {
      setError('Microphone capture not supported in this browser.')
      throw new Error('getUserMedia not supported')
    }

    // Must run directly from click handler (user gesture).
    let tabStream = null
    if (includeTab) {
      try {
        // Chrome/Edge: tab audio often only available when video is also requested.
        tabStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
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
        tabStream.getVideoTracks().forEach((t) => t.stop())
      } catch {
        // ignore
      }

      tabStreamRef.current = tabStream
    }

    let micStream = null
    if (includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        })
        micStreamRef.current = micStream
      } catch (e) {
        setError('Microphone permission denied. Allow mic access to capture host voice.')
        if (!tabStream) throw e
      }
    }

    const ac = new AudioContext({ sampleRate: 24000 })
    acRef.current = ac

    // Merge tab audio + (optional) mic into one stream before worklet.
    const destination = ac.createMediaStreamDestination()
    if (tabStream) {
      const tabSource = ac.createMediaStreamSource(tabStream)
      tabSource.connect(destination)
    }
    if (micStream) {
      const micSource = ac.createMediaStreamSource(micStream)
      micSource.connect(destination)
    }

    if (!destination.stream.getAudioTracks().length) {
      setError('No audio tracks captured. Enable Share tab audio and/or allow microphone.')
      throw new Error('No audio tracks')
    }

    const source = ac.createMediaStreamSource(destination.stream)
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

