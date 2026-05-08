# Zoom Question Tracker (Prototype)

Browser app runs alongside Zoom tab. Captures Zoom tab audio, streams 24kHz PCM16 to Node backend over WebSocket. Backend relays to OpenAI Realtime transcription. Transcript deltas update UI live. GPT-4o Mini extracts questions as transcript grows.

## Setup

- `npm install`
- `npm run install:all`
- Copy `.env.example` → `.env`
- Set `OPENAI_API_KEY` and `VITE_OPENAI_API_KEY`
- `npm start` (backend on `:3001`, frontend Vite dev server)

## How to use

1. Join Zoom meeting in another browser tab.
2. Open this app in a second tab and click **Start Listening**.
3. In the share dialog, pick the Zoom tab and enable **Share tab audio**.

## Known limitations

- Tab audio capture works best in Chrome/Edge. Safari not supported.
- Realtime transcription goes through local backend. Question extraction still calls OpenAI from browser (prototype).

## Cost estimate (rough)

Realtime transcription + GPT extraction costs depend on audio duration + tokens. Expect low dollars/hour scale for typical meetings; measure with OpenAI usage dashboard.

## Deploy on Render (Option A — one service)

1. Push repo to GitHub.
2. Render → **New** → **Blueprint** → connect repo (uses root `render.yaml`) **or** **Web Service** with:
   - **Build command**: `npm run render-build`
   - **Start command**: `node backend/server.js`
   - **Health check path**: `/health`
3. **Environment variables** (service → Environment):
   - `OPENAI_API_KEY` — runtime (Realtime relay)
   - `VITE_OPENAI_API_KEY` — must be present at **build** time (Vite bakes it in). In Render, add it under **Build** environment too, or use “build-time” env if available.
4. Open your `https://<service>.onrender.com` — same tab capture rules (Chrome/Edge, HTTPS).

### Sleep / “keep awake”

- **Free** web services **spin down** after ~15 minutes without HTTP traffic. Render’s **health check** helps *while* the instance is running; it does **not** guarantee the app never sleeps.
- To reduce cold starts, use a free external monitor (e.g. UptimeRobot, cron-job.org) to **GET** `https://<your-app>.onrender.com/health` every **10–14 minutes**. This is a common pattern; check [Render pricing/docs](https://render.com/docs) for current free-tier behavior.

### Local production smoke test

```bash
npm run render-build
OPENAI_API_KEY=... VITE_OPENAI_API_KEY=... npm run start:prod
```

Open `http://localhost:3001` (or `PORT` you set).

