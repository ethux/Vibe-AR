// ── File Bubbles – icons, creation, file loading ─────────────────────────────
const EXT_COLORS = {
  js: 0xf7df1e, ts: 0x3178c6, tsx: 0x61dafb, jsx: 0x61dafb,
  py: 0x3776ab, css: 0x264de4, html: 0xe34c26,
  json: 0x50fa7b, md: 0xffffff, yaml: 0xff9900, yml: 0xff9900,
  rs: 0xce422b, go: 0x00add8, rb: 0xcc342d, sh: 0x4eaa25,
  txt: 0x888899, env: 0x888899, pem: 0x888899, lock: 0x555555,
  default: 0xFF7000,
};
const EXT_ICON = {
  js:'js', ts:'ts', tsx:'tsx', jsx:'jsx', css:'css', html:'html',
  json:'json', md:'md', py:'py', yaml:'yaml', yml:'yaml',
  go:'go', rs:'rust', rb:'ruby', sh:'shell', txt:'txt',
  env:'env', svg:'svg', png:'png', docker:'docker', git:'git',
  conf:'conf', node:'node', npm:'npm',
};
const FOLDER_ICON = {
  src:'src', components:'components', hooks:'hooks', public:'public',
  styles:'styles', test:'test', node_modules:'node_modules',
  api:'api', config:'config', routes:'routes', services:'services',
};

const fileBubbles = [];
let openedBubble = null;
let currentPath  = 'Mistral_AI_Hackathon_2026_Paris_Vibe_AR';

function _ext(fileData) {
  return (fileData.ext || fileData.name.split('.').pop() || '').toLowerCase();
}

function getIconPath(fileData) {
  if (fileData.type === 'folder') {
    return 'icons/folders/' + (FOLDER_ICON[fileData.name.toLowerCase()] || 'folder') + '.svg';
  }
  const ext = _ext(fileData);
  return EXT_ICON[ext] ? 'icons/files/' + EXT_ICON[ext] + '.svg' : null;
}

function loadImg(src) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function buildBubbleTexture(fileData, color, iconImg) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  if (iconImg) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(iconImg, 0, 0, S, S);
  } else {
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  return tex;
}

function _makeLabelSprite(name, cardW) {
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 48;
  const lctx = lc.getContext('2d');
  lctx.clearRect(0, 0, 256, 48);
  lctx.fillStyle = 'rgba(10,10,20,0.75)'; lctx.fillRect(4, 2, 248, 44);
  lctx.fillStyle = '#ffffff'; lctx.font = 'bold 22px monospace';
  lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
  const dn = name.length > 16 ? name.substring(0, 14) + '..' : name;
  lctx.fillText(dn, 128, 24);
  const ltex = new THREE.CanvasTexture(lc); ltex.minFilter = THREE.LinearFilter;
  const lsp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ltex, transparent: true, depthWrite: false, sizeAttenuation: true }));
  lsp.scale.set(cardW * 2.2, cardW * 0.42, 1);
  lsp.renderOrder = 2;
  return lsp;
}

function createFileBubble(fileData, index, total) {
  const ext   = _ext(fileData);
  const color = EXT_COLORS[ext] || (fileData.type === 'folder' ? 0xFF7000 : EXT_COLORS.default);
  const cardW = fileData.type === 'folder' ? 0.11 : 0.095;
  const group = new THREE.Group();
  group.userData = { fileData, opened: false, color, cardW, index };

  // Placeholder sprite
  const placeholderMat = new THREE.SpriteMaterial({ color, transparent: true, opacity: 0.6, sizeAttenuation: true });
  const placeholder = new THREE.Sprite(placeholderMat);
  placeholder.scale.set(cardW, cardW, 1);
  placeholder.renderOrder = 1;
  group.userData.cardSprite = placeholder;
  scene.add(placeholder);

  // Async icon load → swap texture
  loadImg(getIconPath(fileData)).then(iconImg => {
    const mat = new THREE.SpriteMaterial({ map: buildBubbleTexture(fileData, color, iconImg), transparent: true, depthWrite: false, sizeAttenuation: true });
    placeholder.material = mat;
    placeholder.scale.set(cardW, cardW, 1);
  });

  // Label
  const lsp = _makeLabelSprite(fileData.name, cardW);
  group.userData.labelSprite = lsp;
  scene.add(lsp);

  // Glow ring
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(cardW * 0.55, cardW * 0.75, 32), ringMat);
  ring.renderOrder = 0;
  group.userData.glowRing = ring;
  group.userData.glowRingMat = ringMat;
  scene.add(ring);

  // Invisible hit sphere for proximity detection
  const hitSphere = new THREE.Mesh(new THREE.SphereGeometry(cardW * 0.55, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hitSphere);
  group.userData.sphere = hitSphere;

  // Position
  const angle  = (index / total) * Math.PI * 1.6 - Math.PI * 0.8;
  const radius = 0.7 + (index % 3) * 0.12;
  const pos    = new THREE.Vector3(Math.sin(angle) * radius, 1.2 + Math.sin(index * 0.9) * 0.15, -Math.cos(angle) * radius);
  group.position.copy(pos);
  group.userData.basePos   = pos.clone();
  group.userData.restPos   = pos.clone();
  group.userData.bobSpeed  = 0.5 + Math.random() * 0.8;
  group.userData.bobAmp    = 0.008 + Math.random() * 0.012;
  group.userData.scaleTarget = 1;

  scene.add(group);
  fileBubbles.push(group);
  return group;
}

function markBubbleOpened(bubble) {
  if (openedBubble && openedBubble !== bubble) {
    openedBubble.userData.opened = false;
    if (openedBubble.userData.glowRingMat) openedBubble.userData.glowRingMat.opacity = 0;
  }
  bubble.userData.opened = true;
  if (bubble.userData.glowRingMat) {
    const ext = _ext(bubble.userData.fileData || {});
    bubble.userData.glowRingMat.color.set(EXT_COLORS[ext] || EXT_COLORS.default);
  }
  openedBubble = bubble;
}

async function openFileBubble(bubble) {
  const fd = bubble.userData.fileData;
  if (!fd) return;
  if (fd.type === 'folder') {
    loadFiles(currentPath === '.' ? fd.name : currentPath + '/' + fd.name);
    return;
  }
  markBubbleOpened(bubble);
  try {
    const fp  = currentPath === '.' ? fd.name : currentPath + '/' + fd.name;
    const res = await fetch('/api/files/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: fp }) });
    const data = await res.json();
    showFileInWindow(fd.name, data.content || '// empty');
  } catch (e) {
    showFileInWindow(fd.name, '// could not read file\n// ' + e.message);
  }
}

async function loadFiles(dirPath) {
  currentPath  = dirPath;
  openedBubble = null;
  fileBubbles.forEach(b => {
    ['cardSprite', 'labelSprite', 'glowRing', 'iconSprite'].forEach(k => { if (b.userData[k]) scene.remove(b.userData[k]); });
    scene.remove(b);
  });
  fileBubbles.length = 0;

  const FALLBACK = [
    { name: 'sacha-work', type: 'folder' },
    { name: 'app.js',     type: 'file', ext: 'js'   },
    { name: 'index.html', type: 'file', ext: 'html' },
    { name: 'server.py',  type: 'file', ext: 'py'   },
    { name: 'style.css',  type: 'file', ext: 'css'  },
    { name: 'README.md',  type: 'file', ext: 'md'   },
    { name: 'package.json', type: 'file', ext: 'json' },
  ];
  try {
    const res  = await fetch('/api/files/list?path=' + encodeURIComponent(dirPath));
    const data = await res.json();
    const entries = data.entries && data.entries.length ? data.entries : FALLBACK;
    entries.forEach((e, i) => createFileBubble(e, i, entries.length));
  } catch {
    FALLBACK.forEach((f, i) => createFileBubble(f, i, FALLBACK.length));
  }
}

loadFiles(currentPath);
