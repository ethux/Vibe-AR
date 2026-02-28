import * as THREE from 'three';

// ─── DOM ───
const canvas = document.getElementById('xr-canvas');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusMsg = document.getElementById('status-msg');
const terminalFrame = document.getElementById('terminal-frame');
const btnAR = document.getElementById('btn-ar');
const btnMic = document.getElementById('btn-mic');
const btnReload = document.getElementById('btn-reload');

// ─── State ───
let xrSession = null;
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let ttydUrl = '/terminal/';

// ─── Three.js (minimal, for AR mode) ───
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
renderer.setAnimationLoop(() => renderer.render(scene, camera));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Status ───
function setStatus(text, state = 'ready') {
  statusText.textContent = text;
  statusDot.className = 'indicator';
  if (state === 'connecting') statusDot.classList.add('connecting');
  else if (state === 'error') statusDot.classList.add('error');
}

// ─── Load ttyd terminal ───
async function loadTerminal() {
  setStatus('Connecting to vibe...', 'connecting');

  // Get ttyd URL from server config
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    ttydUrl = config.ttydUrl || ttydUrl;
  } catch {}

  console.log('[INIT] Loading ttyd from:', ttydUrl);
  terminalFrame.src = ttydUrl;

  terminalFrame.onload = () => {
    setStatus('vibe running', 'ready');
    console.log('[INIT] ttyd iframe loaded');
  };

  terminalFrame.onerror = () => {
    setStatus('Failed to connect to vibe', 'error');
  };

  // Also check if ttyd is reachable
  try {
    const check = await fetch(ttydUrl, { mode: 'no-cors' });
    console.log('[INIT] ttyd reachable');
  } catch {
    setStatus('ttyd not running — start with: docker compose up', 'error');
    console.error('[INIT] ttyd not reachable at', ttydUrl);
  }
}

btnReload.addEventListener('click', () => {
  terminalFrame.src = 'about:blank';
  setTimeout(() => loadTerminal(), 500);
});

// ─── WebXR ───
async function startAR() {
  if (!navigator.xr) { setStatus('No WebXR', 'error'); return; }
  const supported = await navigator.xr.isSessionSupported('immersive-ar');
  if (!supported) { setStatus('AR not supported', 'error'); return; }

  try {
    const vibeWindow = document.getElementById('vibe-window');
    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'hit-test', 'dom-overlay'],
      domOverlay: { root: vibeWindow },
    });
    renderer.xr.setSession(xrSession);
    xrSession.addEventListener('end', () => {
      xrSession = null;
      btnAR.textContent = 'Start AR';
    });
    btnAR.textContent = 'Exit AR';
  } catch (err) {
    setStatus(`AR error: ${err.message}`, 'error');
  }
}

btnAR.addEventListener('click', () => {
  if (xrSession) xrSession.end();
  else startAR();
});

// ─── Voice Input (Voxtral STT → type into ttyd via postMessage) ───
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/mp4';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: mimeType });
      await transcribeAndSend(blob, mimeType);
    };

    mediaRecorder.start();
    isRecording = true;
    btnMic.classList.add('recording');
    setStatus('Listening...', 'connecting');
  } catch (err) {
    setStatus(`Mic error: ${err.message}`, 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  isRecording = false;
  btnMic.classList.remove('recording');
}

async function transcribeAndSend(audioBlob, mimeType) {
  setStatus('Transcribing...', 'connecting');
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    const start = performance.now();
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, mimeType }),
    });
    const data = await res.json();
    const elapsed = Math.round(performance.now() - start);
    statusMsg.textContent = `STT: ${elapsed}ms`;

    if (data.error) {
      setStatus('STT error', 'error');
      return;
    }

    const text = data.text || (data.segments || []).map(s => s.text).join(' ');
    if (text && text.trim()) {
      // Send transcribed text to ttyd's terminal via its WebSocket
      // ttyd uses a custom protocol: first byte 0 = input, then the data
      try {
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ttydWsUrl = `${wsProto}//${location.host}/terminal/ws`;
        const ttydWs = new WebSocket(ttydWsUrl);
        ttydWs.binaryType = 'arraybuffer';
        ttydWs.onopen = () => {
          const input = text.trim() + '\n';
          const buf = new Uint8Array(input.length + 1);
          buf[0] = 0; // ttyd input type
          for (let i = 0; i < input.length; i++) buf[i + 1] = input.charCodeAt(i);
          ttydWs.send(buf);
          ttydWs.close();
        };
      } catch (err) {
        console.error('[VOICE] Failed to send to ttyd:', err);
      }
      setStatus('vibe running', 'ready');
    } else {
      setStatus('No speech detected', 'ready');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  }
}

btnMic.addEventListener('click', () => {
  if (isRecording) stopRecording();
  else startRecording();
});

// ─── Init ───
console.log('[INIT] Mistral Vibe AR — ttyd mode');
loadTerminal();
