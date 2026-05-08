import React from 'react'

export default function StartScreen({ onStart, error }) {
  return (
    <div className="start-screen">
      <div className="start-glow" />

      <div className="start-card">
        <h1 className="start-title">Zoom</h1>
        <p className="start-subtitle">Real-time question detection from your Zoom meeting</p>

        <div className="start-steps">
          <div className="step">
            <span className="step-num">1</span>
            <span className="step-text">Click Start Listening below</span>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <span className="step-text">Select your Zoom tab in the browser dialog</span>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <span className="step-text">Choose what to transcribe (Participants / Host) — questions appear automatically</span>
          </div>
        </div>

        <button className="btn-start-main" onClick={onStart}>
          <span className="btn-icon">▶</span>
          Get Started
        </button>

        <p className="start-note"> Works best in Chrome or Edge — tab audio capture required</p>

        {error && <div className="start-error">{error}</div>}
      </div>
    </div>
  )
}

