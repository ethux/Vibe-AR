// ── Draggable file-content window ────────────────────────────────────────────
const WINDOW_W   = 0.6;
const WINDOW_H   = 0.45;
const TITLEBAR_H = 0.06;

function makeTextTexture(text, fontSize, color, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// Window body
const bodyMat  = new THREE.MeshStandardMaterial({ color: 0x1e1e2e, side: THREE.DoubleSide, transparent: true, opacity: 0.92, roughness: 0.7, metalness: 0.1 });
const windowBody = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W, WINDOW_H), bodyMat);

// Title bar
const titleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a5c, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.15 });
const titleBar = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W, TITLEBAR_H), titleMat);
titleBar.position.set(0, WINDOW_H / 2 - TITLEBAR_H / 2, 0.001);
windowBody.add(titleBar);

// Title text
const titleTextMat = new THREE.MeshBasicMaterial({ map: makeTextTexture('My Window', 48, '#ffffff', 512, 64), transparent: true, depthWrite: false });
const titleText = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W * 0.8, TITLEBAR_H * 0.7), titleTextMat);
titleText.position.z = 0.002;
titleBar.add(titleText);

// Content area — patched with multi-line canvas
const contentMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
(function buildDefaultContent() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 384;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, 512, 384);
  ctx.fillStyle = '#ccccdd'; ctx.font = '28px Segoe UI, sans-serif';
  ['Welcome to Vibe-AR!', '', '✋ Open palm → show context', '🤏 Pinch left  → add to context', '🤏 Pinch right → open file', '👊 Fist right  → rotate scene']
    .forEach((l, i) => ctx.fillText(l, 30, 40 + i * 44));
  contentMat.map = new THREE.CanvasTexture(c);
  contentMat.map.minFilter = THREE.LinearFilter;
})();
const contentMesh = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W * 0.9, WINDOW_H * 0.7), contentMat);
contentMesh.position.set(0, -TITLEBAR_H / 2 - 0.01, 0.001);
windowBody.add(contentMesh);

// Border glow
const borderMat = new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
const border = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_W + 0.008, WINDOW_H + 0.008), borderMat);
border.position.z = -0.002;
windowBody.add(border);

// Traffic-light buttons
const btnGeo = new THREE.CircleGeometry(0.015, 24);
[
  [0xff5555, WINDOW_W / 2 - 0.035],
  [0xf1fa8c, WINDOW_W / 2 - 0.075],
  [0x50fa7b, WINDOW_W / 2 - 0.115],
].forEach(([color, x]) => {
  const btn = new THREE.Mesh(btnGeo.clone(), new THREE.MeshBasicMaterial({ color }));
  btn.position.set(x, 0, 0.003);
  titleBar.add(btn);
});

windowBody.position.set(0, 1.5, -0.8);
scene.add(windowBody);

// ── Update window content when a file is opened ───────────────────────────────
function showFileInWindow(name, content) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 384;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, 512, 384);
  ctx.fillStyle = '#ccccdd'; ctx.font = '14px monospace';
  content.split('\n').slice(0, 22).forEach((l, i) => ctx.fillText(l.substring(0, 55), 12, 20 + i * 16));
  contentMat.map = new THREE.CanvasTexture(c);
  contentMat.map.minFilter = THREE.LinearFilter;
  contentMat.needsUpdate = true;

  const tc = document.createElement('canvas'); tc.width = 512; tc.height = 64;
  const tctx = tc.getContext('2d');
  tctx.fillStyle = '#3a3a5c'; tctx.fillRect(0, 0, 512, 64);
  tctx.fillStyle = '#ffffff'; tctx.font = 'bold 28px monospace';
  tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
  tctx.fillText(name, 256, 32);
  titleTextMat.map = new THREE.CanvasTexture(tc);
  titleTextMat.map.minFilter = THREE.LinearFilter;
  titleTextMat.needsUpdate = true;
}
