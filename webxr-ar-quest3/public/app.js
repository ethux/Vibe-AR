// ─── Mistral Vibe AR — 3D Terminal Panel ───
// xterm.js renders to canvas → Three.js CanvasTexture on 3D plane
// DOM overlay for keyboard input (browser + Quest 3 system keyboard)

// ─── Debug logging ───
function log(msg) {
  console.log(msg);
  const el = document.getElementById('debug-log');
  if (el) { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; }
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg }),
  }).catch(() => {});
}
window.onerror = (m, s, l, c, e) => log(`[ERR] ${m} at ${s}:${l}:${c}`);
window.addEventListener('unhandledrejection', e => log(`[ERR] ${e.reason}`));

// ─── State ───
let xrSession = null;
let renderer = null;
let termTexture = null;
let term = null;
let termWs = null;
let windowBody = null;
let titleBar = null;
let borderMat = null;
let titleMat = null;

// Expose for debugging
window._debug = () => {
  if (!term) return 'no term';
  const buf = term.buffer.active;
  const lines = [];
  for (let i = 0; i < Math.min(term.rows, 5); i++) {
    const line = buf.getLine(buf.viewportY + i);
    if (line) lines.push(line.translateToString(false).substring(0, 80));
  }
  return { rows: term.rows, cols: term.cols, cx: buf.cursorX, cy: buf.cursorY, base: buf.baseY, vp: buf.viewportY, len: buf.length, lines, ws: termWs?.readyState, tex: !!termTexture };
};

// Window size in meters
const WIN_W = 0.8;
const WIN_H = 0.55;
const TITLE_H = 0.05;

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
  log(`[STATUS] ${text}`);
}

// ─── Canvas text helper ───
function makeTextTexture(text, fontSize, color, bgColor, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bgColor && bgColor !== 'transparent') { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, w, h); }
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// ─── xterm.js init + ttyd WebSocket ───
async function initTerminal() {
  setStatus('Connecting to terminal...');

  let ttydBase = '/terminal';
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.ttydUrl) ttydBase = cfg.ttydUrl.replace(/\/$/, '');
  } catch (e) { log(`[TERM] config: ${e.message}`); }

  let token = '';
  try {
    const res = await fetch(`${ttydBase}/token`);
    const data = await res.json();
    token = data.token || '';
  } catch (e) { log(`[TERM] token: ${e.message}`); }

  const container = document.getElementById('xterm-container');
  term = new window.Terminal({
    cols: 100, rows: 35, fontSize: 14,
    fontFamily: "'Courier New', monospace",
    theme: { background: '#0c0c12', foreground: '#e0e0e0', cursor: '#ff6b00' },
    allowTransparency: false,
  });
  term.open(container);

  if (window.FitAddon) {
    const fa = new window.FitAddon.FitAddon();
    term.loadAddon(fa);
    try { fa.fit(); } catch {}
  }

  log(`[TERM] xterm: ${term.cols}x${term.rows}`);

  // Connect to ttyd
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${location.host}${ttydBase}/ws${token ? '?token=' + token : ''}`;
  log(`[TERM] WS: ${wsUrl}`);

  termWs = new WebSocket(wsUrl, ['tty']);
  termWs.binaryType = 'arraybuffer';

  const textEncoder = new TextEncoder();
  termWs.onopen = () => {
    log('[TERM] WS connected');
    setStatus('Terminal connected — tap START AR');
    // ttyd protocol: first message MUST be JSON with AuthToken + terminal size
    const initMsg = JSON.stringify({ AuthToken: token, columns: term.cols, rows: term.rows });
    termWs.send(textEncoder.encode(initMsg));
    log(`[TERM] Sent auth+size: ${term.cols}x${term.rows}`);
  };
  termWs.onclose = () => { log('[TERM] WS closed'); setStatus('Terminal disconnected'); };
  termWs.onerror = () => { log('[TERM] WS error'); setStatus('Terminal error'); };

  const textDecoder = new TextDecoder();
  let msgCount = 0;
  termWs.onmessage = (evt) => {
    msgCount++;
    const data = evt.data;
    if (typeof data === 'string') {
      if (msgCount <= 3) log(`[TERM] str msg: ${data.substring(0, 60)}`);
      term.write(data);
    } else {
      const arr = new Uint8Array(data);
      const cmd = String.fromCharCode(arr[0]); // ASCII command char
      const payload = arr.slice(1);
      if (msgCount <= 3) log(`[TERM] bin cmd='${cmd}' len=${payload.length}`);
      switch (cmd) {
        case '0': // OUTPUT
          term.write(payload);
          onTermOutput(textDecoder.decode(payload));
          break;
        case '1': // SET_WINDOW_TITLE
          document.title = textDecoder.decode(payload);
          break;
        case '2': // SET_PREFERENCES
          break;
      }
    }
  };

  // ttyd protocol: ASCII "0" + input data
  term.onData((data) => {
    if (termWs && termWs.readyState === WebSocket.OPEN) {
      termWs.send(textEncoder.encode('0' + data));
    }
  });

  // ttyd protocol: ASCII "1" + JSON resize
  term.onResize(({ cols, rows }) => {
    if (termWs && termWs.readyState === WebSocket.OPEN) {
      termWs.send(textEncoder.encode('1' + JSON.stringify({ columns: cols, rows })));
    }
  });
}

// ─── Terminal canvas for texture ───
// xterm v5 may use webgl or canvas internally. We try to grab that canvas first.
// Fallback: render terminal buffer to our own canvas.
const termRenderCanvas = document.createElement('canvas');
termRenderCanvas.width = 1024;
termRenderCanvas.height = 768;
const termRenderCtx = termRenderCanvas.getContext('2d');

let canvasSearchLogged = false;
function getTermCanvas() {
  // Try xterm's internal canvas first — search everywhere under the container
  const container = document.getElementById('xterm-container');
  const canvases = container.querySelectorAll('canvas');
  if (!canvasSearchLogged) {
    log(`[TERM] Canvas search: found ${canvases.length} canvases`);
    canvases.forEach((c, i) => log(`[TERM]   canvas[${i}]: ${c.width}x${c.height} class=${c.className}`));
    canvasSearchLogged = true;
  }
  let best = null;
  canvases.forEach(c => { if (!best || c.width * c.height > best.width * best.height) best = c; });
  if (best && best.width > 50) return best;

  // Fallback: render terminal text to our own canvas
  renderTermToCanvas();
  return termRenderCanvas;
}

function renderTermToCanvas() {
  if (!term) return;
  const ctx = termRenderCtx;
  const W = termRenderCanvas.width;
  const H = termRenderCanvas.height;
  const rows = term.rows;
  const cols = term.cols;
  const charW = Math.floor(W / cols);
  const lineH = Math.floor(H / rows);

  ctx.fillStyle = '#0c0c12';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `${lineH - 2}px "Courier New", monospace`;
  ctx.textBaseline = 'top';

  const buf = term.buffer.active;

  for (let row = 0; row < rows; row++) {
    const line = buf.getLine(buf.viewportY + row);
    if (!line) continue;

    const lineStr = line.translateToString(false);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillText(lineStr, 4, row * lineH + 2);
  }

  // Cursor
  ctx.fillStyle = '#ff6b00';
  ctx.globalAlpha = 0.8;
  ctx.fillRect(4 + buf.cursorX * charW, buf.cursorY * lineH, charW, lineH);
  ctx.globalAlpha = 1.0;
}

// ─── Build 3D floating terminal window ───
function build3DWindow(scene) {
  // Body
  const bodyGeo = new THREE.PlaneGeometry(WIN_W, WIN_H);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0c0c12, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    roughness: 0.7, metalness: 0.1,
  });
  windowBody = new THREE.Mesh(bodyGeo, bodyMat);
  windowBody.position.set(0, 1.4, -0.7);
  scene.add(windowBody);

  // Border glow
  const borderGeo = new THREE.PlaneGeometry(WIN_W + 0.012, WIN_H + 0.012);
  borderMat = new THREE.MeshBasicMaterial({ color: 0xff6b00, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const border = new THREE.Mesh(borderGeo, borderMat);
  border.position.z = -0.002;
  windowBody.add(border);

  // Title bar
  const titleGeo = new THREE.PlaneGeometry(WIN_W, TITLE_H);
  titleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.15 });
  titleBar = new THREE.Mesh(titleGeo, titleMat);
  titleBar.position.y = WIN_H / 2 - TITLE_H / 2;
  titleBar.position.z = 0.001;
  windowBody.add(titleBar);

  // Title text
  const ttGeo = new THREE.PlaneGeometry(WIN_W * 0.5, TITLE_H * 0.65);
  const ttMat = new THREE.MeshBasicMaterial({
    map: makeTextTexture('mistral vibe', 40, '#ff6b00', '#2a2a3e', 512, 48),
    transparent: true, depthWrite: false,
  });
  titleBar.add(new THREE.Mesh(ttGeo, ttMat)).position.z = 0.002;

  // Mac dots
  const dotGeo = new THREE.CircleGeometry(0.007, 16);
  [0xff5f57, 0xfebc2e, 0x28c840].forEach((col, i) => {
    const d = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: col }));
    d.position.set(-WIN_W / 2 + 0.025 + i * 0.022, 0, 0.003);
    titleBar.add(d);
  });

  // Keyboard button (right side of title bar) — large enough to click/tap
  const kbBtnGeo = new THREE.PlaneGeometry(0.10, TITLE_H * 0.85);
  const kbBtnMat = new THREE.MeshBasicMaterial({
    map: makeTextTexture('KB', 32, '#ffffff', '#ff6b00', 128, 48),
    transparent: false, depthWrite: true,
  });
  const kbBtn = new THREE.Mesh(kbBtnGeo, kbBtnMat);
  kbBtn.name = 'kb-btn';
  kbBtn.position.set(WIN_W / 2 - 0.065, 0, 0.004);
  titleBar.add(kbBtn);

  // Mic button (next to KB on title bar)
  const micBtnGeo = new THREE.PlaneGeometry(0.10, TITLE_H * 0.85);
  const micBtnMat = new THREE.MeshBasicMaterial({
    map: makeTextTexture('MIC', 28, '#ffffff', '#28c840', 128, 48),
    transparent: false, depthWrite: true,
  });
  const micBtn = new THREE.Mesh(micBtnGeo, micBtnMat);
  micBtn.name = 'mic-btn';
  micBtn.position.set(WIN_W / 2 - 0.175, 0, 0.004);
  titleBar.add(micBtn);

  // Terminal content plane
  const cH = WIN_H - TITLE_H - 0.01;
  const cGeo = new THREE.PlaneGeometry(WIN_W - 0.008, cH);
  const cMat = new THREE.MeshBasicMaterial({ color: 0x0c0c12, side: THREE.DoubleSide });
  const cMesh = new THREE.Mesh(cGeo, cMat);
  cMesh.position.y = -TITLE_H / 2 - 0.005;
  cMesh.position.z = 0.001;
  windowBody.add(cMesh);

  return { contentMesh: cMesh, contentMat: cMat, kbBtn, micBtn };
}

// ─── 3D Virtual Keyboard ───
const KB_KEY_W = 0.065;
const KB_KEY_H = 0.04;
const KB_GAP = 0.005;
const KB_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L','\''],
  ['Z','X','C','V','B','N','M',',','.','/'],
];
const KB_SPECIAL = { SPACE: ' ', BACK: null, SEND: null };

let kbGroup = null;       // THREE.Group holding all keyboard meshes
let kbKeyMeshes = [];     // { mesh, char } for raycasting
let kbInputText = '';     // current typed text
let kbInputMesh = null;   // mesh displaying typed text
let kbInputCanvas = null;
let kbInputCtx = null;
let kbInputTexture = null;
let kbVisible = false;

function build3DKeyboard(parent) {
  kbGroup = new THREE.Group();
  kbGroup.visible = false;
  parent.add(kbGroup);

  // Position below the terminal window
  kbGroup.position.set(0, -(WIN_H / 2 + 0.03), 0.005);

  // Input display bar
  const barW = WIN_W - 0.02;
  const barH = 0.04;
  kbInputCanvas = document.createElement('canvas');
  kbInputCanvas.width = 1024; kbInputCanvas.height = 64;
  kbInputCtx = kbInputCanvas.getContext('2d');
  kbInputTexture = new THREE.CanvasTexture(kbInputCanvas);
  kbInputTexture.minFilter = THREE.LinearFilter;
  updateKbInputDisplay();

  const barGeo = new THREE.PlaneGeometry(barW, barH);
  const barMat = new THREE.MeshBasicMaterial({ map: kbInputTexture });
  kbInputMesh = new THREE.Mesh(barGeo, barMat);
  kbInputMesh.position.y = 0;
  kbGroup.add(kbInputMesh);

  // Build key rows
  const startY = -(barH / 2 + KB_GAP);

  KB_ROWS.forEach((row, ri) => {
    const rowW = row.length * KB_KEY_W + (row.length - 1) * KB_GAP;
    const offsetX = -rowW / 2 + KB_KEY_W / 2;
    const y = startY - ri * (KB_KEY_H + KB_GAP) - KB_KEY_H / 2;

    row.forEach((ch, ci) => {
      const x = offsetX + ci * (KB_KEY_W + KB_GAP);
      const mesh = makeKeyMesh(ch, KB_KEY_W, KB_KEY_H, '#1a1a2e', '#e0e0e0');
      mesh.position.set(x, y, 0);
      kbGroup.add(mesh);
      kbKeyMeshes.push({ mesh, char: ch });
    });
  });

  // Bottom row: BACK | SPACE | SEND
  const bottomY = startY - KB_ROWS.length * (KB_KEY_H + KB_GAP) - KB_KEY_H / 2;
  const spaceW = 0.35;
  const specialW = 0.12;

  const backMesh = makeKeyMesh('\u2190', specialW, KB_KEY_H, '#3a1a1a', '#ff5f57');
  backMesh.position.set(-(spaceW / 2 + KB_GAP + specialW / 2), bottomY, 0);
  kbGroup.add(backMesh);
  kbKeyMeshes.push({ mesh: backMesh, char: 'BACK' });

  const spaceMesh = makeKeyMesh('SPACE', spaceW, KB_KEY_H, '#1a1a2e', '#888888');
  spaceMesh.position.set(0, bottomY, 0);
  kbGroup.add(spaceMesh);
  kbKeyMeshes.push({ mesh: spaceMesh, char: ' ' });

  const sendMesh = makeKeyMesh('SEND', specialW, KB_KEY_H, '#1a3a1a', '#28c840');
  sendMesh.position.set(spaceW / 2 + KB_GAP + specialW / 2, bottomY, 0);
  kbGroup.add(sendMesh);
  kbKeyMeshes.push({ mesh: sendMesh, char: 'SEND' });

  // Background panel
  const bgH = (KB_ROWS.length + 1) * (KB_KEY_H + KB_GAP) + barH + KB_GAP * 2;
  const bgGeo = new THREE.PlaneGeometry(WIN_W, bgH);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x0a0a14, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.position.set(0, -(bgH / 2 - barH / 2), -0.002);
  kbGroup.add(bg);

  log('[KB] 3D keyboard built');
}

function makeKeyMesh(label, w, h, bgColor, textColor) {
  const geo = new THREE.PlaneGeometry(w, h);
  const tex = makeTextTexture(label, 28, textColor, bgColor, 128, 64);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  return new THREE.Mesh(geo, mat);
}

function updateKbInputDisplay() {
  if (!kbInputCtx) return;
  const ctx = kbInputCtx;
  const W = kbInputCanvas.width, H = kbInputCanvas.height;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#ff6b00';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.fillStyle = '#e0e0e0';
  ctx.font = 'bold 32px monospace';
  ctx.textBaseline = 'middle';
  // Show cursor
  const display = kbInputText + '\u2588';
  ctx.fillText(display, 12, H / 2);
  if (kbInputTexture) kbInputTexture.needsUpdate = true;
}

function handleKbKeyPress(char) {
  if (char === 'BACK') {
    kbInputText = kbInputText.slice(0, -1);
  } else if (char === 'SEND') {
    if (kbInputText && termWs && termWs.readyState === WebSocket.OPEN) {
      termWs.send(new TextEncoder().encode('0' + kbInputText + '\r'));
      log(`[KB] Sent: "${kbInputText}"`);
      kbInputText = '';
    }
  } else {
    kbInputText += char.length === 1 ? char.toLowerCase() : char;
  }
  updateKbInputDisplay();
}

function toggleKb3D() {
  if (!kbGroup) return;
  kbVisible = !kbVisible;
  kbGroup.visible = kbVisible;
  log(`[KB] 3D keyboard ${kbVisible ? 'shown' : 'hidden'}`);
}

// ─── Scene ───
let scene, camera, clock, contentMat, kbBtnMesh, micBtnMesh, micBtnMat;

function initScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 100);
  camera.position.set(0, 1.6, 0);
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(2, 4, 3);
  scene.add(dl);

  const win = build3DWindow(scene);
  contentMat = win.contentMat;
  kbBtnMesh = win.kbBtn;
  micBtnMesh = win.micBtn;
  micBtnMat = micBtnMesh.material;

  // Build 3D keyboard attached to the terminal window
  build3DKeyboard(windowBody);

  // Controllers
  const ctrl0 = renderer.xr.getController(0);
  const ctrl1 = renderer.xr.getController(1);
  scene.add(ctrl0); scene.add(ctrl1);

  function addRay(c) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-3)]);
    c.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff6b00 })));
  }
  addRay(ctrl0); addRay(ctrl1);

  scene.add(renderer.xr.getControllerGrip(0));
  scene.add(renderer.xr.getControllerGrip(1));

  // ── Controller drag ──
  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  let dragging = false, activeCtrl = null, dragOffset = new THREE.Vector3();

  function onSelStart(e) {
    const c = e.target;
    tempMatrix.identity().extractRotation(c.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
    raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMatrix);

    // Check mic button
    if (micBtnMesh) {
      const micHits = raycaster.intersectObject(micBtnMesh);
      if (micHits.length) { toggleMicFromBtn(); return; }
    }

    // Check keyboard button
    if (kbBtnMesh) {
      const kbHits = raycaster.intersectObject(kbBtnMesh);
      if (kbHits.length) { toggleKb3D(); return; }
    }

    // Check 3D keyboard keys
    if (kbVisible && kbKeyMeshes.length) {
      const keyMeshList = kbKeyMeshes.map(k => k.mesh);
      const keyHits = raycaster.intersectObjects(keyMeshList);
      if (keyHits.length) {
        const hit = kbKeyMeshes.find(k => k.mesh === keyHits[0].object);
        if (hit) { handleKbKeyPress(hit.char); return; }
      }
    }

    const hits = raycaster.intersectObject(titleBar, true);
    if (hits.length) {
      dragging = true; activeCtrl = c;
      dragOffset.copy(windowBody.position).sub(hits[0].point);
      borderMat.opacity = 0.6; titleMat.color.set(0x4a4a6c);
    }
  }
  function onSelEnd(e) {
    if (dragging && e.target === activeCtrl) {
      dragging = false; activeCtrl = null;
      borderMat.opacity = 0.25; titleMat.color.set(0x2a2a3e);
    }
  }
  ctrl0.addEventListener('selectstart', onSelStart); ctrl0.addEventListener('selectend', onSelEnd);
  ctrl1.addEventListener('selectstart', onSelStart); ctrl1.addEventListener('selectend', onSelEnd);

  // ── Hand tracking ──
  const hs = [
    { pinching: false, dragging: false, off: new THREE.Vector3() },
    { pinching: false, dragging: false, off: new THREE.Vector3() },
  ];

  function jointPos(src, name, frame, ref) {
    const j = src.hand.get(name);
    if (!j) return null;
    const pose = frame.getJointPose(j, ref);
    if (!pose) return null;
    const p = pose.transform.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  function pinch(src, frame, ref) {
    const t = jointPos(src, 'thumb-tip', frame, ref);
    const i = jointPos(src, 'index-finger-tip', frame, ref);
    if (!t || !i) return { ok: false, pt: null };
    return { ok: t.distanceTo(i) < 0.025, pt: t.clone().lerp(i, 0.5) };
  }

  // ── Render loop ──
  renderer.setAnimationLoop((ts, frame) => {
    const elapsed = clock.getElapsedTime();

    // Terminal texture — wait until WS is connected before binding
    if (contentMat && termWs && termWs.readyState === WebSocket.OPEN) {
      if (!termTexture) {
        renderTermToCanvas();
        termTexture = new THREE.CanvasTexture(termRenderCanvas);
        termTexture.minFilter = THREE.LinearFilter;
        termTexture.magFilter = THREE.LinearFilter;
        contentMat.map = termTexture;
        contentMat.color.set(0xffffff); // White so texture shows unmodified
        contentMat.needsUpdate = true;
        log('[TERM] Texture bound');
      }
      renderTermToCanvas();
      termTexture.needsUpdate = true;
    }

    // Controller drag
    if (dragging && activeCtrl) {
      tempMatrix.identity().extractRotation(activeCtrl.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(activeCtrl.matrixWorld);
      raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMatrix);
      const d = windowBody.position.distanceTo(raycaster.ray.origin);
      const tgt = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(d)).add(dragOffset);
      windowBody.position.lerp(tgt, 0.5);
      camera.getWorldPosition(tgt);
      windowBody.lookAt(tgt);
    }

    // Hand tracking
    if (frame && renderer.xr.isPresenting) {
      const sess = renderer.xr.getSession();
      const ref = renderer.xr.getReferenceSpace();
      if (sess && ref) {
        for (const src of sess.inputSources) {
          if (!src.hand) continue;
          const s = hs[src.handedness === 'left' ? 0 : 1];
          const p = pinch(src, frame, ref);
          if (p.ok && !s.pinching && !dragging) {
            s.pinching = true;
            if (p.pt) {
              // Check MIC button
              if (micBtnMesh) {
                const mw = new THREE.Vector3(); micBtnMesh.getWorldPosition(mw);
                if (p.pt.distanceTo(mw) < 0.06) { toggleMicFromBtn(); continue; }
              }
              // Check KB toggle button
              if (kbBtnMesh) {
                const bw = new THREE.Vector3(); kbBtnMesh.getWorldPosition(bw);
                if (p.pt.distanceTo(bw) < 0.06) { toggleKb3D(); continue; }
              }
              // Check 3D keyboard keys
              if (kbVisible && kbKeyMeshes.length) {
                let hitKey = false;
                for (const k of kbKeyMeshes) {
                  const kw = new THREE.Vector3(); k.mesh.getWorldPosition(kw);
                  if (p.pt.distanceTo(kw) < 0.035) {
                    handleKbKeyPress(k.char); hitKey = true; break;
                  }
                }
                if (hitKey) continue;
              }
              // Title bar drag
              const tw = new THREE.Vector3(); titleBar.getWorldPosition(tw);
              if (p.pt.distanceTo(tw) < 0.15) {
                s.dragging = true;
                s.off.copy(windowBody.position).sub(p.pt);
                borderMat.opacity = 0.6; titleMat.color.set(0x4a4a6c);
              }
            }
          } else if (!p.ok && s.pinching) {
            s.pinching = false;
            if (s.dragging) { s.dragging = false; borderMat.opacity = 0.25; titleMat.color.set(0x2a2a3e); }
          }
          if (s.dragging && p.pt) {
            const tgt = p.pt.clone().add(s.off);
            windowBody.position.lerp(tgt, 0.4);
            const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
            windowBody.lookAt(cp);
          }
        }
      }
    }

    // Idle float
    if (windowBody && !dragging && !hs[0].dragging && !hs[1].dragging) {
      windowBody.position.y += Math.sin(elapsed * 0.8) * 0.0002;
    }

    renderer.render(scene, camera);
  });

  // ── Mouse click on 3D elements (browser) ──
  const mouseRaycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (e) => {
    if (renderer.xr.isPresenting) return;
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / innerHeight) * 2 + 1;
    mouseRaycaster.setFromCamera(mouse, camera);

    // MIC button
    if (micBtnMesh) {
      const micHits = mouseRaycaster.intersectObject(micBtnMesh);
      if (micHits.length) { toggleMicFromBtn(); return; }
    }

    // KB toggle button
    if (kbBtnMesh) {
      const hits = mouseRaycaster.intersectObject(kbBtnMesh);
      if (hits.length) { toggleKb3D(); return; }
    }

    // 3D keyboard keys
    if (kbVisible && kbKeyMeshes.length) {
      const keyMeshList = kbKeyMeshes.map(k => k.mesh);
      const keyHits = mouseRaycaster.intersectObjects(keyMeshList);
      if (keyHits.length) {
        const hit = kbKeyMeshes.find(k => k.mesh === keyHits[0].object);
        if (hit) { handleKbKeyPress(hit.char); return; }
      }
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  log('[INIT] Scene ready');
}

// toggleKeyboardInput kept for backward compat — now delegates to 3D keyboard
function toggleKeyboardInput() { toggleKb3D(); }

// ─── AR session with DOM overlay for keyboard input ───
async function startARSession() {
  if (!navigator.xr) throw new Error('No WebXR');
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

  xrSession = session;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setSession(session);
  log('[XR] AR session active');

  document.getElementById('overlay')?.classList.add('hidden');
  document.body.classList.add('ar-active');

  session.addEventListener('end', () => {
    xrSession = null;
    document.getElementById('overlay')?.classList.remove('hidden');
    document.body.classList.remove('ar-active');
    log('[XR] Session ended');
  });
}

// ─── Voice (Mic button + batch transcription) ───
let isRecording = false, mediaRecorder = null, audioChunks = [];

async function transcribeAndSend(blob, mime) {
  const cmdInput = document.getElementById('cmd-input');
  try {
    log('[STT] Transcribing...');
    if (cmdInput) cmdInput.placeholder = 'Transcribing...';
    const ab = await blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
    const res = await fetch('/api/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: b64, mimeType: mime }),
    });
    const data = await res.json();
    const text = data.text || (data.segments || []).map(s => s.text).join(' ');
    if (text?.trim()) {
      if (cmdInput) { cmdInput.value = text.trim(); cmdInput.placeholder = 'Type command...'; }
      // Auto-send to terminal
      if (termWs?.readyState === WebSocket.OPEN) {
        termWs.send(new TextEncoder().encode('0' + text.trim() + '\r'));
        log(`[STT] Sent: "${text.trim()}"`);
        if (cmdInput) cmdInput.value = '';
        // Enable TTS for this response
        ttsCollecting = true;
        ttsBuffer = '';
        ttsLineCount = 0;
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

function toggleMicFromBtn() {
  if (isRecording) stopRecording();
  else startRecording();
}

function updateMicBtnVisual() {
  if (!micBtnMesh) return;
  micBtnMesh.material.map = isRecording
    ? makeTextTexture('REC', 28, '#ffffff', '#ff2020', 128, 48)
    : makeTextTexture('MIC', 28, '#ffffff', '#28c840', 128, 48);
  micBtnMesh.material.needsUpdate = true;
}

function startRecording() {
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

function stopRecording() {
  const micBtn = document.getElementById('cmd-mic');
  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  isRecording = false;
  if (micBtn) micBtn.classList.remove('recording');
  updateMicBtnVisual();
  log('[MIC] Recording stopped');
}

// ─── TTS (ElevenLabs) — speak terminal responses ───
let ttsCollecting = false;
let ttsBuffer = '';
let ttsLineCount = 0;
let ttsTimeout = null;
let ttsSpeaking = false;

function onTermOutput(text) {
  if (!ttsCollecting) return;
  ttsBuffer += text;
  ttsLineCount += (text.match(/\n/g) || []).length;

  // Reset the idle timer — after 1.5s of no output, assume response is done
  clearTimeout(ttsTimeout);
  ttsTimeout = setTimeout(() => finishTtsCollect(), 1500);

  // Safety cap
  if (ttsLineCount > 40) finishTtsCollect();
}

function finishTtsCollect() {
  clearTimeout(ttsTimeout);
  ttsCollecting = false;
  // Clean ANSI codes and extract readable text
  const clean = ttsBuffer
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // strip ANSI escapes
    .replace(/\x1b\][^\x07]*\x07/g, '')       // strip OSC sequences
    .replace(/[\x00-\x1f]/g, '\n')            // control chars → newlines
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join(' ')
    .trim();

  ttsBuffer = '';
  ttsLineCount = 0;

  if (clean.length < 10) { log('[TTS] Response too short, skipping'); return; }
  if (/^(root@|\$|#|>)\s*$/.test(clean)) return;

  const ttsText = clean.length > 500 ? clean.substring(0, 500) + '...' : clean;
  log(`[TTS] Speaking ${ttsText.length} chars`);
  speakTTS(ttsText);
}

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
    const arrayBuffer = await res.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.onended = () => { ttsSpeaking = false; };
    source.start();
    log('[TTS] Playing audio');
  } catch (e) {
    log(`[TTS] ${e.message}`);
    ttsSpeaking = false;
  }
}

// ─── Boot ───
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
        if (xrSession) await xrSession.end();
        else await startARSession();
      } catch (e) { log(`[XR] ${e.message}`); setStatus(`Error: ${e.message}`); }
      btn.textContent = xrSession ? 'EXIT AR' : 'START AR';
      btn.classList.remove('loading');
      setTimeout(() => { busy = false; }, 500);
    });

    // Command input bar — sends text to terminal
    const cmdInput = document.getElementById('cmd-input');
    const cmdSend = document.getElementById('cmd-send');
    function sendCmd() {
      const text = cmdInput.value;
      if (!text) { log('[CMD] Empty input'); return; }
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

    // Mic button — tap to start/stop recording
    const cmdMic = document.getElementById('cmd-mic');
    if (cmdMic) {
      cmdMic.addEventListener('click', () => {
        if (isRecording) stopRecording();
        else startRecording();
      });
    }

    // Space = voice toggle (when body focused, not in input)
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.target !== document.body) return;
      e.preventDefault();
      if (isRecording) stopRecording();
      else startRecording();
    });
  } catch (e) {
    log(`[INIT] Fatal: ${e.message}\n${e.stack}`);
    setStatus(`Error: ${e.message}`);
  }
})();
