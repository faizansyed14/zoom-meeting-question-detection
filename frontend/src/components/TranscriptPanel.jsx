import React, { useEffect, useMemo, useRef } from 'react'

export default function TranscriptPanel({ transcript, interimText, isCollapsed, onToggle }) {
  const boxRef = useRef(null)
  const wordCount = useMemo(() => {
    const t = `${transcript || ''} ${interimText || ''}`.trim()
    if (!t) return 0
    return t.split(/\s+/).filter(Boolean).length
  }, [interimText, transcript])

  useEffect(() => {
    if (isCollapsed) return
    if (!boxRef.current) return
    boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [isCollapsed, transcript, interimText])

  return (
    <div className={`transcriptWrap ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="transcriptHeader">
        <div className="transcriptTitle">
          Live Transcript <span className="muted">({wordCount} words)</span>
        </div>
        <button className="btnGhost" onClick={onToggle} type="button">
          {isCollapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {isCollapsed ? null : (
        <div className="transcriptBody" ref={boxRef}>
          <div className="transcriptText">{transcript || ''}</div>
          {interimText ? <div className="transcriptInterim">{interimText}</div> : null}
        </div>
      )}
    </div>
  )
}

