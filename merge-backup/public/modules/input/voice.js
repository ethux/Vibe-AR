// ─── Voice — Voxtral Realtime STT + Palm Context ───
import { getTermWs, getTerm, getBubbleMgr } from '../core/state.js';
import { log } from '../core/logging.js';
import { makeTextTexture } from '../core/textures.js';
import { speakReply } from '../tts.js';

let isRecording = false;
let micBtnMesh = null;

// Realtime state
let audioCtx = null;
let workletNode = null;
let micStream = null;
let transcribeWs = null;
let liveTranscript = '';
let pendingText = '';
let controlSent = false;
let prevTermText = '';

// Batch fallback state
let fallbackRecorder = null;

export function setMicBtnMesh(mesh) { micBtnMesh = mesh; }
export function getIsRecording() { return isRecording; }

export function toggleMicFromBtn() {
  if (isRecording) stopRecording();
  else startRecording();
}

function updateMicBtnVisual() {
  if (!micBtnMesh) return;
  micBtnMesh.material.map = isRecording
    ? makeTextTexture('REC', 22, '#ff2020', '#0c0c12', 96, 40)
    : makeTextTexture('MIC', 22, '#28c840', '#0c0c12', 96, 40);
  micBtnMesh.material.needsUpdate = true;
}

// ── Build message with palm context (hand-held bubbles) ──
function buildMessage(text) {
  let msg = text;
  const mgr = getBubbleMgr();
  if (mgr) {
    const paths = mgr.getPalmContextPaths();
    if (paths.length) {
      msg += `\nUSER GAVE YOU CONTEXT: [${paths.join(' – ')}]`;
      log(`[STT] Palm context: ${paths.join(', ')}`);
    }
  }
  return msg;
}

// ── Live-type text into the terminal (without submitting) ──
function typeInTerminal(text) {
  const termWs = getTermWs();
  if (!termWs || termWs.readyState !== WebSocket.OPEN) return;
  const clear = prevTermText.length > 0 ? '\x15' : '';
  termWs.send(new TextEncoder().encode('0' + clear + text));
  prevTermText = text;
}

// ── Send final text to terminal (with Enter) ──
function sendToTerminal(text) {
  const cmdInput = document.getElementById('cmd-input');
  if (!text?.trim()) {
    if (cmdInput) cmdInput.placeholder = 'No speech detected';
    setTimeout(() => { if (cmdInput) cmdInput.placeholder = 'Type command...'; }, 2000);
    return;
  }
  const trimmed = text.trim();
  if (cmdInput) { cmdInput.value = trimmed; cmdInput.placeholder = 'Type command...'; }
  const termWs = getTermWs();
  if (termWs?.readyState === WebSocket.OPEN) {
    const clear = prevTermText.length > 0 ? '\x15' : '';
    const msg = buildMessage(trimmed);
    termWs.send(new TextEncoder().encode('0' + clear + '<speak>' + msg + '</speak>\r'));
    prevTermText = '';
    log(`[STT] Sent: "${trimmed}"`);
    if (cmdInput) cmdInput.value = '';
    speakReply();
  }
}

// ── Cleanup helpers ──
function stopAudio() {
  if (workletNode) {
    workletNode.disconnect();
    workletNode.port.onmessage = null;
    workletNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch (_) {}
    audioCtx = null;
  }
}

// ── Batch fallback transcription ──
async function transcribeAndSend(blob, mime) {
  const cmdInput = document.getElementById('cmd-input');
  try {
    log('[STT] Fallback: batch transcribing...');
    if (cmdInput) cmdInput.placeholder = 'Transcribing...';
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let b64 = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    b64 = btoa(b64);
    const res = await fetch('/api/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: b64, mimeType: mime }),
    });
    const data = await res.json();
    const text = data.text || (data.segments || []).map(s => s.text).join(' ');
    sendToTerminal(text);
  } catch (e) {
    log(`[STT] Fallback error: ${e.message}`);
    if (cmdInput) cmdInput.placeholder = 'Type command...';
  }
}

function startBatchFallback(stream) {
  log('[MIC] Using batch fallback');
  const micBtn = document.getElementById('cmd-mic');
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4';
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    transcribeAndSend(new Blob(chunks, { type: mime }), mime);
    isRecording = false;
    if (micBtn) micBtn.classList.remove('recording');
    updateMicBtnVisual();
    fallbackRecorder = null;
  };
  recorder.start();
  fallbackRecorder = recorder;
  isRecording = true;
  if (micBtn) micBtn.classList.add('recording');
  updateMicBtnVisual();
}

// ── Main: startRecording (realtime with batch fallback) ──
export async function startRecording() {
  if (isRecording) return;
  const micBtn = document.getElementById('cmd-mic');
  const cmdInput = document.getElementById('cmd-input');

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    log(`[MIC] getUserMedia failed: ${e.message}`);
    return;
  }

  isRecording = true;
  liveTranscript = '';
  pendingText = '';
  controlSent = false;
  prevTermText = '';
  if (micBtn) micBtn.classList.add('recording');
  updateMicBtnVisual();
  log('[MIC] Recording started (realtime)');
  if (cmdInput) cmdInput.placeholder = 'Listening...';

  // Open WebSocket to server relay
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  transcribeWs = new WebSocket(`${wsProto}//${location.host}/ws/transcribe`);
  transcribeWs.binaryType = 'arraybuffer';

  transcribeWs.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'delta') {
        liveTranscript = msg.accumulated ?? (liveTranscript + msg.text);
        if (cmdInput) cmdInput.placeholder = liveTranscript.substring(0, 60) + (liveTranscript.length > 60 ? '…' : '');
        typeInTerminal(liveTranscript);
      } else if (msg.type === 'done') {
        pendingText = msg.text || liveTranscript;
        log(`[STT-RT] Done: "${pendingText}"`);
        sendToTerminal(pendingText);
        pendingText = '';
        liveTranscript = '';
        try { transcribeWs?.close(); } catch (_) {}
        transcribeWs = null;
      } else if (msg.type === 'error') {
        log(`[STT-RT] Error: ${msg.message}`);
      }
    } catch (_) {}
  };

  transcribeWs.onerror = () => log('[STT-RT] WebSocket error');
  transcribeWs.onclose = () => { transcribeWs = null; };

  // Set up AudioContext + worklet
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const sr = audioCtx.sampleRate;
    log(`[MIC] AudioContext sampleRate: ${sr}`);

    await audioCtx.audioWorklet.addModule('/modules/input/pcm-processor.js');
    workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');

    workletNode.port.onmessage = (ev) => {
      if (!transcribeWs || transcribeWs.readyState !== WebSocket.OPEN) return;
      if (!controlSent) {
        transcribeWs.send(JSON.stringify({ sampleRate: sr }));
        controlSent = true;
      }
      transcribeWs.send(ev.data);
    };

    const source = audioCtx.createMediaStreamSource(micStream);
    source.connect(workletNode);
  } catch (e) {
    log(`[MIC] AudioWorklet setup failed: ${e.message}, falling back to batch`);
    stopAudio();
    if (transcribeWs) { try { transcribeWs.close(); } catch (_) {} transcribeWs = null; }
    isRecording = false;
    startBatchFallback(micStream);
  }
}

// ── stopRecording ──
export function stopRecording() {
  if (!isRecording) return;
  const micBtn = document.getElementById('cmd-mic');
  const cmdInput = document.getElementById('cmd-input');

  // Batch fallback path
  if (fallbackRecorder) {
    if (fallbackRecorder.state !== 'inactive') fallbackRecorder.stop();
    return;
  }

  // Realtime path
  isRecording = false;
  if (micBtn) micBtn.classList.remove('recording');
  updateMicBtnVisual();
  log('[MIC] Recording stopped (realtime)');
  if (cmdInput) cmdInput.placeholder = 'Processing...';

  stopAudio();

  if (transcribeWs?.readyState === WebSocket.OPEN) {
    transcribeWs.send(JSON.stringify({ stop: true }));
  }

  // Safety timeout
  const wsRef = transcribeWs;
  setTimeout(() => {
    if (wsRef && wsRef === transcribeWs) {
      log('[STT-RT] Timeout waiting for transcription, sending partial');
      const text = pendingText || liveTranscript;
      if (text) sendToTerminal(text);
      pendingText = '';
      liveTranscript = '';
      try { wsRef.close(); } catch (_) {}
      transcribeWs = null;
      if (cmdInput) cmdInput.placeholder = 'Type command...';
    }
  }, 8000);
}
