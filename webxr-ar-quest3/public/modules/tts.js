// ─── TTS (ElevenLabs) — speak terminal responses ───
// Calls Mistral API directly for clean text, then speaks via ElevenLabs
import { log } from './logging.js';

let ttsSpeaking = false;

/**
 * Ask Mistral for a short spoken reply, then speak it via ElevenLabs TTS.
 * Called from voice.js after the transcribed command is sent to terminal.
 */
export async function speakReply(userText) {
  if (ttsSpeaking) { log('[TTS] Already speaking, skip'); return; }
  try {
    log(`[TTS] Getting reply for: "${userText}"`);
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: 'You are a helpful coding assistant. Give a brief spoken reply (1-3 sentences). No markdown, no code blocks — just plain spoken text.' },
          { role: 'user', content: userText },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply || reply.length < 3) { log(`[TTS] Empty reply, skipping`); return; }

    const ttsText = reply.length > 500 ? reply.substring(0, 500) + '...' : reply;
    log(`[TTS] Speaking: "${ttsText.substring(0, 120)}"`);
    speakTTS(ttsText);
  } catch (e) {
    log(`[TTS] Chat error: ${e.message}`);
  }
}

// Keep these as no-ops so terminal.js import doesn't break
export function enableTtsCollecting() {}
export function onTermOutput() {}

// Streaming PCM playback
const PCM_RATE = 24000;
const PCM_CHUNK_SAMPLES = 4800;

async function speakTTS(text) {
  if (ttsSpeaking) return;
  ttsSpeaking = true;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = await res.text();
      log(`[TTS] Error: ${err}`);
      ttsSpeaking = false;
      return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PCM_RATE });
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 3.0;
    gainNode.connect(audioCtx.destination);
    const reader = res.body.getReader();
    let nextTime = audioCtx.currentTime;
    let leftover = new Uint8Array(0);

    log('[TTS] Streaming audio...');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const merged = new Uint8Array(leftover.length + value.length);
      merged.set(leftover);
      merged.set(value, leftover.length);

      const chunkBytes = PCM_CHUNK_SAMPLES * 2;
      let offset = 0;
      while (offset + chunkBytes <= merged.length) {
        const slice = merged.slice(offset, offset + chunkBytes);
        scheduleChunk(audioCtx, gainNode, slice, nextTime);
        nextTime += PCM_CHUNK_SAMPLES / PCM_RATE;
        offset += chunkBytes;
      }
      leftover = merged.slice(offset);
    }

    if (leftover.length >= 2) {
      const samples = Math.floor(leftover.length / 2);
      scheduleChunk(audioCtx, gainNode, leftover.slice(0, samples * 2), nextTime);
      nextTime += samples / PCM_RATE;
    }

    const remaining = nextTime - audioCtx.currentTime;
    setTimeout(() => { ttsSpeaking = false; audioCtx.close(); }, Math.max(0, remaining * 1000) + 200);
  } catch (e) {
    log(`[TTS] ${e.message}`);
    ttsSpeaking = false;
  }
}

function scheduleChunk(audioCtx, gainNode, pcmBytes, startTime) {
  const samples = pcmBytes.length / 2;
  const float32 = new Float32Array(samples);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  for (let i = 0; i < samples; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  const buf = audioCtx.createBuffer(1, samples, PCM_RATE);
  buf.getChannelData(0).set(float32);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);
  if (startTime < audioCtx.currentTime) startTime = audioCtx.currentTime;
  src.start(startTime);
}
