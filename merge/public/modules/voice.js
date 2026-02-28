// ─── Voice (Mic button + batch transcription) ───
import { getTermWs, getTerm } from './state.js';
import { log } from './logging.js';
import { makeTextTexture } from './textures.js';
import { speakReply } from './tts.js';

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let micBtnMesh = null;

export function setMicBtnMesh(mesh) { micBtnMesh = mesh; }
export function getIsRecording() { return isRecording; }

async function transcribeAndSend(blob, mime) {
  const cmdInput = document.getElementById('cmd-input');
  try {
    log('[STT] Transcribing...');
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
    if (text?.trim()) {
      if (cmdInput) { cmdInput.value = text.trim(); cmdInput.placeholder = 'Type command...'; }
      const termWs = getTermWs();
      if (termWs?.readyState === WebSocket.OPEN) {
        termWs.send(new TextEncoder().encode('0' + text.trim() + '\r'));
        log(`[STT] Sent: "${text.trim()}"`);
        if (cmdInput) cmdInput.value = '';
        speakReply();
      }
    } else {
      if (cmdInput) cmdInput.placeholder = 'No speech detected';
      setTimeout(() => { if (cmdInput) cmdInput.placeholder = 'Type command...'; }, 2000);
    }
  } catch (e) {
    log(`[STT] ${e.message}`);
    if (cmdInput) cmdInput.placeholder = 'Type command...';
  }
}

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

export function startRecording() {
  const micBtn = document.getElementById('cmd-mic');
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/mp4';
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      transcribeAndSend(new Blob(audioChunks, { type: mime }), mime);
    };
    mediaRecorder.start();
    isRecording = true;
    if (micBtn) micBtn.classList.add('recording');
    updateMicBtnVisual();
    log('[MIC] Recording started');
  }).catch(e => log(`[MIC] ${e.message}`));
}

export function stopRecording() {
  const micBtn = document.getElementById('cmd-mic');
  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  isRecording = false;
  if (micBtn) micBtn.classList.remove('recording');
  updateMicBtnVisual();
  log('[MIC] Recording stopped');
}
