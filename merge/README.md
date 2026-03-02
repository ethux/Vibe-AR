# WebXR AR Voice Assistant — Meta Quest 3

Voice-interactive AR assistant using Mistral AI (Voxtral STT + LLM) with TTS output.

## Quick Start

```bash
cd webxr-ar-quest3
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
```

## API Keys Needed

- **MISTRAL_API_KEY** (required) — for Voxtral STT + Mistral chat
- **ELEVENLABS_API_KEY** (optional) — for high-quality TTS, falls back to Web Speech API

## Testing

### Desktop (no headset)
Open `http://localhost:3000` — mic button works, AR button is disabled.

### Quest 3
WebXR requires HTTPS. Use a tunnel:
```bash
# Option 1: ngrok
ngrok http 3000

# Option 2: cloudflare tunnel
cloudflared tunnel --url http://localhost:3000
```
Open the HTTPS URL in Quest Browser, tap "Start AR", then use the mic button.

## Architecture

```
Quest 3 Browser
  ├── Mic → MediaRecorder (webm/opus)
  ├── Base64 audio → POST /api/transcribe → Voxtral API
  ├── Transcription → POST /api/chat → Mistral LLM
  ├── Response → POST /api/tts → ElevenLabs (or Web Speech API fallback)
  └── Three.js + WebXR (AR passthrough scene)
```
