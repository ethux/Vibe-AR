// ─── AR session with DOM overlay for keyboard input ───
import { getRenderer, setXrSession } from './state.js';
import { log } from './logging.js';

export async function startARSession() {
  if (!navigator.xr) throw new Error('No WebXR');
  const renderer = getRenderer();
  if (!renderer) throw new Error('No renderer');

  log('[XR] Requesting AR...');
  const overlayRoot = document.getElementById('dom-overlay-root');
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'hit-test', 'dom-overlay'],
    domOverlay: overlayRoot ? { root: overlayRoot } : undefined,
  });

  if (session.domOverlayState) {
    log(`[XR] DOM overlay active: ${session.domOverlayState.type}`);
  } else {
    log('[XR] DOM overlay not available — keyboard input disabled in AR');
  }

  setXrSession(session);
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setSession(session);
  log('[XR] AR session active');

  document.getElementById('overlay')?.classList.add('hidden');
  document.body.classList.add('ar-active');

  session.addEventListener('end', () => {
    setXrSession(null);
    document.getElementById('overlay')?.classList.remove('hidden');
    document.body.classList.remove('ar-active');
    log('[XR] Session ended');
  });
}
