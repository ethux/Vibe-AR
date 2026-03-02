// ─── Mistral Vibe AR — Boot sequence ───
import { log } from './modules/logging.js';
import { getXrSession, setXrSession, getTermWs } from './modules/state.js';
import { setStatus } from './modules/logging.js';
import { initTerminal } from './modules/terminal.js';
import { initScene } from './modules/scene.js';
import { startARSession } from './modules/ar-session.js';
import { startRecording, stopRecording, getIsRecording } from './modules/voice.js';

log(`[INIT] Mistral Vibe AR — ${navigator.userAgent.substring(0, 80)}`);

(async () => {
  try {
    initScene();
    await initTerminal();

    const btn = document.getElementById('btn-enter-ar');
    if (!btn) return;

    if (!navigator.xr) { btn.textContent = 'NO WEBXR'; btn.disabled = true; return; }
    let arOk = false;
    try { arOk = await navigator.xr.isSessionSupported('immersive-ar'); } catch {}
    log(`[XR] AR supported: ${arOk}`);
    if (!arOk) { btn.textContent = 'TRY AR'; setStatus('AR may not be supported'); }
    else setStatus('Ready — tap START AR');

    let busy = false;
    btn.addEventListener('click', async () => {
      if (busy) return; busy = true;
      btn.textContent = 'STARTING...'; btn.classList.add('loading');
      try {
        const xrSession = getXrSession();
        if (xrSession) await xrSession.end();
        else await startARSession();
      } catch (e) { log(`[XR] ${e.message}`); setStatus(`Error: ${e.message}`); }
      btn.textContent = getXrSession() ? 'EXIT AR' : 'START AR';
      btn.classList.remove('loading');
      setTimeout(() => { busy = false; }, 500);
    });

    // Command input bar
    const cmdInput = document.getElementById('cmd-input');
    const cmdSend = document.getElementById('cmd-send');
    function sendCmd() {
      const text = cmdInput.value;
      if (!text) { log('[CMD] Empty input'); return; }
      const termWs = getTermWs();
      if (!termWs) { log('[CMD] No WebSocket'); return; }
      if (termWs.readyState !== WebSocket.OPEN) { log(`[CMD] WS not open (state=${termWs.readyState})`); return; }
      termWs.send(new TextEncoder().encode('0' + text + '\r'));
      cmdInput.value = '';
      log(`[CMD] Sent: "${text}"`);
    }
    if (cmdInput) {
      cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendCmd(); }
      });
    }
    if (cmdSend) cmdSend.addEventListener('click', sendCmd);

    // Mic button
    const cmdMic = document.getElementById('cmd-mic');
    if (cmdMic) {
      cmdMic.addEventListener('click', () => {
        if (getIsRecording()) stopRecording();
        else startRecording();
      });
    }

    // Space = voice toggle
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.target !== document.body) return;
      e.preventDefault();
      if (getIsRecording()) stopRecording();
      else startRecording();
    });
  } catch (e) {
    log(`[INIT] Fatal: ${e.message}\n${e.stack}`);
    setStatus(`Error: ${e.message}`);
  }
})();
