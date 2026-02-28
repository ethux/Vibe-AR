// ═══════════════════════════════════════════════════════════════════
//  CodeCity.js — 3D Code City Visualization for WebXR AR
//  Adapted from xavier-work as ES module, routed through proxy
// ═══════════════════════════════════════════════════════════════════

class CodeCityRenderer {
  constructor(scene, camera, windowManager) {
    this.scene = scene;
    this.camera = camera;
    this.wm = windowManager;

    this.cityGroup = new THREE.Group();
    this.cityGroup.position.set(0, 0.8, -1.2);
    this.scene.add(this.cityGroup);

    this.buildingMeshes = [];
    this.connectionLines = [];
    this.outputMeshes = [];
    this.hotspotRings = [];
    this.districtPlates = [];

    this._tooltipWindow = null;
    this._hoveredEntry = null;
    this._hoverLockUntil = 0;

    this._raycaster = new THREE.Raycaster();
    this._tempMatrix = new THREE.Matrix4();

    this._controlPanel = null;
    this._layout = null;
    this._rightHandPos = null;

    this._grabState = [
      { grabbing: false, offset: new THREE.Vector3(), point: new THREE.Vector3() },
      { grabbing: false, offset: new THREE.Vector3(), point: new THREE.Vector3() }
    ];
    this._twoHandAnchor = null;
    this._matrixEffects = [];
  }

  // ── Analyze code via proxy to code-city-server ─────────────
  async analyzeCode(code, language, filename) {
    const loadingWin = this.wm.createWindow({
      title: 'CODE CITY',
      width: 0.5, height: 0.2,
      position: [0, 1.6, -0.8],
      content: (ctx, w, h) => {
        ctx.fillStyle = '#F97316';
        ctx.font = 'bold 22px monospace';
        ctx.fillText('ANALYZING CODE...', 30, 40);
        ctx.fillStyle = '#FFB347';
        ctx.font = '16px monospace';
        ctx.fillText('Sending to Mistral AI', 30, 70);
      }
    });

    try {
      const resp = await fetch('/api/codecity/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language, filename })
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Server error ${resp.status}: ${err}`);
      }

      const layout = await resp.json();
      loadingWin.close();
      this.clearCity();
      this.renderCity(layout);
      return layout;
    } catch (e) {
      loadingWin.setTitle('ERROR');
      loadingWin.setContent((ctx, w, h) => {
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('ANALYSIS FAILED', 30, 40);
        ctx.fillStyle = '#FCA5A5';
        ctx.font = '14px monospace';
        const msg = e.message || 'Unknown error';
        const maxW = w - 60;
        let line = '', y = 70;
        for (const word of msg.split(' ')) {
          const test = line + word + ' ';
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, 30, y); y += 20; line = word + ' ';
          } else { line = test; }
        }
        if (line) ctx.fillText(line, 30, y);
      });
      console.error('CodeCity analysis failed:', e);
      return null;
    }
  }

  renderCity(layout) {
    this._layout = layout;

    // District plates (floor) removed — city floats without a ground plane

    if (layout.buildings) {
      for (const b of layout.buildings) {
        const w = Math.max(0.08, b.width || 0.2);
        const h = Math.max(0.08, b.height || 0.3);
        const d = Math.max(0.08, b.depth || 0.2);
        const geo = new THREE.BoxGeometry(w, h, d);
        const matFx = this._initMatrixEffect(b, w, h);
        this._matrixEffects.push(matFx);
        const mat = new THREE.MeshStandardMaterial({
          color: 0x000000, emissive: new THREE.Color(1, 1, 1),
          emissiveMap: matFx.texture, emissiveIntensity: 1.0,
          roughness: 0.9, metalness: 0.0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x || 0, h / 2, b.z || 0);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.cityGroup.add(mesh);
        this.buildingMeshes.push({ mesh, entry: b });
      }
    }

    if (layout.connections) {
      const buildingMap = {};
      for (const bm of this.buildingMeshes) buildingMap[bm.entry.id] = bm;
      for (const conn of layout.connections) {
        const fromBm = buildingMap[conn.from], toBm = buildingMap[conn.to];
        if (!fromBm || !toBm) continue;
        const fromPos = fromBm.mesh.position, toPos = toBm.mesh.position;
        const midY = Math.max(fromPos.y, toPos.y) + 0.3;
        const midPoint = new THREE.Vector3((fromPos.x + toPos.x) / 2, midY, (fromPos.z + toPos.z) / 2);
        const curve = new THREE.QuadraticBezierCurve3(fromPos.clone(), midPoint, toPos.clone());
        const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(20));
        const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(conn.color || '#666666'), transparent: true, opacity: 0.5 });
        const line = new THREE.Line(lineGeo, lineMat);
        this.cityGroup.add(line);
        this.connectionLines.push(line);
      }
    }

    if (layout.outputs) {
      for (const out of layout.outputs) {
        const cylGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8);
        const cylMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(out.color || '#EAB308'),
          emissive: new THREE.Color(out.color || '#EAB308'),
          emissiveIntensity: 0.2, roughness: 0.3
        });
        const cyl = new THREE.Mesh(cylGeo, cylMat);
        cyl.position.set(out.x || 2, 0.1, out.z || 0);
        this.cityGroup.add(cyl);
        this.outputMeshes.push(cyl);
      }
    }

    if (layout.hotspots && layout.buildings) {
      const buildingMap = {};
      for (const bm of this.buildingMeshes) buildingMap[bm.entry.id] = bm;
      for (const hotId of layout.hotspots) {
        const bm = buildingMap[hotId];
        if (!bm) continue;
        const ringGeo = new THREE.RingGeometry(0.12, 0.15, 16);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xEF4444, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(bm.mesh.position);
        ring.position.y = bm.mesh.position.y + (bm.entry.height || 0.3) / 2 + 0.02;
        this.cityGroup.add(ring);
        this.hotspotRings.push(ring);
      }
    }

    this._showControlPanel(layout);
  }

  _showControlPanel(layout) {
    const stats = layout.stats || {};
    this._controlPanel = this.wm.createWindow({
      title: 'CODE CITY',
      width: 0.45, height: 0.4, position: [0.5, 1.5, -0.8],
      content: (ctx, w, h) => {
        let y = 10;
        ctx.fillStyle = '#F97316'; ctx.font = 'bold 20px monospace';
        ctx.fillText(layout.cityName || 'CODE CITY', 20, y += 20);
        ctx.fillStyle = '#FFB347'; ctx.font = '16px monospace'; y += 10;
        ctx.fillText(`LOC: ${stats.totalLOC || '?'}`, 20, y += 22);
        ctx.fillText(`Classes: ${stats.numClasses || 0}  Functions: ${stats.numFunctions || 0}`, 20, y += 22);
        ctx.fillText(`Variables: ${stats.numVariables || 0}  Imports: ${stats.numImports || 0}`, 20, y += 22);
        y += 15; ctx.fillStyle = '#888'; ctx.font = '14px monospace';
        ctx.fillText('LEGEND:', 20, y += 18);
        const legend = [
          { color: '#F97316', label: 'Class' }, { color: '#3B82F6', label: 'Function' },
          { color: '#22C55E', label: 'Variable' }, { color: '#A855F7', label: 'Import' },
          { color: '#EF4444', label: 'Hotspot' },
        ];
        for (const item of legend) {
          y += 20; ctx.fillStyle = item.color; ctx.fillRect(20, y - 10, 14, 14);
          ctx.fillStyle = '#ccc'; ctx.font = '14px monospace'; ctx.fillText(item.label, 42, y + 2);
        }
      }
    });
  }

  // fingerTips: array of { pos: THREE.Vector3, handedness: 'left'|'right' } for each hand's index finger tip
  updateHover(fingerTips) {
    if (!fingerTips || this.buildingMeshes.length === 0) return;
    let closestDist = Infinity, closestEntry = null, touchingFingerPos = null;
    const TOUCH_THRESHOLD = 0.05; // 5cm — finger must be very close to building

    for (const ft of fingerTips) {
      if (!ft || !ft.pos) continue;
      // Convert finger world position into cityGroup local space
      const localPos = ft.pos.clone();
      this.cityGroup.worldToLocal(localPos);

      for (const bm of this.buildingMeshes) {
        const mesh = bm.mesh;
        const b = bm.entry;
        const hw = Math.max(0.08, b.width || 0.2) / 2;
        const hh = Math.max(0.08, b.height || 0.3) / 2;
        const hd = Math.max(0.08, b.depth || 0.2) / 2;
        const mp = mesh.position;
        // Distance from finger to building surface (axis-aligned box)
        const dx = Math.max(0, Math.abs(localPos.x - mp.x) - hw);
        const dy = Math.max(0, Math.abs(localPos.y - mp.y) - hh);
        const dz = Math.max(0, Math.abs(localPos.z - mp.z) - hd);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < TOUCH_THRESHOLD && dist < closestDist) {
          closestDist = dist;
          closestEntry = bm.entry;
          touchingFingerPos = ft.pos; // world position of the touching finger
        }
      }
    }
    const now = performance.now();
    if (closestEntry && closestEntry !== this._hoveredEntry) {
      this._hoveredEntry = closestEntry;
      this._hoverLockUntil = now + 500;
      this._showTooltip(closestEntry, touchingFingerPos);
    } else if (closestEntry && closestEntry === this._hoveredEntry && touchingFingerPos) {
      // Update tooltip position to follow finger
      this._updateTooltipPosition(touchingFingerPos);
    } else if (!closestEntry && this._hoveredEntry && now > this._hoverLockUntil) {
      this._hoveredEntry = null;
      this._hideTooltip();
    }
  }

  _showTooltip(entry, fingerPos) {
    this._hideTooltip();
    const pos = fingerPos ? [fingerPos.x, fingerPos.y + 0.06, fingerPos.z] : [-0.5, 1.5, -0.8];
    this._tooltipWindow = this.wm.createWindow({
      title: entry.name || 'BUILDING', width: 0.22, height: 0.12, position: pos,
      content: (ctx, w, h) => {
        const colors = { 'class': '#F97316', 'function': '#3B82F6', 'variable': '#22C55E', 'import': '#A855F7' };
        ctx.fillStyle = colors[entry.type] || '#888';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(entry.type ? entry.type.toUpperCase() : '?', 10, 18);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px monospace';
        ctx.fillText((entry.name || '???').substring(0, 20), 10, 38);
        if (entry.metrics) {
          ctx.fillStyle = '#FFB347'; ctx.font = '11px monospace';
          ctx.fillText(`LOC:${entry.metrics.loc || '?'} C:${entry.metrics.complexity || '?'}`, 10, 55);
        }
      }
    });
  }

  _updateTooltipPosition(fingerPos) {
    if (this._tooltipWindow && this._tooltipWindow.root) {
      this._tooltipWindow.root.position.set(fingerPos.x, fingerPos.y + 0.06, fingerPos.z);
    }
  }

  _hideTooltip() {
    if (this._tooltipWindow) { this._tooltipWindow.close(); this._tooltipWindow = null; }
  }

  // ── Grab interaction ───────────────────────────────────────
  onGrabStart(handIdx, grabPoint) {
    const gs = this._grabState[handIdx];
    gs.grabbing = true; gs.point.copy(grabPoint);
    gs.offset.copy(this.cityGroup.position).sub(grabPoint);
    if (this._grabState[1 - handIdx].grabbing) this._initTwoHandAnchor();
  }

  onGrabEnd(handIdx) {
    this._grabState[handIdx].grabbing = false;
    this._twoHandAnchor = null;
    const other = this._grabState[1 - handIdx];
    if (other.grabbing) other.offset.copy(this.cityGroup.position).sub(other.point);
  }

  onGrabMove(handIdx, grabPoint) {
    const gs = this._grabState[handIdx];
    gs.point.copy(grabPoint);
    const otherGs = this._grabState[1 - handIdx];

    if (gs.grabbing && otherGs.grabbing) {
      if (!this._twoHandAnchor) this._initTwoHandAnchor();
      const anchor = this._twoHandAnchor;
      const p0 = this._grabState[0].point, p1 = this._grabState[1].point;
      const currentDist = p0.distanceTo(p1);
      const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2, midZ = (p0.z + p1.z) / 2;
      const scaleFactor = (currentDist / anchor.startDist) * anchor.startScale;
      this.cityGroup.scale.setScalar(Math.max(0.05, Math.min(5.0, scaleFactor)));
      const currentAngle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      this.cityGroup.rotation.y = anchor.startRotY + (currentAngle - anchor.startAngle);
      this.cityGroup.position.set(midX + anchor.startPosOffset.x, midY + anchor.startPosOffset.y, midZ + anchor.startPosOffset.z);
    } else if (gs.grabbing) {
      this.cityGroup.position.copy(grabPoint).add(gs.offset);
    }
  }

  _initTwoHandAnchor() {
    const p0 = this._grabState[0].point, p1 = this._grabState[1].point;
    const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2, midZ = (p0.z + p1.z) / 2;
    this._twoHandAnchor = {
      startDist: Math.max(0.01, p0.distanceTo(p1)),
      startScale: this.cityGroup.scale.x,
      startAngle: Math.atan2(p1.x - p0.x, p1.z - p0.z),
      startRotY: this.cityGroup.rotation.y,
      startPosOffset: new THREE.Vector3(this.cityGroup.position.x - midX, this.cityGroup.position.y - midY, this.cityGroup.position.z - midZ)
    };
  }

  clearCity() {
    while (this.cityGroup.children.length > 0) {
      const child = this.cityGroup.children[0];
      this.cityGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }
    this.buildingMeshes = []; this.connectionLines = [];
    this.outputMeshes = []; this.hotspotRings = []; this.districtPlates = [];
    for (const fx of this._matrixEffects) { if (fx.texture) fx.texture.dispose(); }
    this._matrixEffects = [];
    if (this._controlPanel) { this._controlPanel.close(); this._controlPanel = null; }
    this._hideTooltip();
    this._layout = null; this._hoveredEntry = null;
  }

  _matrixPalette(type) {
    const p = {
      'class':    { bright: '#FFCC44', mid: '#F97316' },
      'function': { bright: '#93C5FD', mid: '#3B82F6' },
      'variable': { bright: '#86EFAC', mid: '#22C55E' },
      'import':   { bright: '#E9D5FF', mid: '#A855F7' },
    };
    return p[type] || p['class'];
  }

  _initMatrixEffect(building, bw, bh) {
    const CW = 128, CH = 256;
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
    const palette = this._matrixPalette(building.type);
    const FS = 9;
    const cols = Math.floor(CW / FS);
    const heightNorm = Math.min(1.0, Math.max(0.1, bh / 0.4));
    const baseSpeed = 5 + heightNorm * 15;
    const drops = Array.from({ length: cols }, () => ({
      y: Math.random() * (CH / FS), speed: baseSpeed * (0.6 + Math.random() * 0.8),
      waitUntil: Math.random() * 1.5,
    }));
    const texture = new THREE.CanvasTexture(canvas);
    return { canvas, ctx, cols, drops, palette, FS, CW, CH, texture, elapsed: 0 };
  }

  updateMatrix(dt) {
    if (!this._matrixEffects.length) return;
    const CHARS = '01{}[]()=+-*/;:.#<>!&|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const cdt = Math.min(dt, 0.05);
    for (const fx of this._matrixEffects) {
      const { ctx, cols, drops, palette, FS, CW, CH, texture } = fx;
      fx.elapsed += cdt;
      const fadeA = Math.min(0.9, 0.04 * cdt * 60);
      ctx.fillStyle = `rgba(0,0,0,${fadeA.toFixed(3)})`;
      ctx.fillRect(0, 0, CW, CH);
      ctx.font = `bold ${FS}px monospace`;
      for (let i = 0; i < cols; i++) {
        const drop = drops[i];
        if (fx.elapsed < drop.waitUntil) continue;
        const x = i * FS, y = drop.y * FS;
        ctx.fillStyle = palette.bright;
        ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], x, y);
        drop.y += drop.speed * cdt;
        if (drop.y * FS > CH) { drop.y = -(Math.random() * 3); drop.waitUntil = fx.elapsed + Math.random() * 1.2; }
      }
      texture.needsUpdate = true;
    }
  }
}

export { CodeCityRenderer };
