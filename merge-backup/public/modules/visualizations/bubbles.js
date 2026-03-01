// ═══════════════════════════════════════════════════════════════════
//  bubbles.js — File Bubble Visualization for WebXR AR
//  Adapted from sacha-work as ES module class
//  Live-updating: WebSocket watcher + polling fallback
// ═══════════════════════════════════════════════════════════════════

import { FileViewerWindow } from '../windowing/FileViewerWindow.js';

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

const CODE_EXTS = new Set(['js','ts','tsx','jsx','py','rb','go','rs','css','html','json','yaml','yml','sh']);

// Poll interval in ms (used when WebSocket is unavailable)
const POLL_INTERVAL = 5000;

class FileBubbleManager {
  constructor(scene, windowManager, codeCityRenderer) {
    this.scene = scene;
    this.wm = windowManager;
    this.codeCity = codeCityRenderer || null;
    this.fileBubbles = [];
    this.openedBubble = null;
    this.currentPath = '.';
    this._fileWindow = null;
    this._fileViewer = new FileViewerWindow(this.wm);
    this._watchWs = null;
    this._pollTimer = null;
    this._watchGen = 0;   // generation counter to prevent stale WS handlers
    this._lastEntryNames = new Set();
    // Explorer visibility state
    this._explorerVisible = false;
    this._showAnim = null;  // { progress, direction: 'in'|'out' }
    // Bubbles pending spawn/remove animation
    this._spawning = [];  // { bubble, progress }
    this._removing = [];  // { bubble, progress }
    // Palm-orbit grab state (from sacha-work)
    this.palmBubbles = [];       // bubbles orbiting the left palm
    this.leftPalmCenter = null;  // THREE.Vector3, updated by scene.js
    this.leftPalmOpen = false;   // whether left palm is open (show/hide palm bubbles)
    this._palmOpenness = 0;      // continuous 0→1 animation value
  }

  async loadFiles(dirPath) {
    this.currentPath = dirPath;
    this.openedBubble = null;
    this._stopWatching();

    // Clean up existing bubbles
    this._removeAllBubbles();

    const FALLBACK = [
      { name: 'src', type: 'folder' },
      { name: 'app.js', type: 'file', ext: 'js' },
      { name: 'index.html', type: 'file', ext: 'html' },
      { name: 'server.py', type: 'file', ext: 'py' },
      { name: 'README.md', type: 'file', ext: 'md' },
      { name: 'package.json', type: 'file', ext: 'json' },
    ];

    // Files/folders that add visual noise without useful info
    const NOISE = new Set([
      'node_modules', '.git', '.DS_Store', 'dist', 'build',
      '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.idea',
    ]);

    let entries;
    try {
      const res = await fetch('/api/companion/files/list?path=' + encodeURIComponent(dirPath));
      const data = await res.json();
      entries = data.entries && data.entries.length ? data.entries : FALLBACK;
    } catch {
      entries = FALLBACK;
    }

    // Filter out noisy/binary entries; keep useful dotfiles (.env, .gitignore…)
    entries = entries.filter(e => !NOISE.has(e.name));

    // Skip entries already held in palm context for this directory
    const palmNames = new Set(
      this.palmBubbles
        .filter(b => b.userData.parentDir === dirPath)
        .map(b => b.userData.fileData?.name)
    );
    const spawnEntries = entries.filter(e => !palmNames.has(e.name));
    spawnEntries.forEach((e, i) => {
      const b = this._createBubble(e, i, spawnEntries.length);
      this._spawning.push({ bubble: b, progress: 0 });
    });
    this._lastEntryNames = new Set(entries.map(e => e.name));

    // Start live watching
    this._startWatching(dirPath);
  }

  // ── Live file watching ──

  _startWatching(dirPath) {
    const gen = ++this._watchGen;
    // Try WebSocket first
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/api/companion/ws/files/watch?path=${encodeURIComponent(dirPath)}`;
    try {
      this._watchWs = new WebSocket(wsUrl);
      this._watchWs.onmessage = (ev) => {
        if (gen !== this._watchGen) return; // stale
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'change' && msg.path === this.currentPath) {
            this._applyDiff(msg.entries, msg.added, msg.removed);
          }
        } catch {}
      };
      this._watchWs.onclose = () => {
        if (gen !== this._watchGen) return; // stale — don't start poll for old path
        this._watchWs = null;
        this._startPolling(dirPath);
      };
      this._watchWs.onerror = () => {
        if (gen !== this._watchGen) return; // stale
        this._watchWs?.close();
        this._watchWs = null;
        this._startPolling(dirPath);
      };
    } catch {
      if (gen === this._watchGen) this._startPolling(dirPath);
    }
  }

  _startPolling(dirPath) {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(async () => {
      if (this.currentPath !== dirPath) { this._stopPolling(); return; }
      try {
        const res = await fetch('/api/companion/files/list?path=' + encodeURIComponent(dirPath));
        const data = await res.json();
        if (!data.entries) return;
        const currNames = new Set(data.entries.map(e => e.name));
        const added = data.entries.filter(e => !this._lastEntryNames.has(e.name));
        const removed = [...this._lastEntryNames].filter(n => !currNames.has(n))
          .map(n => ({ name: n }));
        if (added.length || removed.length) {
          this._applyDiff(data.entries, added, removed);
        }
      } catch {}
    }, POLL_INTERVAL);
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _stopWatching() {
    if (this._watchWs) { this._watchWs.close(); this._watchWs = null; }
    this._stopPolling();
  }

  // ── Diff application — animate in new, animate out removed ──

  _applyDiff(allEntries, added, removed) {
    // Remove bubbles for deleted files — never touch palm (context) bubbles
    for (const r of removed) {
      const idx = this.fileBubbles.findIndex(b => !b.userData.inPalm && b.userData.fileData?.name === r.name);
      if (idx !== -1) {
        const bubble = this.fileBubbles[idx];
        this.fileBubbles.splice(idx, 1);
        this._removing.push({ bubble, progress: 0 });
      }
    }

    // Add bubbles for new files (skip if already in palm context for this dir)
    const total = allEntries.length;
    const palmNamesInDir = new Set(
      this.palmBubbles
        .filter(b => b.userData.parentDir === this.currentPath)
        .map(b => b.userData.fileData?.name)
    );
    for (const a of added) {
      if (palmNamesInDir.has(a.name)) continue;
      const newIdx = allEntries.findIndex(e => e.name === a.name);
      const b = this._createBubble(a, newIdx >= 0 ? newIdx : this.fileBubbles.length, total);
      this._spawning.push({ bubble: b, progress: 0 });
    }

    // Re-layout existing bubbles smoothly
    this._relayout(allEntries);
    this._lastEntryNames = new Set(allEntries.map(e => e.name));
  }

  _relayout(entries) {
    const total = entries.length;
    for (let i = 0; i < entries.length; i++) {
      // Skip palm (context) bubbles — they orbit the palm, not the arc
      const bubble = this.fileBubbles.find(b => !b.userData.inPalm && b.userData.fileData?.name === entries[i].name);
      if (!bubble) continue;
      const angle = (i / total) * Math.PI * 1.6 - Math.PI * 0.8;
      const radius = 0.7 + (i % 3) * 0.12;
      const targetPos = new THREE.Vector3(
        Math.sin(angle) * radius,
        1.2 + Math.sin(i * 0.9) * 0.15,
        -Math.cos(angle) * radius
      );
      bubble.userData.targetPos = targetPos;
      bubble.userData.basePos = targetPos.clone();
      bubble.userData.index = i;
    }
  }

  // ── Bubble lifecycle ──

  _removeAllBubbles() {
    // Flush _removing — destroy orphaned sprites immediately to avoid ghost objects
    for (const r of this._removing) {
      if (!r.bubble.userData.inPalm) this._destroyBubble(r.bubble);
    }
    this._removing.length = 0;

    // Keep spawning entries only for palm bubbles (they may still be fading in)
    this._spawning = this._spawning.filter(s => s.bubble.userData.inPalm);

    // Destroy free bubbles in-place — palm (context) bubbles survive navigation
    for (let i = this.fileBubbles.length - 1; i >= 0; i--) {
      const b = this.fileBubbles[i];
      if (!b.userData.inPalm) {
        this._destroyBubble(b);
        this.fileBubbles.splice(i, 1);
      }
    }
    // palmBubbles keeps its references — orbit continues across folders
  }

  _destroyBubble(b) {
    ['cardSprite', 'labelSprite', 'glowRing'].forEach(k => {
      if (b.userData[k]) this.scene.remove(b.userData[k]);
    });
    this.scene.remove(b);
  }

  _createBubble(fileData, index, total) {
    const ext   = _ext(fileData);
    const color = EXT_COLORS[ext] || (fileData.type === 'folder' ? 0xFF7000 : EXT_COLORS.default);
    const cardW = fileData.type === 'folder' ? 0.11 : 0.095;
    const group = new THREE.Group();
    group.userData = { fileData, opened: false, color, cardW, index, spawnScale: 0, parentDir: this.currentPath };

    // Placeholder sprite (starts invisible, animated in)
    const placeholderMat = new THREE.SpriteMaterial({ color, transparent: true, opacity: 0, sizeAttenuation: true });
    const placeholder = new THREE.Sprite(placeholderMat);
    placeholder.scale.set(0.001, 0.001, 1);
    placeholder.renderOrder = 1;
    group.userData.cardSprite = placeholder;
    group.userData.cardMat = placeholderMat;
    this.scene.add(placeholder);

    // Async icon load
    loadImg(getIconPath(fileData)).then(iconImg => {
      const mat = new THREE.SpriteMaterial({ map: buildBubbleTexture(fileData, color, iconImg), transparent: true, depthWrite: false, sizeAttenuation: true });
      mat.opacity = placeholderMat.opacity;
      placeholder.material = mat;
      group.userData.cardMat = mat;
    });

    // Label
    const lsp = _makeLabelSprite(fileData.name, cardW);
    lsp.material.opacity = 0;
    group.userData.labelSprite = lsp;
    group.userData.labelMat = lsp.material;
    this.scene.add(lsp);

    // Glow ring
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(cardW * 0.55, cardW * 0.75, 32), ringMat);
    ring.renderOrder = 0;
    group.userData.glowRing = ring;
    group.userData.glowRingMat = ringMat;
    this.scene.add(ring);

    // Hit sphere
    const hitSphere = new THREE.Mesh(new THREE.SphereGeometry(cardW * 0.55, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(hitSphere);
    group.userData.sphere = hitSphere;

    // Position in arc
    const angle  = (index / total) * Math.PI * 1.6 - Math.PI * 0.8;
    const radius = 0.7 + (index % 3) * 0.12;
    const pos = new THREE.Vector3(Math.sin(angle) * radius, 1.2 + Math.sin(index * 0.9) * 0.15, -Math.cos(angle) * radius);
    group.position.copy(pos);
    group.userData.basePos   = pos.clone();
    group.userData.restPos   = pos.clone();
    group.userData.bobSpeed  = 0.5 + Math.random() * 0.8;
    group.userData.bobAmp    = 0.008 + Math.random() * 0.012;
    group.userData.scaleTarget = 1;

    // If explorer is hidden, keep bubble invisible until show() is called
    if (!this._explorerVisible) {
      if (group.userData.cardSprite) group.userData.cardSprite.visible = false;
      if (group.userData.labelSprite) group.userData.labelSprite.visible = false;
      if (group.userData.glowRing) group.userData.glowRing.visible = false;
      group.visible = false;
    }

    this.scene.add(group);
    this.fileBubbles.push(group);
    return group;
  }

  update(dt, elapsed) {
    // Explorer show/hide animation
    if (this._showAnim) {
      this._showAnim.progress = Math.min(1, this._showAnim.progress + dt * 3); // ~0.33s
      const t = this._showAnim.progress;
      const ease = this._showAnim.direction === 'in'
        ? 1 - Math.pow(1 - t, 3)   // ease-out cubic
        : Math.pow(1 - t, 3);       // reverse ease (fade out)
      this._applyExplorerOpacity(ease);
      if (t >= 1) {
        if (this._showAnim.direction === 'out') {
          this._explorerVisible = false;
          this._setAllBubblesVisible(false);
        }
        this._showAnim = null;
      }
      // Skip normal spawn/remove animations during show/hide
      return;
    }

    if (!this._explorerVisible) {
      // Explorer hidden — only animate palm context bubbles
      if (this.palmBubbles.length) {
        this._tickPalmOpenness(dt, elapsed);
      }
      return;
    }

    // Animate spawning bubbles (scale + fade in)
    for (let i = this._spawning.length - 1; i >= 0; i--) {
      const s = this._spawning[i];
      s.progress = Math.min(1, s.progress + dt * 3);  // ~0.33s
      const t = s.progress;
      const ease = 1 - Math.pow(1 - t, 3);  // ease-out cubic
      const ud = s.bubble.userData;
      const scale = ease * ud.cardW;
      if (ud.cardSprite) ud.cardSprite.scale.set(scale, scale, 1);
      if (ud.cardMat) ud.cardMat.opacity = ease * 0.9;
      if (ud.labelMat) ud.labelMat.opacity = ease;
      if (ud.labelSprite) ud.labelSprite.scale.set(ud.cardW * 2.2 * ease, ud.cardW * 0.42 * ease, 1);
      if (t >= 1) this._spawning.splice(i, 1);
    }

    // Animate removing bubbles (scale + fade out)
    for (let i = this._removing.length - 1; i >= 0; i--) {
      const r = this._removing[i];
      r.progress = Math.min(1, r.progress + dt * 4);  // ~0.25s
      const t = r.progress;
      const ease = 1 - t;
      const ud = r.bubble.userData;
      const scale = ease * ud.cardW;
      if (ud.cardSprite) ud.cardSprite.scale.set(scale, scale, 1);
      if (ud.cardMat) ud.cardMat.opacity = ease * 0.9;
      if (ud.labelMat) ud.labelMat.opacity = ease;
      if (ud.labelSprite) ud.labelSprite.scale.set(ud.cardW * 2.2 * ease, ud.cardW * 0.42 * ease, 1);
      // Pop up slightly while shrinking
      r.bubble.position.y += dt * 0.3;
      if (t >= 1) {
        this._destroyBubble(r.bubble);
        this._removing.splice(i, 1);
      }
    }

    // Palm bubbles: driven entirely by _tickPalmOpenness (open/close animation)
    this._tickPalmOpenness(dt, elapsed);

    // Update live bubbles (free bubbles only — palm bubbles handled above)
    const now = performance.now();
    for (const b of this.fileBubbles) {
      const ud = b.userData;
      if (ud.inPalm) continue;  // palm bubbles are fully managed by _tickPalmOpenness

      // ── MCP moveFileBubble: smooth position animation ──
      if (ud._moveTarget) {
        ud._moveT = Math.min(1, (ud._moveT || 0) + dt * 2.5);  // ~0.4s
        const t = ud._moveT;
        const ease = t * (2 - t);  // ease-out
        const start = ud._moveStart;
        b.position.lerpVectors(start, ud._moveTarget, ease);
        ud.basePos.copy(b.position);
        if (t >= 1) {
          ud.basePos.copy(ud._moveTarget);
          ud._moveTarget = null;
          ud._moveStart = null;
          ud._moveT = 0;
        }
      }
      // Smooth move to target position (relayout or return from palm)
      else if (ud.targetPos) {
        const k = Math.min(1, dt * 10);  // snappier return
        b.position.x += (ud.targetPos.x - b.position.x) * k;
        b.position.y += (ud.targetPos.y - b.position.y) * k;
        b.position.z += (ud.targetPos.z - b.position.z) * k;
        ud.basePos.copy(b.position);
        if (b.position.distanceTo(ud.targetPos) < 0.002) {
          ud.basePos.copy(ud.targetPos);
          ud.targetPos = null;
        }
      }

      // Bobbing (free bubbles only, skip during MCP move)
      if (!ud._moveTarget) {
        b.position.y = ud.basePos.y + Math.sin(elapsed * ud.bobSpeed) * ud.bobAmp;
      }

      // ── MCP pulse highlight animation ──
      if (ud._pulseColor && ud._pulseEnd) {
        if (now < ud._pulseEnd) {
          const pulseT = Math.sin(now * 0.008) * 0.5 + 0.5;  // 0..1 oscillation
          if (ud.glowRingMat) {
            ud.glowRingMat.opacity = 0.3 + pulseT * 0.5;
          }
          // Subtle scale pulse
          ud.scaleTarget = 1.15 + pulseT * 0.35;
        } else {
          ud._pulseColor = null;
          ud._pulseEnd = null;
        }
      }

      // ── Scale damping (spring-like) ──
      if (ud.scaleTarget !== undefined) {
        const cs = ud.cardSprite ? ud.cardSprite.scale.x / ud.cardW : 1;
        const ns = cs + (ud.scaleTarget - cs) * 0.2;  // snappier scale
        const scale = ns * ud.cardW;
        if (ud.cardSprite) ud.cardSprite.scale.set(scale, scale, 1);
        if (ud.labelSprite) ud.labelSprite.scale.set(ud.cardW * 2.2 * ns, ud.cardW * 0.42 * ns, 1);
      }

      // Sync child sprites with group position
      if (ud.cardSprite) {
        ud.cardSprite.position.copy(b.position);
      }
      if (ud.labelSprite) {
        ud.labelSprite.position.set(b.position.x, b.position.y - ud.cardW * 0.7, b.position.z);
      }
      if (ud.glowRing) {
        ud.glowRing.position.copy(b.position);
        ud.glowRing.position.z += 0.001;
      }
    }
  }

  /**
   * Update left palm tracking state (called from scene.js each frame).
   */
  updatePalm(palmCenter, palmOpen) {
    this.leftPalmCenter = palmCenter;
    this.leftPalmOpen = palmOpen;
    // Visibility driven by _palmOpenness animation in update()
  }

  // Find bubble at position within maxDist (finger must be close, not at distance)
  findBubbleAtPosition(pos, maxDist = 0.06) {
    let closest = null, cd = maxDist;
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue;
      const d = pos.distanceTo(b.position);
      if (d < cd) { cd = d; closest = b; }
    }
    return closest;
  }

  // Find the closest free bubble within 12cm (not in palm)
  findClosestFreeBubble(pinchPoint) {
    let closest = null, cd = 0.12;
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue;
      const d = pinchPoint.distanceTo(b.position);
      if (d < cd) { cd = d; closest = b; }
    }
    return closest;
  }

  // Raycast from hand direction to find a distant bubble (max 4m)
  findBubbleByRay(origin, direction) {
    const ray = new THREE.Raycaster(origin, direction.clone().normalize(), 0, 4);
    const spheres = this.fileBubbles
      .filter(b => !b.userData.inPalm && b.userData.sphere)
      .map(b => b.userData.sphere);
    if (!spheres.length) return null;
    const hits = ray.intersectObjects(spheres);
    if (!hits.length) return null;
    return this.fileBubbles.find(b => b.userData.sphere === hits[0].object) || null;
  }

  // Open a specific bubble (public entry point for drag-to-open)
  openBubble(bubble) {
    bubble.userData.scaleTarget = 1.3;
    setTimeout(() => { if (bubble.userData) bubble.userData.scaleTarget = 1; }, 200);
    this._openBubble(bubble);
  }

  handlePinch(pinchPoint) {
    const closest = this.findClosestFreeBubble(pinchPoint);
    if (closest) {
      closest.userData.scaleTarget = 1.3;
      setTimeout(() => { if (closest.userData) closest.userData.scaleTarget = 1; }, 200);
      this._openBubble(closest, pinchPoint);
      return true;
    }
    return false;
  }

  // Left hand: pinch free bubble → add to palm context (add only, no removal)
  handleLeftPinchAdd(pinchPoint) {
    if (!this._explorerVisible) return false;
    let closest = null, cd = 0.12;
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue;
      const d = pinchPoint.distanceTo(b.position);
      if (d < cd) { cd = d; closest = b; }
    }
    if (closest) {
      closest.userData.inPalm = true;
      closest.userData.scaleTarget = 0.32;
      closest.userData.palmOrbitIndex = this.palmBubbles.length;
      closest.visible = true;
      this.palmBubbles.push(closest);
      return true;
    }
    return false;
  }

  // Right hand: pinch palm bubble → remove from context
  handleRightPinchRemove(pinchPoint) {
    let pc = null, pd = 0.08, pi = -1;
    this.palmBubbles.forEach((b, i) => {
      const d = pinchPoint.distanceTo(b.position);
      if (d < pd) { pd = d; pc = b; pi = i; }
    });
    if (pc) {
      pc.userData.inPalm = false;
      if (this.openedBubble === pc) this.openedBubble = null;
      this.palmBubbles.splice(pi, 1);
      this.palmBubbles.forEach((b, i) => { b.userData.palmOrbitIndex = i; });

      if (pc.userData.parentDir === this.currentPath) {
        // Same folder — fly back to arc position
        pc.userData.scaleTarget = 1;
        pc.userData.targetPos = pc.userData.basePos.clone();
        pc.userData.restPos.copy(pc.userData.basePos);
        pc.visible = true;
      } else {
        // Different folder — fade out and destroy
        this.fileBubbles.splice(this.fileBubbles.indexOf(pc), 1);
        this._removing.push({ bubble: pc, progress: 0 });
      }
      return true;
    }
    return false;
  }

  // Right fist horizontal sweep → rotate all free bubbles around Y axis
  rotateBubbles(dx) {
    const a = dx * 3.5, cos = Math.cos(a), sin = Math.sin(a);
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue;
      const bp = b.userData.basePos;
      const nx = bp.x * cos + bp.z * sin, nz = -bp.x * sin + bp.z * cos;
      bp.x = nx; bp.z = nz;
      b.userData.restPos.x = nx; b.userData.restPos.z = nz;
    }
  }

  // Go back to parent directory
  navigateBack() {
    if (this.currentPath === '.') return;
    const parts = this.currentPath.split('/').filter(p => p && p !== '.');
    if (parts.length > 1) { parts.pop(); this.loadFiles(parts.join('/')); }
    else { this.loadFiles('.'); }
  }

  handleRaycast(raycaster) {
    const spheres = this.fileBubbles.map(b => b.userData.sphere).filter(Boolean);
    if (!spheres.length) return false;
    const hits = raycaster.intersectObjects(spheres);
    if (hits.length) {
      const bubble = this.fileBubbles.find(b => b.userData.sphere === hits[0].object);
      if (bubble) { this._openBubble(bubble); return true; }
    }
    return false;
  }

  async openFile(filePath) {
    // MCP-facing: open a file by path and show in window
    const parts = filePath.split('/');
    const filename = parts.pop();
    try {
      const res = await fetch('/api/companion/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      const data = await res.json();
      this._showFileInWindow(filename, data.content || '// empty', undefined, filePath);
    } catch (e) {
      this._showFileInWindow(filename, '// could not read file\n// ' + e.message, undefined, filePath);
    }
  }

  async _openBubble(bubble, pinchPoint) {
    const fd = bubble.userData.fileData;
    if (!fd) return;

    if (fd.type === 'folder') {
      this.loadFiles(this.currentPath === '.' ? fd.name : this.currentPath + '/' + fd.name);
      return;
    }

    // Mark opened — glow ring highlight
    if (this.openedBubble && this.openedBubble !== bubble) {
      this.openedBubble.userData.opened = false;
      if (this.openedBubble.userData.glowRingMat) this.openedBubble.userData.glowRingMat.opacity = 0;
    }
    bubble.userData.opened = true;
    if (bubble.userData.glowRingMat) {
      const ext = _ext(fd);
      bubble.userData.glowRingMat.color.set(EXT_COLORS[ext] || EXT_COLORS.default);
      bubble.userData.glowRingMat.opacity = 0.5;
    }
    this.openedBubble = bubble;

    // Position: open the panel right at the bubble (Iron Man style)
    const pos = bubble.position.clone();
    // Nudge slightly toward user so it doesn't overlap the bubble
    pos.z += 0.15;

    try {
      const fp = this.currentPath === '.' ? fd.name : this.currentPath + '/' + fd.name;
      const res = await fetch('/api/companion/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fp })
      });
      const data = await res.json();
      const content = data.content || '// empty';
      this._showFileInWindow(fd.name, content, pos, fp);
      const ext = _ext(fd);
      if (this.codeCity && CODE_EXTS.has(ext)) {
        this.codeCity.analyzeCode(content, ext, fd.name);
      }
    } catch (e) {
      this._showFileInWindow(fd.name, '// could not read file\n// ' + e.message, pos);
    }
  }

  _showFileInWindow(filename, content, position, filePath) {
    // Don't close previous — allow multiple panels open (Iron Man multi-panel)
    const pos = position ? [position.x, position.y, position.z] : [0.4, 1.4, -0.7];
    const handle = this._fileViewer.open({
      filename,
      content,
      filePath: filePath || filename,
      position: pos,
      width: 0.6,
      height: 0.45,
    });
    this._fileWindow = handle.window;
  }

  // ── MCP Scene Control Methods ────────────────────────

  _findBubbleByPath(filePath) {
    // Match by full path or just filename
    const name = filePath.split('/').pop();
    return this.fileBubbles.find(b => {
      const fd = b.userData.fileData;
      if (!fd) return false;
      return fd.name === name || fd.name === filePath;
    });
  }

  highlightFile(filePath, color, pulse) {
    const bubble = this._findBubbleByPath(filePath);
    if (!bubble) return;

    const hexColor = typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : 0xFF7000;
    // Glow ring
    if (bubble.userData.glowRingMat) {
      bubble.userData.glowRingMat.color.setHex(hexColor);
      bubble.userData.glowRingMat.opacity = 0.7;
    }
    // Scale bump
    bubble.userData.scaleTarget = 1.5;
    if (pulse) {
      bubble.userData._pulseColor = hexColor;
      bubble.userData._pulseEnd = performance.now() + 3000;
    }
    // Reset after 4s
    setTimeout(() => {
      if (bubble.userData.glowRingMat) bubble.userData.glowRingMat.opacity = 0;
      bubble.userData.scaleTarget = 1;
      bubble.userData._pulseColor = null;
    }, 4000);
  }

  showFileChange(filePath, action, summary) {
    // Navigate to the folder containing the file
    const parts = filePath.split('/');
    const filename = parts.pop();
    const folder = parts.length ? parts.join('/') : '.';

    // If we're not already in that folder, navigate there
    if (folder !== this.currentPath) {
      this.loadFiles(folder);
      // After load, highlight the file
      setTimeout(() => this.highlightFile(filename,
        action === 'create' ? '#22C55E' : action === 'delete' ? '#EF4444' : '#FF7000',
        true
      ), 800);
    } else {
      this.highlightFile(filename,
        action === 'create' ? '#22C55E' : action === 'delete' ? '#EF4444' : '#FF7000',
        true
      );
    }

    // For creates, reload to show new file
    if (action === 'create') {
      setTimeout(() => this.loadFiles(folder), 500);
    }
    // For deletes, the polling will catch the removal
  }

  moveFileBubble(filePath, position) {
    const bubble = this._findBubbleByPath(filePath);
    if (!bubble || !position) return;
    // Smooth animate to target position
    const target = new THREE.Vector3(position[0], position[1], position[2]);
    bubble.userData._moveTarget = target;
    bubble.userData._moveStart = bubble.position.clone();
    bubble.userData._moveT = 0;
  }

  // ── Explorer visibility toggle ──────────────────────────

  show() {
    if (this._explorerVisible) return;
    this._explorerVisible = true;
    this._showAnim = { progress: 0, direction: 'in' };
    // Make all bubbles visible so animation can start
    for (const b of this.fileBubbles) {
      if (b.userData.cardSprite) b.userData.cardSprite.visible = true;
      if (b.userData.labelSprite) b.userData.labelSprite.visible = true;
      if (b.userData.glowRing) b.userData.glowRing.visible = true;
    }
  }

  hide() {
    if (!this._explorerVisible) return;
    this._showAnim = { progress: 0, direction: 'out' };
    // _explorerVisible set to false when animation completes
  }

  isVisible() {
    return this._explorerVisible;
  }

  _setAllBubblesVisible(v) {
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue; // palm context always stays visible
      if (b.userData.cardSprite) b.userData.cardSprite.visible = v;
      if (b.userData.labelSprite) b.userData.labelSprite.visible = v;
      if (b.userData.glowRing) b.userData.glowRing.visible = v;
      b.visible = v;
    }
  }

  // Drive palm bubble position/scale/opacity from openness (0=closed at center, 1=open at orbit)
  _tickPalmOpenness(dt, elapsedSec) {
    const target = (this.leftPalmOpen && this.leftPalmCenter) ? 1 : 0;
    this._palmOpenness += (target - this._palmOpenness) * Math.min(1, dt * 12);
    const o = this._palmOpenness;

    for (const b of this.palmBubbles) {
      const ud = b.userData;
      const total = Math.max(this.palmBubbles.length, 1);
      const r     = (0.042 + total * 0.010) * o;  // orbit radius scales with openness
      const angle = elapsedSec * 1.5 + ((ud.palmOrbitIndex || 0) / total) * Math.PI * 2;
      const tilt  = (ud.palmOrbitIndex || 0) * 0.6;

      // Position: bloom out from palm center
      const cx = this.leftPalmCenter ? this.leftPalmCenter.x : b.position.x;
      const cy = this.leftPalmCenter ? this.leftPalmCenter.y : b.position.y;
      const cz = this.leftPalmCenter ? this.leftPalmCenter.z : b.position.z;
      b.position.lerp(new THREE.Vector3(
        cx + Math.cos(angle) * r,
        cy + Math.sin(angle) * Math.sin(tilt) * r * 0.5,
        cz + Math.sin(angle) * Math.cos(tilt) * r
      ), 0.28);  // snappier palm orbit

      // Scale and opacity
      const scale = o * ud.cardW * 0.32;
      const safeScale = Math.max(0.0001, scale);
      if (ud.cardSprite) {
        ud.cardSprite.visible = o > 0.02;
        ud.cardSprite.scale.set(safeScale, safeScale, 1);
        ud.cardSprite.position.copy(b.position);
      }
      if (ud.cardMat) ud.cardMat.opacity = o * 0.9;
      if (ud.labelSprite) {
        ud.labelSprite.visible = o > 0.15;
        ud.labelSprite.scale.set(Math.max(0.0001, ud.cardW * 2.2 * o * 0.32), Math.max(0.0001, ud.cardW * 0.42 * o * 0.32), 1);
        ud.labelSprite.position.set(b.position.x, b.position.y - ud.cardW * 0.7 * o, b.position.z);
      }
      if (ud.labelMat) ud.labelMat.opacity = o * 0.8;
      if (ud.glowRing) {
        ud.glowRing.visible = o > 0.02;
        ud.glowRing.position.copy(b.position);
        ud.glowRing.position.z += 0.001;
      }
    }
  }

  _applyExplorerOpacity(t) {
    // t: 0 = fully hidden, 1 = fully visible
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue;
      const ud = b.userData;
      const scale = t * ud.cardW;
      if (ud.cardSprite) ud.cardSprite.scale.set(scale, scale, 1);
      if (ud.cardMat) ud.cardMat.opacity = t * 0.9;
      if (ud.labelMat) ud.labelMat.opacity = t;
      if (ud.labelSprite) ud.labelSprite.scale.set(ud.cardW * 2.2 * t, ud.cardW * 0.42 * t, 1);
    }
  }
}

export { FileBubbleManager };
