import React from 'react'
import { motion } from 'framer-motion'

export default function SetupScreen({
  captureSources,
  setCaptureSources,
  onStart,
  onBack,
  disabled,
  error,
}) {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-head">
          <div>
            <div className="label">Ready to listen</div>
            <div className="setup-title">Choose capture sources</div>
            <div className="setup-sub">
              Toggle what to transcribe. By default, both are on.
            </div>
          </div>
          <motion.button className="btn-export" type="button" onClick={onBack} whileTap={{ scale: 0.96 }}>
            Back
          </motion.button>
        </div>

        <div className="setup-toggles">
          <div className="setup-toggle-row">
            <div className="setup-toggle-left">
              <div className="setup-toggle-name">Participants</div>
              <div className="setup-toggle-help">Transcribe Zoom tab audio (others)</div>
            </div>
            <button
              type="button"
              className={`pill-toggle ${captureSources.participants ? 'on' : 'off'}`}
              onClick={() => setCaptureSources((s) => ({ ...s, participants: !s.participants }))}
              disabled={disabled}
              aria-pressed={captureSources.participants}
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
              className={`pill-toggle ${captureSources.host ? 'on' : 'off'}`}
              onClick={() => setCaptureSources((s) => ({ ...s, host: !s.host }))}
              disabled={disabled}
              aria-pressed={captureSources.host}
            >
              <span className="pill-knob" />
            </button>
          </div>
        </div>

        <div className="setup-foot">
          <div className="setup-note">
            {captureSources.participants && !captureSources.host
              ? 'Will transcribe participants only.'
              : !captureSources.participants && captureSources.host
                ? 'Will transcribe host only.'
                : captureSources.participants && captureSources.host
                  ? 'Will transcribe host + participants.'
                  : 'Select at least one source.'}
          </div>

          <motion.button
            className="btn-start-main"
            onClick={onStart}
            disabled={!captureSources.participants && !captureSources.host}
            whileTap={{ scale: 0.96 }}
          >
            <span className="btn-icon">▶</span>
            Start Listening
          </motion.button>

          {error ? <div className="start-error">{error}</div> : null}
        </div>
      </div>
    </div>
  )
}

