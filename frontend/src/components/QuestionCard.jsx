import React from 'react'

export default function QuestionCard({ question, index }) {
  const t = question?.type || 'other'
  const src = question?.source === 'host' ? 'Host' : 'Participants'

  return (
    <div className={`q-card q-card-${t}`} title={String(question?.rawQuestion || question?.question || '')}>
      <div className="q-card-top">
        <span className="q-num">#{index}</span>
        <span className={`q-src ${question?.source === 'host' ? 'src-host' : 'src-participants'}`}>{src}</span>
        <span className={`q-badge badge-${t}`}>{t}</span>
        <span className="q-time">{question?.timestamp || ''}</span>
      </div>
      <p className="q-text">{question?.question || ''}</p>
      {question?.context ? <p className="q-context">{question.context}</p> : null}
    </div>
  )
}

