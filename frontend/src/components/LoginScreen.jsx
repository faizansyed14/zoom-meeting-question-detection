import React, { useState } from 'react'
import { motion } from 'framer-motion'

export default function LoginScreen({ onLogin, error, busy, defaultEmail }) {
  const [email, setEmail] = useState(defaultEmail || '')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('admin') // admin | viewer

  return (
    <div className="start-screen">
      <div className="start-glow" />

      <div className="start-card">
        <h1 className="start-title">Zoom</h1>
        <p className="start-subtitle">Sign in to continue</p>

        <div className="setup-toggles" style={{ marginTop: 6, marginBottom: 10 }}>
          <div className="setup-toggle-row">
            <div className="setup-toggle-left">
              <div className="setup-toggle-name">Login as</div>
              <div className="setup-toggle-help">Pick Admin or Viewer</div>
            </div>
            <div className="toggle-group" role="group" aria-label="Login role">
              <button
                type="button"
                className={`toggle-btn ${mode === 'admin' ? 'active' : ''}`}
                onClick={() => setMode('admin')}
                disabled={busy}
                aria-pressed={mode === 'admin'}
              >
                Admin
              </button>
              <button
                type="button"
                className={`toggle-btn ${mode === 'viewer' ? 'active' : ''}`}
                onClick={() => setMode('viewer')}
                disabled={busy}
                aria-pressed={mode === 'viewer'}
              >
                Viewer
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10, width: '100%', marginTop: 16 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className="label">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              inputMode="email"
              className="input"
              disabled={busy}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span className="label">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              className="input"
              disabled={busy}
            />
          </label>
        </div>

        <motion.button
          className="btn-start-main"
          whileTap={{ scale: 0.96 }}
          disabled={busy || !email.trim() || !password}
          onClick={() => onLogin?.({ email, password, mode })}
          style={{ marginTop: 14 }}
        >
          <span className="btn-icon">→</span>
          {busy ? 'Signing in…' : mode === 'admin' ? 'Sign in as Admin' : 'Sign in as Viewer'}
        </motion.button>

        {error ? <div className="start-error">{error}</div> : null}
      </div>
    </div>
  )
}

