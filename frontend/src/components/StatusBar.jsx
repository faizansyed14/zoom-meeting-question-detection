import React from 'react'

function fmt(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0')
  const s = String(secs % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function StatusBar({ isCapturing, status, isAnalyzing, elapsedSeconds }) {
  const elapsed = fmt(elapsedSeconds || 0)
  const statusMessage =
    status === 'stopped' ? 'Stopped' : status === 'connecting' ? 'Connecting…' : isCapturing ? 'Live — capturing Zoom audio' : 'Idle'

  return (
    <div className={`status-bar ${isCapturing ? 'status-live' : status === 'stopped' ? 'status-stopped' : ''}`}>
      <div className="status-left">
        <div className={`status-dot ${isCapturing ? 'dot-live' : status === 'stopped' ? 'dot-stopped' : 'dot-idle'}`} />
        <span className="status-text">{statusMessage}</span>
      </div>
      <div className="status-right">
        {isAnalyzing && (
          <div className="analyzing-badge">
            <div className="analyzing-spinner" />
            Analyzing
          </div>
        )}
        {isCapturing && <span className="status-timer">{elapsed}</span>}
      </div>
    </div>
  )
}

