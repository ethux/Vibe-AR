// ═══════════════════════════════════════════════════════════════════
//  bubbles.js — File Bubble Visualization for WebXR AR
//  Adapted from sacha-work as ES module class
//  Live-updating: WebSocket watcher + polling fallback
// ═══════════════════════════════════════════════════════════════════

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
    this._watchWs = null;
    this._pollTimer = null;
    this._watchGen = 0;   // generation counter to prevent stale WS handlers
    this._lastEntryNames = new Set();
    // Bubbles pending spawn/remove animation
    this._spawning = [];  // { bubble, progress }
    this._removing = [];  // { bubble, progress }
    // Palm-orbit grab state (from sacha-work)
    this.palmBubbles = [];       // bubbles orbiting the left palm
    this.leftPalmCenter = null;  // THREE.Vector3, updated by scene.js
    this.leftPalmOpen = false;   // whether left palm is open (show/hide palm bubbles)
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

    let entries;
    try {
      const res = await fetch('/api/companion/files/list?path=' + encodeURIComponent(dirPath));
      const data = await res.json();
      entries = data.entries && data.entries.length ? data.entries : FALLBACK;
    } catch {
      entries = FALLBACK;
    }

    // Prepend ".." back bubble when not at root
    if (dirPath !== '.') {
      entries = [{ name: '..', type: 'folder', _isBack: true }, ...entries];
    }

    entries.forEach((e, i) => {
      const b = this._createBubble(e, i, entries.length);
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
    // Remove bubbles for deleted files
    for (const r of removed) {
      const idx = this.fileBubbles.findIndex(b => b.userData.fileData?.name === r.name);
      if (idx !== -1) {
        const bubble = this.fileBubbles[idx];
        this.fileBubbles.splice(idx, 1);
        this._removing.push({ bubble, progress: 0 });
      }
    }

    // Add bubbles for new files
    const total = allEntries.length;
    for (const a of added) {
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
      const bubble = this.fileBubbles.find(b => b.userData.fileData?.name === entries[i].name);
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
    this.fileBubbles.forEach(b => this._destroyBubble(b));
    this.fileBubbles.length = 0;
    this.palmBubbles.length = 0;
    this._spawning.length = 0;
    this._removing.length = 0;
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
    group.userData = { fileData, opened: false, color, cardW, index, spawnScale: 0 };

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

    this.scene.add(group);
    this.fileBubbles.push(group);
    return group;
  }

  update(dt, elapsed) {
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

    // Update live bubbles
    const now = performance.now();
    for (const b of this.fileBubbles) {
      const ud = b.userData;

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
      // Smooth move to target position (when relayout happens)
      else if (ud.targetPos) {
        b.position.x += (ud.targetPos.x - b.position.x) * Math.min(1, dt * 5);
        b.position.z += (ud.targetPos.z - b.position.z) * Math.min(1, dt * 5);
        ud.basePos.x = b.position.x;
        ud.basePos.z = b.position.z;
        if (Math.abs(b.position.x - ud.targetPos.x) < 0.001) {
          ud.basePos.copy(ud.targetPos);
          ud.targetPos = null;
        }
      }

      // Palm orbit — move inPalm bubbles around leftPalmCenter
      if (ud.inPalm && this.leftPalmCenter) {
        const total = Math.max(this.palmBubbles.length, 1);
        const r     = 0.07 + total * 0.018;
        const angle = elapsed * 1.5 + ((ud.palmOrbitIndex || 0) / total) * Math.PI * 2;
        const tilt  = (ud.palmOrbitIndex || 0) * 0.6;
        b.position.lerp(new THREE.Vector3(
          this.leftPalmCenter.x + Math.cos(angle) * r,
          this.leftPalmCenter.y + Math.sin(angle) * Math.sin(tilt) * r * 0.5,
          this.leftPalmCenter.z + Math.sin(angle) * Math.cos(tilt) * r
        ), 0.15);
      } else if (!ud.inPalm && !ud._moveTarget) {
        // Bobbing (only for free bubbles, skip during MCP move)
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
        const ns = cs + (ud.scaleTarget - cs) * 0.12;
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
    // Show/hide palm bubbles based on palm state
    for (const b of this.palmBubbles) {
      if (b.userData.cardSprite) b.userData.cardSprite.visible = palmOpen;
      if (b.userData.labelSprite) b.userData.labelSprite.visible = palmOpen;
      if (b.userData.glowRing) b.userData.glowRing.visible = palmOpen;
    }
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

  // Left hand: pinch free bubble → add to palm context; pinch palm bubble → remove from context
  handleLeftPinch(pinchPoint) {
    // Free bubble first (radius 12cm) → add to context
    let closest = null, cd = 0.12;
    for (const b of this.fileBubbles) {
      if (b.userData.inPalm) continue;
      const d = pinchPoint.distanceTo(b.position);
      if (d < cd) { cd = d; closest = b; }
    }
    if (closest) {
      closest.userData.inPalm = true;
      closest.userData.scaleTarget = 0.5;
      closest.userData.palmOrbitIndex = this.palmBubbles.length;
      closest.visible = true;
      this.palmBubbles.push(closest);
      return true;
    }
    // Palm bubble (radius 8cm) → remove from context
    let pc = null, pd = 0.08, pi = -1;
    this.palmBubbles.forEach((b, i) => {
      const d = pinchPoint.distanceTo(b.position);
      if (d < pd) { pd = d; pc = b; pi = i; }
    });
    if (pc) {
      pc.userData.inPalm = false;
      pc.userData.scaleTarget = 1;
      pc.userData.restPos.copy(pc.userData.basePos);
      pc.visible = true;
      if (this.openedBubble === pc) this.openedBubble = null;
      this.palmBubbles.splice(pi, 1);
      this.palmBubbles.forEach((b, i) => { b.userData.palmOrbitIndex = i; });
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
      this._showFileInWindow(filename, data.content || '// empty');
    } catch (e) {
      this._showFileInWindow(filename, '// could not read file\n// ' + e.message);
    }
  }

  async _openBubble(bubble, pinchPoint) {
    const fd = bubble.userData.fileData;
    if (!fd) return;

    if (fd.type === 'folder') {
      if (fd._isBack || fd.name === '..') {
        const parts = this.currentPath.split('/');
        parts.pop();
        this.loadFiles(parts.length ? parts.join('/') : '.');
      } else {
        this.loadFiles(this.currentPath === '.' ? fd.name : this.currentPath + '/' + fd.name);
      }
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
      this._showFileInWindow(fd.name, content, pos);
      const ext = _ext(fd);
      if (this.codeCity && CODE_EXTS.has(ext)) {
        this.codeCity.analyzeCode(content, ext, fd.name);
      }
    } catch (e) {
      this._showFileInWindow(fd.name, '// could not read file\n// ' + e.message, pos);
    }
  }

  _showFileInWindow(filename, content, position) {
    // Don't close previous — allow multiple panels open (Iron Man multi-panel)
    const pos = position ? [position.x, position.y, position.z] : [0.4, 1.4, -0.7];
    const win = this.wm.createWindow({
      title: filename.toUpperCase(),
      width: 0.5,
      height: 0.4,
      position: pos,
      canvasWidth: 512,
      canvasHeight: 400,
      closable: true,
      content: (ctx, w, h) => {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        // Holographic scan-line overlay
        ctx.strokeStyle = 'rgba(255, 112, 0, 0.04)';
        for (let y = 0; y < h; y += 3) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Syntax-colored code
        ctx.font = '13px monospace';
        const lines = content.split('\n');
        const maxLines = Math.floor((h - 20) / 16);
        for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
          const line = lines[i].substring(0, 60);
          // Simple syntax coloring
          if (/^\s*(\/\/|#|--|\*)/.test(line)) {
            ctx.fillStyle = '#666'; // comments
          } else if (/^\s*(import|from|export|const|let|var|function|class|def|return|if|else|for|while)\b/.test(line)) {
            ctx.fillStyle = '#FF7000'; // keywords → Mistral orange
          } else if (/"[^"]*"|'[^']*'|`[^`]*`/.test(line)) {
            ctx.fillStyle = '#50fa7b'; // strings → green
          } else {
            ctx.fillStyle = '#e0e0e0'; // default
          }
          ctx.fillText(line, 10, 18 + i * 16);
        }

        // Line numbers
        ctx.fillStyle = 'rgba(255,112,0,0.3)';
        ctx.font = '11px monospace';
        for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
          ctx.fillText(String(i + 1).padStart(3), 490, 18 + i * 16);
        }
      }
    });
    this._fileWindow = win;
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
}

export { FileBubbleManager };
