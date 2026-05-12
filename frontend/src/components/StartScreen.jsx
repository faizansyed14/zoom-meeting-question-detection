import React from 'react'
import { motion } from 'framer-motion'

export default function StartScreen({ captureSources, setCaptureSources, onStart, onLogout, error, disabled }) {
  const canStart = !!(captureSources?.participants || captureSources?.host)
  return (
    <div className="start-screen">
      <div className="start-glow" />

      <div className="start-card">
        {onLogout ? (
          <motion.button
            className="btn-export"
            style={{ position: 'absolute', top: 14, right: 14, padding: '8px 12px' }}
            onClick={onLogout}
            whileTap={{ scale: 0.96 }}
            type="button"
            disabled={disabled}
          >
            Logout
          </motion.button>
        ) : null}

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

        <div className="setup-toggles" style={{ marginTop: 6, marginBottom: 14 }}>
          <div className="setup-toggle-row">
            <div className="setup-toggle-left">
              <div className="setup-toggle-name">Participants</div>
              <div className="setup-toggle-help">Transcribe Zoom tab audio (others)</div>
            </div>
            <button
              type="button"
              className={`pill-toggle ${captureSources?.participants ? 'on' : 'off'}`}
              onClick={() => setCaptureSources?.((s) => ({ ...s, participants: !s.participants }))}
              disabled={disabled}
              aria-pressed={!!captureSources?.participants}
            >
              <span className="pill-knob" />
            </button>
          </div>

          <div className="setup-toggle-row">
            <div className="setup-toggle-left">
              <div className="setup-toggle-name">Host</div>
              <div className="setup-toggle-help">Transcribe your microphone (you)</div>
            </div>
            <button
              type="button"
              className={`pill-toggle ${captureSources?.host ? 'on' : 'off'}`}
              onClick={() => setCaptureSources?.((s) => ({ ...s, host: !s.host }))}
              disabled={disabled}
              aria-pressed={!!captureSources?.host}
            >
              <span className="pill-knob" />
            </button>
          </div>

          <div className="setup-note" style={{ textAlign: 'left', marginTop: 2 }}>
            {captureSources?.participants && !captureSources?.host
              ? 'Will transcribe participants only.'
              : !captureSources?.participants && captureSources?.host
                ? 'Will transcribe host only.'
                : captureSources?.participants && captureSources?.host
                  ? 'Will transcribe host + participants.'
                  : 'Select at least one source.'}
          </div>
        </div>

        <motion.button
          className="btn-start-main"
          onClick={onStart}
          whileTap={{ scale: 0.96 }}
          disabled={!canStart || disabled}
        >
          <span className="btn-icon">▶</span>
          Start Listening
        </motion.button>

        <p className="start-note"> Works best in Chrome or Edge — tab audio capture required</p>

        {error && <div className="start-error">{error}</div>}
      </div>
    </div>
  )
}

