import React, { useEffect, useMemo, useRef } from 'react'
import QuestionCard from './QuestionCard.jsx'

function Skeleton() {
  return (
    <div className="qCard qSkeleton">
      <div className="skLine skWide" />
      <div className="skLine" />
      <div className="skLine skNarrow" />
    </div>
  )
}

export default function QuestionFeed({ questions, isLoading, lastAnalysisAt, lastAnalysisError }) {
  const listRef = useRef(null)
  const count = questions?.length || 0

  const newestFirst = useMemo(() => {
    return [...(questions || [])].sort((a, b) => (b.detectedAtMs || 0) - (a.detectedAtMs || 0))
  }, [questions])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [count])

  return (
    <div className="panel">
      <div className="panelHeader">
        <div className="panelTitle">
          Questions <span className="countPill">{count} detected</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {lastAnalysisError ? 'Analysis error' : lastAnalysisAt ? `Last analysis ${lastAnalysisAt}` : 'No analysis yet'}
        </div>
      </div>

      <div className="panelBody" ref={listRef}>
        {lastAnalysisError ? <div className="errorText">{lastAnalysisError}</div> : null}
        {count === 0 && isLoading ? (
          <>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </>
        ) : null}

        {count === 0 && !isLoading ? (
          <div className="emptyState">
            <div className="emptyTitle">Listening for questions…</div>
            <div className="emptySub">Questions extracted as transcript arrives.</div>
          </div>
        ) : null}

        {newestFirst.map((q, i) => (
          <QuestionCard
            key={q.id}
            index={count - i}
            question={q.question}
            rawQuestion={q.rawQuestion}
            context={q.context}
            type={q.type}
            timestamp={q.timestamp}
          />
        ))}
      </div>
    </div>
  )
}

