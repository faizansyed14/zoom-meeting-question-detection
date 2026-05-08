import React, { useEffect, useMemo, useRef } from 'react'

export default function TranscriptPanel({ transcript, interimText, isCollapsed, onToggle }) {
  const scrollRef = useRef(null)
  const wordCount = useMemo(() => {
    const p = `${transcript?.participants || ''} ${interimText?.participants || ''}`.trim()
    const h = `${transcript?.host || ''} ${interimText?.host || ''}`.trim()
    const t = `${p} ${h}`.trim()
    if (!t) return 0
    return t.split(/\s+/).filter(Boolean).length
  }, [interimText, transcript])

  useEffect(() => {
    if (isCollapsed) return
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [isCollapsed, transcript, interimText])

  return (
    <div className="transcript-panel">
      <div className="transcript-header" onClick={onToggle} role="button" tabIndex={0}>
        <span className="label">Live Transcript</span>
        <div className="transcript-header-right">
          <span className="word-count">{wordCount} words</span>
          <span className="transcript-toggle">{isCollapsed ? '▲' : '▼'}</span>
        </div>
      </div>
      {!isCollapsed && (
        <div className="transcript-body" ref={scrollRef}>
          <div className="transcript-section">
            <div className="transcript-section-head">
              <span className="label">Participants</span>
            </div>
            <div className="transcript-line">
              <span className="transcript-final">{transcript?.participants || ''}</span>
              {interimText?.participants ? (
                <span className="transcript-interim"> {interimText.participants}</span>
              ) : null}
            </div>
          </div>

          <div className="transcript-divider" />

          <div className="transcript-section">
            <div className="transcript-section-head">
              <span className="label">Host</span>
            </div>
            <div className="transcript-line">
              <span className="transcript-final">{transcript?.host || ''}</span>
              {interimText?.host ? <span className="transcript-interim"> {interimText.host}</span> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

