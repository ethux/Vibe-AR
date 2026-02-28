// ── XR Session init ───────────────────────────────────────────────────────────
const vrButton = document.getElementById('enter-vr');
vrButton.textContent = 'Enter AR';

const XR_SESSION_MODE = 'immersive-ar';
const XR_FEATURES = {
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['bounded-floor', 'hand-tracking', 'hit-test'],
};

async function startSession() {
  const session = await navigator.xr.requestSession(XR_SESSION_MODE, XR_FEATURES);
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setSession(session);
  document.getElementById('overlay').style.display = 'none';
  session.addEventListener('end', () => { document.getElementById('overlay').style.display = 'flex'; });
}

async function initXR() {
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    vrButton.textContent = 'HTTPS required';
    vrButton.disabled = true;
    document.getElementById('info').textContent = '⚠️ WebXR requires HTTPS.';
    return;
  }
  if (!navigator.xr) {
    vrButton.textContent = 'WebXR not supported';
    vrButton.disabled = true;
    document.getElementById('info').textContent = '⚠️ navigator.xr not found.';
    return;
  }

  let arSupported = false;
  try { arSupported = await navigator.xr.isSessionSupported('immersive-ar'); } catch {}

  vrButton.addEventListener('click', async () => {
    try {
      await startSession();
    } catch (err) {
      vrButton.textContent = 'AR not available';
      document.getElementById('info').textContent = '⚠️ ' + err.message;
    }
  });
  if (!arSupported) vrButton.textContent = 'Enter AR (unconfirmed)';
}
initXR();
