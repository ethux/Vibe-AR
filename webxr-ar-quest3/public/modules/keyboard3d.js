// ─── 3D Virtual Keyboard ───
import { getTermWs, WIN_W, WIN_H } from './state.js';
import { makeTextTexture } from './textures.js';
import { log } from './logging.js';

const KB_KEY_W = 0.065;
const KB_KEY_H = 0.04;
const KB_GAP = 0.005;
const KB_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L','\''],
  ['Z','X','C','V','B','N','M',',','.','/'],
];

let kbGroup = null;
let kbKeyMeshes = [];
let kbInputText = '';
let kbInputMesh = null;
let kbInputCanvas = null;
let kbInputCtx = null;
let kbInputTexture = null;
let kbVisible = false;

export function getKbGroup() { return kbGroup; }
export function getKbKeyMeshes() { return kbKeyMeshes; }
export function isKbVisible() { return kbVisible; }

export function build3DKeyboard(parent) {
  kbGroup = new THREE.Group();
  kbGroup.visible = false;
  parent.add(kbGroup);

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
  const display = kbInputText + '\u2588';
  ctx.fillText(display, 12, H / 2);
  if (kbInputTexture) kbInputTexture.needsUpdate = true;
}

export function handleKbKeyPress(char) {
  if (char === 'BACK') {
    kbInputText = kbInputText.slice(0, -1);
  } else if (char === 'SEND') {
    const termWs = getTermWs();
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

export function toggleKb3D() {
  if (!kbGroup) return;
  kbVisible = !kbVisible;
  kbGroup.visible = kbVisible;
  log(`[KB] 3D keyboard ${kbVisible ? 'shown' : 'hidden'}`);
}
