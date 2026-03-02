// ─── AR session with DOM overlay for keyboard input ───
import { getRenderer, setXrSession, setActiveSplash, getScene } from './core/state.js';
import { log } from './core/logging.js';
import { createStartupSplash } from './startup-splash.js';

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

  // ── Startup splash ──
  // getScene() is already initialised (initScene() ran in main.js before this)
  const splashScene = getScene();
  if (splashScene) {
    setActiveSplash(createStartupSplash(splashScene, renderer));
  }

  session.addEventListener('end', () => {
    setXrSession(null);
    document.getElementById('overlay')?.classList.remove('hidden');
    document.body.classList.remove('ar-active');
    log('[XR] Session ended');
  });
}
