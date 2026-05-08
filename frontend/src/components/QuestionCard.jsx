import React from 'react'

const TYPE_CLASS = {
  clarification: 'badgeBlue',
  decision: 'badgeAmber',
  technical: 'badgePurple',
  opinion: 'badgeTeal',
  other: 'badgeGray',
}

function summarizeQuestionText(q) {
  const raw = String(q || '').replace(/\\s+/g, ' ').trim()
  if (!raw) return ''

  // If model returned long mixed context + question, keep last question-like sentence.
  const parts = raw.split(/(?<=[.?!])\\s+/g)
  const lastQ = [...parts].reverse().find((p) => /\\?\\s*$/.test(p) || /^(what|why|how|when|where|who|can|could|would|should|do|does|did|is|are|am|will|may|might)\\b/i.test(p.trim()))
  const picked = (lastQ || raw).trim()

  const MAX = 120
  if (picked.length <= MAX) return picked
  return picked.slice(0, MAX - 1).trimEnd() + '…'
}

export default function QuestionCard({ question, rawQuestion, context, type, index, timestamp }) {
  const cls = TYPE_CLASS[type] || TYPE_CLASS.other
  const shortQ = summarizeQuestionText(question)

  return (
    <div className="qCard qEnter" title={String(rawQuestion || question || '')}>
      <div className="qTop">
        <div className="qIndex">{index}</div>
        <div className={`qType ${cls}`}>{type}</div>
        <div className="qTime">{timestamp}</div>
      </div>
      <div className="qText">{shortQ}</div>
      {context ? <div className="qContext">{context}</div> : null}
    </div>
  )
}

