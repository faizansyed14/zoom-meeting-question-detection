import React from 'react'

function fmt(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0')
  const s = String(secs % 60).padStart(2, '0')
  return `${m}:${s}`
}

export default function StatusBar({ isLive, elapsedSeconds, questionCount, wordCount, isAnalyzing }) {
  return (
    <div className="statusBar">
      <div className="statusLeft">
        <span className={`dot ${isLive ? 'dotGreen' : 'dotRed'}`} />
        <span className="statusText">{isLive ? 'Live — capturing Zoom audio' : 'Stopped'}</span>
      </div>

      <div className="statusCenter">{fmt(elapsedSeconds || 0)}</div>

      <div className="statusRight">
        <span className="muted">{questionCount || 0} questions</span>
        <span className="sep" />
        <span className="muted">{(wordCount || 0).toLocaleString()} words</span>
        {isAnalyzing ? <span className="spinner" aria-label="Analyzing" /> : null}
      </div>
    </div>
  )
}

