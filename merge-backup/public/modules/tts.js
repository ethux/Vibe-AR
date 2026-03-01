// ─── TTS (ElevenLabs) — speak terminal responses ───
// Receives sentence chunks via WebSocket push from the Mistral proxy
// and speaks them immediately via ElevenLabs with request stitching.
import { log } from './core/logging.js';

let ttsSpeaking = false;
let currentAudioCtx = null;
let currentGainNode = null;
let currentReader = null;
let currentAbort = null;
let stopRequested = false;
let currentGen = 0;
let speakerId = 0;

// WebSocket for receiving TTS chunks from server
let ttsWs = null;
let chunkQueue = [];
let queueResolve = null;
let queueDone = false;

export function isTtsSpeaking() { return ttsSpeaking; }

export function stopTTS() {
  log('[TTS] Stopping playback');
  stopRequested = true;
  currentGen++;
  speakerId++;
  chunkQueue = [];
  queueDone = true;
  if (queueResolve) { queueResolve(); queueResolve = null; }
  if (currentAbort) { try { currentAbort.abort(); } catch (_) {} currentAbort = null; }
  if (currentReader) { try { currentReader.cancel(); } catch (_) {} currentReader = null; }
  if (currentGainNode) { try { currentGainNode.disconnect(); } catch (_) {} currentGainNode = null; }
  if (currentAudioCtx) { try { currentAudioCtx.close(); } catch (_) {} currentAudioCtx = null; }
  ttsSpeaking = false;
}

function connectTtsWs() {
  if (ttsWs && ttsWs.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ttsWs = new WebSocket(`${proto}//${location.host}/ws/tts`);

  ttsWs.onopen = () => log('[TTS-WS] Connected');

  ttsWs.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'start') {
        log(`[TTS-WS] New response gen=${msg.gen}`);
        stopTTS();
        chunkQueue = [];
        queueDone = false;
        currentGen = msg.gen;
        _speakFromQueue(msg.gen);
      } else if (msg.type === 'chunk' && msg.gen === currentGen) {
        chunkQueue.push(msg.text);
        if (queueResolve) { queueResolve(); queueResolve = null; }
      } else if (msg.type === 'done' && msg.gen === currentGen) {
        queueDone = true;
        if (queueResolve) { queueResolve(); queueResolve = null; }
      }
    } catch (_) {}
  };

  ttsWs.onclose = () => {
    log('[TTS-WS] Disconnected, reconnecting in 2s...');
    setTimeout(connectTtsWs, 2000);
  };

  ttsWs.onerror = () => ttsWs.close();
}

connectTtsWs();

const PCM_RATE = 24000;
const PCM_CHUNK_SAMPLES = 4800;

async function _speakFromQueue(gen) {
  if (ttsSpeaking) return;

  const myId = ++speakerId;
  ttsSpeaking = true;
  stopRequested = false;

  let audioCtx = null;
  let gainNode = null;
  let nextTime = 0;
  const requestIds = [];
  let spoken = 0;

  const isStale = () => stopRequested || gen !== currentGen || myId !== speakerId;

  try {
    while (true) {
      if (isStale()) break;

      while (chunkQueue.length === 0 && !queueDone) {
        await new Promise(r => { queueResolve = r; });
        if (isStale()) break;
      }
      if (isStale()) break;
      if (chunkQueue.length === 0 && queueDone) break;

      const text = chunkQueue.shift();
      if (!text || text.length < 3) continue;

      log(`[TTS] Speaking: "${text.substring(0, 60)}"`);

      const ttsBody = { text };
      if (requestIds.length > 0) {
        ttsBody.previous_request_ids = requestIds.slice(-3);
      }

      const abort = new AbortController();
      currentAbort = abort;

      let ttsRes;
      try {
        ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ttsBody),
          signal: abort.signal,
        });
      } catch (e) {
        if (e.name === 'AbortError') break;
        log(`[TTS] Fetch error: ${e.message}`);
        continue;
      }

      if (isStale()) break;

      if (!ttsRes.ok) {
        log(`[TTS] Error: ${await ttsRes.text()}`);
        continue;
      }

      const reqId = ttsRes.headers.get('X-Request-Id');
      if (reqId) requestIds.push(reqId);

      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PCM_RATE });
        currentAudioCtx = audioCtx;
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 3.0;
        gainNode.connect(audioCtx.destination);
        currentGainNode = gainNode;
        nextTime = audioCtx.currentTime;
      } else if (nextTime < audioCtx.currentTime) {
        nextTime = audioCtx.currentTime;
      }

      const reader = ttsRes.body.getReader();
      currentReader = reader;
      let leftover = new Uint8Array(0);

      while (true) {
        if (isStale()) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;

        const merged = new Uint8Array(leftover.length + value.length);
        merged.set(leftover);
        merged.set(value, leftover.length);

        const chunkBytes = PCM_CHUNK_SAMPLES * 2;
        let offset = 0;
        while (offset + chunkBytes <= merged.length) {
          scheduleChunk(audioCtx, gainNode, merged.slice(offset, offset + chunkBytes), nextTime);
          nextTime += PCM_CHUNK_SAMPLES / PCM_RATE;
          offset += chunkBytes;
        }
        leftover = merged.slice(offset);
      }

      if (leftover.length >= 2 && !isStale()) {
        const samples = Math.floor(leftover.length / 2);
        scheduleChunk(audioCtx, gainNode, leftover.slice(0, samples * 2), nextTime);
        nextTime += samples / PCM_RATE;
      }
      currentReader = null;
      currentAbort = null;
      spoken++;
    }

    if (audioCtx && !isStale()) {
      const remaining = nextTime - audioCtx.currentTime;
      if (remaining > 0 && spoken > 0) await new Promise(r => setTimeout(r, remaining * 1000 + 200));
    }
    log(`[TTS] Done — spoke ${spoken} chunks`);
  } catch (e) {
    if (e.name !== 'AbortError') log(`[TTS] Error: ${e.message}`);
  } finally {
    if (myId === speakerId) {
      ttsSpeaking = false;
      currentReader = null;
      currentAbort = null;
      if (currentAudioCtx === audioCtx) {
        currentGainNode = null;
        currentAudioCtx = null;
        try { audioCtx?.close(); } catch (_) {}
      }
    }
  }
}

function scheduleChunk(audioCtx, gainNode, pcmBytes, startTime) {
  const samples = pcmBytes.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < samples; i++) float32[i] = view.getInt16(i * 2, true) / 32768;
  const buf = audioCtx.createBuffer(1, samples, PCM_RATE);
  buf.getChannelData(0).set(float32);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  if (startTime < audioCtx.currentTime) startTime = audioCtx.currentTime;
  src.start(startTime);
}

// speakReply() kept for backwards compat — WS push handles everything now
export async function speakReply() {
  if (!ttsWs || ttsWs.readyState > 1) connectTtsWs();
}

export function enableTtsCollecting() {}
export function onTermOutput() {}
