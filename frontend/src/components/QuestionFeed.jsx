import React, { useEffect, useMemo, useRef } from 'react'
import QuestionCard from './QuestionCard.jsx'
import { AnimatePresence, motion } from 'framer-motion'
import { animated, useSpring } from '@react-spring/web'

function SkeletonCard() {
  return (
    <div className="q-skel">
      <div className="q-skel-line w80" />
      <div className="q-skel-line w60" />
      <div className="q-skel-line w40" />
    </div>
  )
}

export default function QuestionFeed({ questions, isLoading, lastAnalysisAt, lastAnalysisError }) {
  const listRef = useRef(null)
  const count = questions?.length || 0
  const prevCountRef = useRef(count)

  const spring = useSpring({
    from: { n: prevCountRef.current },
    to: { n: count },
    config: { tension: 200, friction: 12 },
  })

  const newestFirst = useMemo(() => {
    return [...(questions || [])].sort((a, b) => (b.detectedAtMs || 0) - (a.detectedAtMs || 0))
  }, [questions])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [count])

  useEffect(() => {
    prevCountRef.current = count
  }, [count])

  return (
    <div className="feed-panel">
      <div className="feed-header">
        <span className="label">Questions Detected</span>
        {count > 0 ? (
          <animated.span className="feed-count">{spring.n.to((n) => Math.round(n))}</animated.span>
        ) : null}
      </div>
      <motion.div className="feed-list" ref={listRef} layout>
        {lastAnalysisError ? <div className="error-toast">{lastAnalysisError}</div> : null}

        {count === 0 && isLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : null}

        {count === 0 && !isLoading ? (
          <div className="feed-empty">
            <div className="feed-empty-icon">👂</div>
            <p className="feed-empty-title">Listening for questions</p>
            <p className="feed-empty-sub">
              Questions appear here automatically
              <br />
              as people ask them
            </p>
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {count > 0 ? newestFirst.map((q, i) => <QuestionCard key={q.id} question={q} index={count - i} />) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

