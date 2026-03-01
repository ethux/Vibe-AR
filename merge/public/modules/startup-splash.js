// ─── Vibe-AR startup splash — shown when XR session begins ───
// Black passthrough → "Vibe-AR" fades in from far, drifts closer,
// then rockets into the camera with a big fade-out while passthrough
// fades back to transparent.
//
// Usage:
//   import { createStartupSplash } from './startup-splash.js';
//   const splash = createStartupSplash(scene, renderer);
//   // inside render loop: splash.tick(xrCamera)
//   // check splash.done to know when to stop calling tick()

/**
 * Create a startup splash tied to a Three.js scene.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer  — used to grab the live XR camera each frame
 * @returns {{ tick(xrCam: THREE.Camera): void, done: boolean }}
 *
 * Timeline (total ≈ 5 s):
 *   0.0 – 1.2  "Vibe-AR" fades in, drifting from far → close in front of camera
 *   1.2 – 2.8  text gently hovers / breathes forward
 *   2.8 – 3.5  text rockets into the camera: huge scale + fade-out
 *   3.5 – 5.0  black overlay fades out → passthrough becomes transparent
 */
export function createStartupSplash(scene, renderer) {
  // ── helpers ──
  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }

  // ── 1. Black fullscreen quad — rendered in scene but always right in front ──
  //    We update its world position every tick to follow the XR camera.
  const overlayGeo = new THREE.PlaneGeometry(8, 8);  // big enough to fill FOV at 1.2 m
  const overlayMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const overlayMesh = new THREE.Mesh(overlayGeo, overlayMat);
  overlayMesh.renderOrder = 999;
  scene.add(overlayMesh);

  // ── 2. "Vibe-AR" text canvas texture (pixel art font) ──
  const tw = 1024, th = 256;
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, tw, th);
  // Pixel art font — disable anti-aliasing for crisp blocky look
  ctx.imageSmoothingEnabled = false;
  ctx.font = 'bold 160px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Pixel glow effect
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Vibe-AR', tw / 2, th / 2);

  const textTex = new THREE.CanvasTexture(canvas);
  textTex.minFilter = THREE.LinearFilter;

  const aspect = tw / th;   // ≈ 4
  const textH  = 0.30;      // metres tall
  const textGeo = new THREE.PlaneGeometry(textH * aspect, textH);
  const textMat = new THREE.MeshBasicMaterial({
    map: textTex,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const textMesh = new THREE.Mesh(textGeo, textMat);
  textMesh.renderOrder = 1000;
  scene.add(textMesh);

  // ── timing ──
  const T_FADE_IN_END  = 1.2;  // s fully visible
  const T_HOVER_END    = 2.8;  // s end gentle hover
  const T_BLAST_END    = 3.5;  // s text gone
  const T_OVERLAY_END  = 5.0;  // s overlay gone

  // Z offsets from camera (negative = in front)
  const Z_NEAR_OVERLAY = -1.2; // overlay sits here
  const Z_TEXT_START   = -4.0; // text starts far
  const Z_TEXT_HOVER   = -2.0; // resting position
  const Z_TEXT_BLAST   =  0.2; // flies past camera

  let startTime = null;
  let _done = false;

  // temp objects reused each tick
  const _camPos = new THREE.Vector3();
  const _camQuat = new THREE.Quaternion();
  const _forward = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const Y_OFFSET = 0.35;  // text sits below eye level, you look slightly up

  function cleanup() {
    scene.remove(overlayMesh);
    scene.remove(textMesh);
    overlayGeo.dispose(); overlayMat.dispose();
    textGeo.dispose(); textMat.dispose(); textTex.dispose();
    _done = true;
  }

  /**
   * Call once per XR frame from the render loop.
   * @param {THREE.Camera} xrCam  — renderer.xr.getCamera() (the actual XR camera)
   * @param {number} nowMs        — performance.now() / XR timestamp in ms
   */
  function tick(xrCam, nowMs) {
    if (_done) return;
    if (startTime === null) startTime = nowMs;
    const elapsed = (nowMs - startTime) / 1000;

    // Grab live XR camera world transform
    xrCam.getWorldPosition(_camPos);
    xrCam.getWorldQuaternion(_camQuat);

    // Forward vector in world space
    _forward.set(0, 0, -1).applyQuaternion(_camQuat);
    _up.set(0, 1, 0).applyQuaternion(_camQuat);

    // ── Keep black overlay glued right in front of XR camera ──
    overlayMesh.position.copy(_camPos).addScaledVector(_forward, -Z_NEAR_OVERLAY);
    overlayMesh.quaternion.copy(_camQuat);

    // ── Phase 1: Fade in + drift from far → hover ──
    if (elapsed < T_FADE_IN_END) {
      const t = clamp01(elapsed / T_FADE_IN_END);
      textMat.opacity = easeOutCubic(t);
      const zOff = lerp(Z_TEXT_START, Z_TEXT_HOVER + 0.5, easeOutCubic(t));
      textMesh.position.copy(_camPos).addScaledVector(_forward, -zOff).addScaledVector(_up, -Y_OFFSET);
      textMesh.quaternion.copy(_camQuat);
      textMesh.scale.setScalar(1.0);
    }

    // ── Phase 2: Gentle hover breath ──
    else if (elapsed < T_HOVER_END) {
      textMat.opacity = 1.0;
      const t = clamp01((elapsed - T_FADE_IN_END) / (T_HOVER_END - T_FADE_IN_END));
      const zOff = lerp(Z_TEXT_HOVER + 0.5, Z_TEXT_HOVER, easeOutCubic(t));
      textMesh.position.copy(_camPos).addScaledVector(_forward, -zOff).addScaledVector(_up, -Y_OFFSET);
      textMesh.quaternion.copy(_camQuat);
      const pulse = 1.0 + 0.04 * Math.sin(Math.PI * t);
      textMesh.scale.setScalar(pulse);
    }

    // ── Phase 3: Rocket toward camera ──
    else if (elapsed < T_BLAST_END) {
      const t = clamp01((elapsed - T_HOVER_END) / (T_BLAST_END - T_HOVER_END));
      const te = easeInCubic(t);
      const zOff = lerp(Z_TEXT_HOVER, Z_TEXT_BLAST, te);
      textMesh.position.copy(_camPos).addScaledVector(_forward, -zOff).addScaledVector(_up, -Y_OFFSET);
      textMesh.quaternion.copy(_camQuat);
      textMesh.scale.setScalar(lerp(1.0, 20.0, te));
      textMat.opacity = lerp(1.0, 0.0, easeOutCubic(t));
    }

    // ── Phase 4: Fade out black overlay ──
    else if (elapsed < T_OVERLAY_END) {
      textMesh.visible = false;
      const t = clamp01((elapsed - T_BLAST_END) / (T_OVERLAY_END - T_BLAST_END));
      overlayMat.opacity = lerp(1.0, 0.0, easeOutCubic(t));
    }

    // ── Done ──
    else {
      cleanup();
    }
  }

  return {
    tick,
    get done() { return _done; },
  };
}
