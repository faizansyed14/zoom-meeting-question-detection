import React from 'react'

export default function StartScreen({ onStart, error, onShowHowTo }) {
  return (
    <div className="startScreen">
      <div className="startCard">
        <div className="startTitle">Meeting Question Tracker</div>
        <div className="startSubtitle">Captures questions from your Zoom call in real time</div>

        <button className="btnPrimary startBtn" onClick={onStart}>
          Start Listening
        </button>

        <div className="howSteps">
          <div className="howStep">1. Click Start Listening</div>
          <div className="howStep">2. In the browser dialog, select your Zoom tab</div>
          <div className="howStep">3. Questions will appear here automatically</div>
        </div>

        <div className="startMeta">
          <button className="linkBtn" onClick={onShowHowTo} type="button">
            How to use
          </button>
          <div className="startWarn">Uses Chrome tab audio capture. Best in Chrome/Edge. Safari not supported.</div>
          <div className="startNote">Realtime: streams audio to local backend, transcribed word-by-word via OpenAI Realtime.</div>
        </div>

        {error ? <div className="errorText">{error}</div> : null}
      </div>
    </div>
  )
}

