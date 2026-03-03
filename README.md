# Vibe AR — Vibecoding in Augmented Reality - Mistral AI World Wide Hackathon Paris 2026

Vibecoding, but in AR. Put on a Meta Quest 3, talk to your AI coding assistant, and watch it build your app — all floating in front of you in mixed reality.

Built with Mistral AI (Voxtral STT + Devstral/Mistral Large), ElevenLabs TTS, Three.js, and WebXR.

> **Status:** Early prototype — the core loop works (voice → code → preview) but not all features are fully polished yet. Lots of improvements to come!

## Team
- [TR-MZ](https://github.com/TR-MZ)
- [Min0laa](https://github.com/Min0laa)
- [ethux](https://github.com/ethux)

## Features

### Working
- **Voice-driven coding** — speak to Vibe CLI through Voxtral speech-to-text, get spoken responses via ElevenLabs TTS
- **Hand gesture interaction** — pinch to grab windows, point to select, fist to rotate, palm for context menu
- **3D file explorer** — browse your project as floating pixel-art bubbles, open files by grabbing them
- **Floating terminal** — xterm.js terminal streamed from Docker via ttyd
- **Live preview** — see your web app rendered in a floating AR window
- **Git tree visualization** — navigate branches and commits in 3D space
- **MCP server** — AI agent tools for git operations and scene control

### Work in Progress
- **Code City visualization** — 3D city view of your codebase (currently broken)

## Quick Start

```bash
cp .env.example .env
# Edit .env with your API keys
docker compose up
```

Open `https://localhost:3000` on your Quest 3 browser.

## API Keys Needed

- **MISTRAL_API_KEY** (required) — Voxtral STT + Mistral chat
- **ELEVENLABS_API_KEY** (optional) — high-quality TTS, falls back to Web Speech API
- **GH_TOKEN** (optional) — GitHub access for Vibe CLI

## Architecture

```
Quest 3 Browser (WebXR passthrough)
  ├── Voice Input → MediaRecorder → Voxtral STT
  ├── Transcription → Mistral LLM (via proxy)
  ├── Response → ElevenLabs TTS → PCM playback
  ├── Three.js scene (bubbles, CodeCity, git tree, windows)
  └── Hand tracking (pinch, grab, point, fist, palm gestures)
```

### Services (Docker Compose)

| Service | Description | Ports |
|---------|-------------|-------|
| **web** | Node.js server, serves frontend + Mistral API proxy | HTTPS:3000, HTTP:3001 |
| **vibe-terminal** | Vibe CLI in Docker via ttyd | 7681 (internal) |
| **companion** | Python/FastAPI file system + terminal API | 8000 |
| **code-city-server** | 3D code visualization backend | 5001 |

### Frontend Modules

```
public/modules/
├── input/          — hand tracking, voice, 3D keyboard
├── visualizations/ — bubbles (file explorer), CodeCity, git tree, live preview
├── windowing/      — window manager, file viewer, pixel art UI
├── core/           — state, logging, textures
├── scene.js        — Three.js scene setup
├── terminal.js     — xterm.js integration
└── tts.js          — ElevenLabs TTS playback
```

## Testing

### Desktop (no headset)
Open `https://localhost:3000` — mic button works, AR is disabled.

### Quest 3
Open the HTTPS URL directly in Quest Browser, or tunnel if needed:
```bash
ngrok http 3000
```

## Configuration

Vibe CLI config lives at `workspace/.vibe/config.toml` — configures Mistral models, API proxy routing, and MCP server connections.
