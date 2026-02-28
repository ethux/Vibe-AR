// ─────────────────────────────────────────────
//  Vibe AR — 3D Pixel Art File Explorer
// ─────────────────────────────────────────────

const MISTRAL_ORANGE = 0xFF7000;
const MISTRAL_DARK   = 0x0a0a12;
const MISTRAL_NAVY   = 0x1a1a2e;
const ACCENT_BLUE    = 0x4488ff;
const ACCENT_GREEN   = 0x50fa7b;
const ACCENT_PURPLE  = 0xbd93f9;
const ACCENT_PINK    = 0xff79c6;
const ACCENT_YELLOW  = 0xf1fa8c;

// ── File tree data ──────────────────────────
const FILE_TREE = {
  name: 'vibe-project', type: 'folder', expanded: true, children: [
    { name: 'src', type: 'folder', expanded: false, children: [
      { name: 'components', type: 'folder', expanded: false, children: [
        { name: 'Editor.tsx', type: 'file', ext: 'tsx', code: `import React from 'react';\nimport { Monaco } from './Monaco';\n\nexport function Editor({ file }) {\n  const [code, setCode] = \n    useState(file.content);\n\n  return (\n    <div className="editor">\n      <Monaco\n        value={code}\n        onChange={setCode}\n        language={file.lang}\n      />\n    </div>\n  );\n}` },
        { name: 'FileTree.tsx', type: 'file', ext: 'tsx', code: `import { Folder, File } from\n  '../icons';\n\nexport function FileTree({\n  tree, onSelect\n}) {\n  return (\n    <ul className="tree">\n      {tree.map(node =>\n        <TreeNode\n          key={node.path}\n          node={node}\n          onSelect={onSelect}\n        />\n      )}\n    </ul>\n  );\n}` },
        { name: 'Preview.tsx', type: 'file', ext: 'tsx', code: `export function Preview({ url }) {\n  return (\n    <iframe\n      src={url}\n      className="preview-frame"\n      sandbox="allow-scripts"\n    />\n  );\n}` },
        { name: 'Chat.tsx', type: 'file', ext: 'tsx', code: `import { useMistral } from\n  '../hooks/useAI';\n\nexport function Chat() {\n  const { send, messages } =\n    useMistral();\n\n  return (\n    <div className="chat">\n      {messages.map(m =>\n        <Message key={m.id}\n          role={m.role}\n          text={m.text} />\n      )}\n    </div>\n  );\n}` },
      ]},
      { name: 'hooks', type: 'folder', expanded: false, children: [
        { name: 'useAI.ts', type: 'file', ext: 'ts', code: `const MISTRAL_API =\n  'https://api.mistral.ai/v1';\n\nexport function useMistral() {\n  const [messages, setMessages]\n    = useState([]);\n\n  async function send(prompt) {\n    const res = await fetch(\n      MISTRAL_API + '/chat',\n      { method: 'POST',\n        body: JSON.stringify({\n          model: 'codestral',\n          messages }) });\n    return res.json();\n  }\n\n  return { send, messages };\n}` },
        { name: 'useXR.ts', type: 'file', ext: 'ts', code: `export function useXR() {\n  const [session, setSession]\n    = useState(null);\n\n  async function enterAR() {\n    const s = await navigator.xr\n      .requestSession(\n        'immersive-ar',\n        { requiredFeatures:\n          ['local-floor'] }\n      );\n    setSession(s);\n  }\n\n  return { session, enterAR };\n}` },
      ]},
      { name: 'styles', type: 'folder', expanded: false, children: [
        { name: 'globals.css', type: 'file', ext: 'css', code: `:root {\n  --mistral: #FF7000;\n  --bg: #0a0a12;\n  --surface: #1a1a2e;\n  --text: #e0e0e0;\n}\n\nbody {\n  background: var(--bg);\n  color: var(--text);\n  font-family: 'Inter';\n}\n\n.pixel {\n  image-rendering: pixelated;\n  image-rendering: crisp-edges;\n}` },
        { name: 'editor.css', type: 'file', ext: 'css', code: `.editor {\n  background: var(--surface);\n  border: 2px solid var(--mistral);\n  border-radius: 4px;\n  padding: 16px;\n  font-family: monospace;\n  font-size: 14px;\n}\n\n.editor .line-number {\n  color: #555;\n  user-select: none;\n}` },
      ]},
      { name: 'App.tsx', type: 'file', ext: 'tsx', code: `import { Editor } from\n  './components/Editor';\nimport { FileTree } from\n  './components/FileTree';\nimport { Chat } from\n  './components/Chat';\n\nexport default function App() {\n  return (\n    <div className="app">\n      <FileTree />\n      <Editor />\n      <Chat />\n    </div>\n  );\n}` },
      { name: 'main.tsx', type: 'file', ext: 'tsx', code: `import { createRoot } from\n  'react-dom/client';\nimport App from './App';\nimport './styles/globals.css';\n\ncreateRoot(\n  document.getElementById('root')!\n).render(<App />);` },
    ]},
    { name: 'server', type: 'folder', expanded: false, children: [
      { name: 'index.ts', type: 'file', ext: 'ts', code: `import express from 'express';\nimport { mistralRouter } from\n  './routes/ai';\n\nconst app = express();\n\napp.use('/api/ai', mistralRouter);\napp.use(express.static('dist'));\n\napp.listen(3000, () =>\n  console.log('Server on :3000'));` },
      { name: 'routes', type: 'folder', expanded: false, children: [
        { name: 'ai.ts', type: 'file', ext: 'ts', code: `import { Router } from 'express';\nexport const mistralRouter =\n  Router();\n\nmistralRouter.post('/chat',\n  async (req, res) => {\n    const response = await fetch(\n      'https://api.mistral.ai'\n      + '/v1/chat/completions',\n      { method: 'POST',\n        headers: { 'Authorization':\n          'Bearer ' + API_KEY },\n        body: JSON.stringify(\n          req.body) });\n    res.json(await response.json());\n  });` },
      ]},
    ]},
    { name: 'package.json', type: 'file', ext: 'json', code: `{\n  "name": "vibe-ar",\n  "version": "0.1.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "server": "tsx server"\n  },\n  "dependencies": {\n    "react": "^19.0.0",\n    "three": "^0.170.0",\n    "@mistralai/client": "^1.0"\n  }\n}` },
    { name: 'vite.config.ts', type: 'file', ext: 'ts', code: `import { defineConfig } from\n  'vite';\nimport react from\n  '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    https: true,\n    host: '0.0.0.0'\n  }\n});` },
    { name: 'README.md', type: 'file', ext: 'md', code: `# Vibe AR\n\nAR coding environment\npowered by Mistral AI.\n\n## Features\n- 3D file explorer\n- AI code assistant\n- Live preview\n- Voice commands\n\n## Setup\nnpm install\nnpm run dev` },
    { name: '.gitignore', type: 'file', ext: 'git', code: `node_modules/\ndist/\n.env\n*.log\n.DS_Store` },
  ]
};

// ── Scene Setup ─────────────────────────────
const scene    = new THREE.Scene();
scene.fog      = new THREE.FogExp2(MISTRAL_DARK, 0.3);

const camera   = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.5, 5);
camera.lookAt(0, 1, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(MISTRAL_DARK);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ── Lighting ────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x222244, 0.8);
scene.add(ambientLight);

const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
mainLight.position.set(5, 8, 5);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(2048, 2048);
mainLight.shadow.camera.near = 0.1;
mainLight.shadow.camera.far = 30;
mainLight.shadow.camera.left = -10;
mainLight.shadow.camera.right = 10;
mainLight.shadow.camera.top = 10;
mainLight.shadow.camera.bottom = -10;
scene.add(mainLight);

const orangeLight = new THREE.PointLight(MISTRAL_ORANGE, 0.6, 15);
orangeLight.position.set(-2, 4, 2);
scene.add(orangeLight);

const blueLight = new THREE.PointLight(ACCENT_BLUE, 0.3, 15);
blueLight.position.set(3, 3, -2);
scene.add(blueLight);

// ── Grid Floor ──────────────────────────────
function createPixelGrid() {
  const group = new THREE.Group();

  const gridSize = 30;
  const gridDiv = 30;
  const gridHelper = new THREE.GridHelper(gridSize, gridDiv, 0x151525, 0x111120);
  gridHelper.position.y = 0;
  gridHelper.material.opacity = 0.4;
  gridHelper.material.transparent = true;
  group.add(gridHelper);

  // glowing lines
  const glowGrid = new THREE.GridHelper(gridSize, gridDiv / 3, MISTRAL_ORANGE, MISTRAL_ORANGE);
  glowGrid.position.y = 0.001;
  glowGrid.material.opacity = 0.06;
  glowGrid.material.transparent = true;
  group.add(glowGrid);

  return group;
}
scene.add(createPixelGrid());

// ── Pixel Art Texture Helpers ───────────────
function createPixelCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function canvasToTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ── Pixel Folder Icon ───────────────────────
function drawFolderIcon(ctx, color, open) {
  const c = color || '#FF7000';
  ctx.clearRect(0, 0, 16, 16);

  if (open) {
    ctx.fillStyle = c;
    ctx.fillRect(0, 2, 7, 3);
    ctx.fillRect(0, 5, 16, 2);
    ctx.fillRect(0, 7, 15, 7);
    ctx.fillRect(2, 7, 14, 7);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(1, 12, 14, 2);
  } else {
    ctx.fillStyle = c;
    ctx.fillRect(0, 3, 7, 3);
    ctx.fillRect(0, 6, 14, 8);
    // tab
    ctx.fillStyle = shadeColor(c, -20);
    ctx.fillRect(0, 3, 7, 2);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(1, 12, 13, 2);
  }
}

function shadeColor(hex, percent) {
  let num = parseInt(hex.replace('#', ''), 16);
  let r = Math.min(255, Math.max(0, (num >> 16) + percent));
  let g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + percent));
  let b = Math.min(255, Math.max(0, (num & 0xff) + percent));
  return `rgb(${r},${g},${b})`;
}

// ── Pixel File Icon ─────────────────────────
const EXT_COLORS = {
  tsx: '#61dafb', ts: '#3178c6', js: '#f7df1e', jsx: '#61dafb',
  css: '#264de4', html: '#e34c26', json: '#50fa7b',
  md: '#ffffff', py: '#3776ab', git: '#f54d27',
  default: '#888899'
};

function drawFileIcon(ctx, ext) {
  ctx.clearRect(0, 0, 16, 16);
  const color = EXT_COLORS[ext] || EXT_COLORS.default;

  // file shape
  ctx.fillStyle = '#2a2a3e';
  ctx.fillRect(2, 1, 10, 14);
  // fold corner
  ctx.fillStyle = '#3a3a5e';
  ctx.fillRect(9, 1, 3, 3);
  // ext badge
  ctx.fillStyle = color;
  ctx.fillRect(3, 8, 8, 5);
  // ext text
  ctx.fillStyle = '#000';
  ctx.font = '4px monospace';
  ctx.fillText(ext.substring(0, 3).toUpperCase(), 4, 12);
}

// ── Create 3D Node ──────────────────────────
const allNodes = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredNode = null;
let selectedFile = null;

function createFolderMesh(node) {
  const group = new THREE.Group();
  group.userData = { node, type: 'folder' };

  // Main box (voxel folder)
  const boxGeo = new THREE.BoxGeometry(0.35, 0.25, 0.08);
  const { canvas, ctx } = createPixelCanvas(16, 16);
  drawFolderIcon(ctx, '#FF7000', node.expanded);
  const tex = canvasToTexture(canvas);

  const mat = new THREE.MeshStandardMaterial({
    color: node.expanded ? 0xFF8820 : MISTRAL_ORANGE,
    roughness: 0.6,
    metalness: 0.1,
    emissive: MISTRAL_ORANGE,
    emissiveIntensity: 0.15,
  });
  const box = new THREE.Mesh(boxGeo, mat);
  box.castShadow = true;
  box.receiveShadow = true;
  group.add(box);

  // Folder tab
  const tabGeo = new THREE.BoxGeometry(0.14, 0.06, 0.08);
  const tabMat = new THREE.MeshStandardMaterial({
    color: MISTRAL_ORANGE,
    roughness: 0.5,
    emissive: MISTRAL_ORANGE,
    emissiveIntensity: 0.2,
  });
  const tab = new THREE.Mesh(tabGeo, tabMat);
  tab.position.set(-0.09, 0.155, 0);
  tab.castShadow = true;
  group.add(tab);

  // Pixel icon on front
  const iconGeo = new THREE.PlaneGeometry(0.15, 0.15);
  const iconMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const icon = new THREE.Mesh(iconGeo, iconMat);
  icon.position.z = 0.041;
  group.add(icon);

  // Name label
  const label = createTextLabel(node.name, 10, '#FF7000', 256, 32);
  label.position.set(0, -0.2, 0);
  group.add(label);

  // Glow ring
  const ringGeo = new THREE.RingGeometry(0.22, 0.24, 4);
  const ringMat = new THREE.MeshBasicMaterial({
    color: MISTRAL_ORANGE,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.13;
  group.add(ring);
  group.userData.ring = ring;
  group.userData.mainMesh = box;

  return group;
}

function createFileMesh(node) {
  const group = new THREE.Group();
  group.userData = { node, type: 'file' };

  const ext = node.ext || 'default';
  const color = new THREE.Color(EXT_COLORS[ext] || EXT_COLORS.default);

  // File body
  const bodyGeo = new THREE.BoxGeometry(0.22, 0.28, 0.03);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1e1e2e,
    roughness: 0.7,
    metalness: 0.05,
    emissive: color,
    emissiveIntensity: 0.05,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Dog-ear corner
  const earGeo = new THREE.BoxGeometry(0.06, 0.06, 0.031);
  const earMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e,
    roughness: 0.5,
  });
  const ear = new THREE.Mesh(earGeo, earMat);
  ear.position.set(0.08, 0.11, 0);
  group.add(ear);

  // Extension badge
  const badgeGeo = new THREE.BoxGeometry(0.12, 0.06, 0.032);
  const badgeMat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    emissive: color,
    emissiveIntensity: 0.3,
  });
  const badge = new THREE.Mesh(badgeGeo, badgeMat);
  badge.position.set(0, -0.04, 0);
  group.add(badge);

  // Pixel icon
  const { canvas, ctx } = createPixelCanvas(16, 16);
  drawFileIcon(ctx, ext);
  const tex = canvasToTexture(canvas);
  const iconGeo = new THREE.PlaneGeometry(0.12, 0.12);
  const iconMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const icon = new THREE.Mesh(iconGeo, iconMat);
  icon.position.z = 0.016;
  icon.position.y = 0.04;
  group.add(icon);

  // Name label
  const label = createTextLabel(node.name, 8, EXT_COLORS[ext] || '#888', 256, 32);
  label.position.set(0, -0.22, 0);
  group.add(label);

  // Glow ring
  const ringGeo = new THREE.RingGeometry(0.16, 0.18, 4);
  const ringMat = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.15;
  group.add(ring);
  group.userData.ring = ring;
  group.userData.mainMesh = body;
  group.userData.color = color;

  return group;
}

function createTextLabel(text, fontSize, color, w, h) {
  const { canvas, ctx } = createPixelCanvas(w, h);
  ctx.fillStyle = color;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const tex = canvasToTexture(canvas);
  const geo = new THREE.PlaneGeometry(w / 400, h / 400);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

// ── Build Tree Layout ───────────────────────
const treeGroup = new THREE.Group();
scene.add(treeGroup);

const connectionLines = [];

function clearTree() {
  while (treeGroup.children.length > 0) {
    treeGroup.remove(treeGroup.children[0]);
  }
  allNodes.length = 0;
  connectionLines.length = 0;
}

function buildTree(node, depth, index, parentPos, siblingCount) {
  const isFolder = node.type === 'folder';
  const mesh = isFolder ? createFolderMesh(node) : createFileMesh(node);

  const horizontalSpacing = 0.7;
  const verticalSpacing = 0.7;

  const totalWidth = (siblingCount - 1) * horizontalSpacing;
  const x = -totalWidth / 2 + index * horizontalSpacing;
  const y = 3 - depth * verticalSpacing;

  mesh.position.set(x, y, depth * 0.15);

  // Animate entrance
  mesh.scale.set(0, 0, 0);
  mesh.userData.targetScale = 1;
  mesh.userData.scaleVelocity = 0;
  mesh.userData.spawnTime = performance.now() + depth * 100 + index * 50;
  mesh.userData.baseY = y;

  treeGroup.add(mesh);
  allNodes.push(mesh);

  // Connection line from parent
  if (parentPos) {
    const points = [
      new THREE.Vector3(parentPos.x, parentPos.y - 0.15, parentPos.z),
      new THREE.Vector3(parentPos.x, y + 0.2, parentPos.z + 0.05),
      new THREE.Vector3(x, y + 0.2, depth * 0.15),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
      color: isFolder ? MISTRAL_ORANGE : (EXT_COLORS[node.ext] || 0x444466),
      transparent: true,
      opacity: 0.3,
    });
    const line = new THREE.Line(lineGeo, lineMat);
    line.userData.targetOpacity = 0.3;
    line.userData.spawnTime = mesh.userData.spawnTime;
    treeGroup.add(line);
    connectionLines.push(line);
  }

  if (isFolder && node.expanded && node.children) {
    const pos = { x, y, z: depth * 0.15 };
    node.children.forEach((child, i) => {
      buildTree(child, depth + 1, i, pos, node.children.length);
    });
  }
}

function rebuildTree() {
  clearTree();
  buildTree(FILE_TREE, 0, 0, null, 1);
  updateStats();
}

function updateStats() {
  let files = 0, folders = 0;
  function count(node) {
    if (node.type === 'folder') {
      folders++;
      if (node.children) node.children.forEach(count);
    } else {
      files++;
    }
  }
  count(FILE_TREE);
  document.getElementById('file-count').textContent = files + ' FILES';
  document.getElementById('folder-count').textContent = folders + ' FOLDERS';
}

rebuildTree();

// ── Floating Particles ──────────────────────
const particleCount = 200;
const particleGeo = new THREE.BufferGeometry();
const positions = new Float32Array(particleCount * 3);
const colors = new Float32Array(particleCount * 3);
const particleSpeeds = [];

for (let i = 0; i < particleCount; i++) {
  positions[i * 3]     = (Math.random() - 0.5) * 15;
  positions[i * 3 + 1] = Math.random() * 6;
  positions[i * 3 + 2] = (Math.random() - 0.5) * 8;

  const colorChoice = Math.random();
  const col = new THREE.Color();
  if (colorChoice < 0.4) col.set(MISTRAL_ORANGE);
  else if (colorChoice < 0.6) col.set(ACCENT_BLUE);
  else if (colorChoice < 0.75) col.set(ACCENT_PURPLE);
  else col.set(0x333355);

  colors[i * 3]     = col.r;
  colors[i * 3 + 1] = col.g;
  colors[i * 3 + 2] = col.b;

  particleSpeeds.push({
    x: (Math.random() - 0.5) * 0.005,
    y: Math.random() * 0.003 + 0.001,
    z: (Math.random() - 0.5) * 0.003,
    phase: Math.random() * Math.PI * 2
  });
}

particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const particleMat = new THREE.PointsMaterial({
  size: 0.04,
  vertexColors: true,
  transparent: true,
  opacity: 0.6,
  sizeAttenuation: true,
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// ── Mouse Interaction ───────────────────────
let isDragging = false;
let prevMouse = { x: 0, y: 0 };
let cameraAngle = { x: 0.3, y: 0 };
let cameraRadius = 5;
let cameraTarget = new THREE.Vector3(0, 1.5, 0);
let cameraPanTarget = new THREE.Vector3(0, 1.5, 0);

renderer.domElement.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / innerHeight) * 2 + 1;

  if (isDragging) {
    const dx = e.clientX - prevMouse.x;
    const dy = e.clientY - prevMouse.y;
    cameraAngle.y -= dx * 0.005;
    cameraAngle.x -= dy * 0.005;
    cameraAngle.x = Math.max(-0.5, Math.min(1.2, cameraAngle.x));
  }
  prevMouse = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2 || e.button === 1) {
    isDragging = true;
    prevMouse = { x: e.clientX, y: e.clientY };
  }
});

renderer.domElement.addEventListener('mouseup', () => {
  isDragging = false;
});

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('wheel', (e) => {
  cameraRadius += e.deltaY * 0.005;
  cameraRadius = Math.max(2, Math.min(12, cameraRadius));
});

renderer.domElement.addEventListener('click', (e) => {
  if (e.button !== 0) return;

  raycaster.setFromCamera(mouse, camera);
  const meshes = allNodes.map(n => n.userData.mainMesh).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);

  if (hits.length > 0) {
    const hitMesh = hits[0].object;
    const nodeGroup = allNodes.find(n => n.userData.mainMesh === hitMesh);
    if (!nodeGroup) return;

    const nodeData = nodeGroup.userData.node;

    if (nodeData.type === 'folder') {
      nodeData.expanded = !nodeData.expanded;
      rebuildTree();

      // Update breadcrumb
      let path = '~/' + nodeData.name;
      document.getElementById('breadcrumb').textContent = path;
    } else {
      selectedFile = nodeData;
      showPreview(nodeData);
    }
  }
});

// ── Preview Panel ───────────────────────────
function showPreview(node) {
  const panel = document.getElementById('preview-panel');
  const filename = document.getElementById('preview-filename');
  const content = document.getElementById('preview-content');

  filename.textContent = node.name;
  content.textContent = node.code || '// empty file';
  panel.style.display = 'block';
}

window.closePreview = function() {
  document.getElementById('preview-panel').style.display = 'none';
  selectedFile = null;
};

// ── Animation Loop ──────────────────────────
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  const now = performance.now();

  // Camera orbit
  camera.position.x = cameraTarget.x + Math.sin(cameraAngle.y) * Math.cos(cameraAngle.x) * cameraRadius;
  camera.position.y = cameraTarget.y + Math.sin(cameraAngle.x) * cameraRadius;
  camera.position.z = cameraTarget.z + Math.cos(cameraAngle.y) * Math.cos(cameraAngle.x) * cameraRadius;
  cameraTarget.lerp(cameraPanTarget, 0.05);
  camera.lookAt(cameraTarget);

  // Animate nodes
  allNodes.forEach((group, i) => {
    if (now < group.userData.spawnTime) return;

    // Scale animation
    const targetS = group.userData.targetScale;
    const currentS = group.scale.x;
    const diff = targetS - currentS;
    group.userData.scaleVelocity += diff * 0.15;
    group.userData.scaleVelocity *= 0.7;
    const newScale = currentS + group.userData.scaleVelocity;
    group.scale.set(newScale, newScale, newScale);

    // Idle float
    const baseY = group.userData.baseY;
    group.position.y = baseY + Math.sin(elapsed * 0.8 + i * 0.5) * 0.015;

    // Slight rotation
    group.rotation.y = Math.sin(elapsed * 0.3 + i * 0.7) * 0.05;
  });

  // Connection line fade-in
  connectionLines.forEach(line => {
    if (now < line.userData.spawnTime) {
      line.material.opacity = 0;
      return;
    }
    const age = (now - line.userData.spawnTime) / 500;
    line.material.opacity = Math.min(line.userData.targetOpacity, age * line.userData.targetOpacity);
  });

  // Hover detection
  raycaster.setFromCamera(mouse, camera);
  const meshes = allNodes.map(n => n.userData.mainMesh).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);

  // Reset previous hover
  if (hoveredNode) {
    const ring = hoveredNode.userData.ring;
    if (ring) ring.material.opacity = 0;
    document.body.style.cursor = 'crosshair';
  }

  if (hits.length > 0) {
    const hitMesh = hits[0].object;
    hoveredNode = allNodes.find(n => n.userData.mainMesh === hitMesh);
    if (hoveredNode) {
      const ring = hoveredNode.userData.ring;
      if (ring) {
        ring.material.opacity = 0.5 + Math.sin(elapsed * 4) * 0.2;
        ring.rotation.z = elapsed * 1.5;
      }
      document.body.style.cursor = 'pointer';
    }
  } else {
    hoveredNode = null;
  }

  // Animate particles
  const posArr = particles.geometry.attributes.position.array;
  for (let i = 0; i < particleCount; i++) {
    const sp = particleSpeeds[i];
    posArr[i * 3]     += sp.x + Math.sin(elapsed + sp.phase) * 0.001;
    posArr[i * 3 + 1] += sp.y;
    posArr[i * 3 + 2] += sp.z + Math.cos(elapsed * 0.7 + sp.phase) * 0.001;

    if (posArr[i * 3 + 1] > 6) {
      posArr[i * 3 + 1] = 0;
      posArr[i * 3]     = (Math.random() - 0.5) * 15;
      posArr[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
  }
  particles.geometry.attributes.position.needsUpdate = true;

  // Pulsating lights
  orangeLight.intensity = 0.6 + Math.sin(elapsed * 1.5) * 0.15;
  blueLight.intensity = 0.3 + Math.sin(elapsed * 2 + 1) * 0.1;

  renderer.render(scene, camera);
}

animate();

// ── Resize ──────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
