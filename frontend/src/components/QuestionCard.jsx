import React from 'react'
import { motion } from 'framer-motion'

export default function QuestionCard({ question, index }) {
  const src = question?.source === 'host' ? 'Host' : 'Participants'

  return (
    <motion.div
      className="q-card"
      title={String(question?.rawQuestion || question?.question || '')}
      layout
      initial={{ opacity: 0, y: 16, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="q-card-top">
        <span className="q-num">#{index}</span>
        <span className={`q-src ${question?.source === 'host' ? 'src-host' : 'src-participants'}`}>{src}</span>
        <span className="q-time">{question?.timestamp || ''}</span>
      </div>
      <p className="q-text">{question?.question || ''}</p>
      {question?.about ? <p className="q-context">{question.about}</p> : null}
    </motion.div>
  )
}

