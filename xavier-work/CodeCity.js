// ═══════════════════════════════════════════════════════════════════
//  CodeCity.js — 3D Code City Visualization for WebXR AR
// ═══════════════════════════════════════════════════════════════════
//
//  Depends on: THREE.js, WindowManager.js, ManagedWindow.js, PixelArt.js
//
//  USAGE:
//    const codeCity = new CodeCityRenderer(scene, camera, wm);
//    codeCity.analyzeCode('class Foo:\n  pass', 'python', 'foo.py');
//
//    // In animation loop:
//    codeCity.updateHover([controller0, controller1]);
//
// ═══════════════════════════════════════════════════════════════════

class CodeCityRenderer {
  constructor(scene, camera, windowManager) {
    this.scene = scene;
    this.camera = camera;
    this.wm = windowManager;

    // Server endpoint
    this.serverUrl = 'http://172.16.0.12:5001';

    // 3D objects group
    this.cityGroup = new THREE.Group();
    this.cityGroup.position.set(0, 0.8, -1.2); // place city in front of user at table height
    this.scene.add(this.cityGroup);

    // Tracking arrays
    this.buildingMeshes = [];   // { mesh, entry } pairs for raycasting
    this.connectionLines = [];
    this.outputMeshes = [];
    this.hotspotRings = [];
    this.districtPlates = [];

    // Tooltip state
    this._tooltipWindow = null;
    this._hoveredEntry = null;
    this._hoverLockUntil = 0; // timestamp — prevent flicker by holding tooltip briefly

    // Raycaster for hover detection
    this._raycaster = new THREE.Raycaster();
    this._tempMatrix = new THREE.Matrix4();

    // Control panel window
    this._controlPanel = null;

    // Current layout data
    this._layout = null;

    // Right hand position (updated from app.js for tooltip following)
    this._rightHandPos = null;

    // Grab interaction state
    this._grabState = [
      { grabbing: false, offset: new THREE.Vector3(), point: new THREE.Vector3() },
      { grabbing: false, offset: new THREE.Vector3(), point: new THREE.Vector3() }
    ];
    this._twoHandAnchor = null;

    // Matrix rain effects per building
    this._matrixEffects = [];
  }

  // ── Analyze code via server ──────────────────────────────────
  async analyzeCode(code, language, filename) {
    // Show loading window
    const loadingWin = this.wm.createWindow({
      title: 'CODE CITY',
      width: 0.5,
      height: 0.2,
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
      const resp = await fetch(`${this.serverUrl}/analyze`, {
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
      // Update loading window to show error
      loadingWin.setTitle('ERROR');
      loadingWin.setContent((ctx, w, h) => {
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 20px monospace';
        ctx.fillText('ANALYSIS FAILED', 30, 40);
        ctx.fillStyle = '#FCA5A5';
        ctx.font = '14px monospace';
        const msg = e.message || 'Unknown error';
        // Word wrap the error
        const maxW = w - 60;
        let line = '';
        let y = 70;
        for (const word of msg.split(' ')) {
          const test = line + word + ' ';
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, 30, y);
            y += 20;
            line = word + ' ';
          } else {
            line = test;
          }
        }
        if (line) ctx.fillText(line, 30, y);
      });
      console.error('CodeCity analysis failed:', e);
      return null;
    }
  }

  // ── Render the city from layout data ─────────────────────────
  renderCity(layout) {
    this._layout = layout;

    // Districts (colored ground plates)
    if (layout.districts) {
      for (const d of layout.districts) {
        const plateGeo = new THREE.PlaneGeometry(d.width || 1.5, d.depth || 1.5);
        const plateMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(d.color || '#333333'),
          transparent: true,
          opacity: 0.3,
          roughness: 0.8,
          side: THREE.DoubleSide
        });
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(d.x || 0, 0, d.z || 0);
        this.cityGroup.add(plate);
        this.districtPlates.push(plate);
      }
    }

    // Buildings (cubes)
    if (layout.buildings) {
      for (const b of layout.buildings) {
        const w = Math.max(0.08, b.width || 0.2);
        const h = Math.max(0.08, b.height || 0.3);
        const d = Math.max(0.08, b.depth || 0.2);

        const geo = new THREE.BoxGeometry(w, h, d);

        // Matrix rain canvas texture per building
        const matFx = this._initMatrixEffect(b, w, h);
        this._matrixEffects.push(matFx);

        const mat = new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: new THREE.Color(1, 1, 1),
          emissiveMap: matFx.texture,
          emissiveIntensity: 1.0,
          roughness: 0.9,
          metalness: 0.0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(b.x || 0, h / 2, b.z || 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.cityGroup.add(mesh);

        this.buildingMeshes.push({ mesh, entry: b });
      }
    }

    // Connections (arcs between buildings)
    if (layout.connections) {
      const buildingMap = {};
      for (const bm of this.buildingMeshes) {
        buildingMap[bm.entry.id] = bm;
      }

      for (const conn of layout.connections) {
        const fromBm = buildingMap[conn.from];
        const toBm = buildingMap[conn.to];
        if (!fromBm || !toBm) continue;

        const fromPos = fromBm.mesh.position;
        const toPos = toBm.mesh.position;
        const midY = Math.max(fromPos.y, toPos.y) + 0.3;
        const midPoint = new THREE.Vector3(
          (fromPos.x + toPos.x) / 2,
          midY,
          (fromPos.z + toPos.z) / 2
        );

        const curve = new THREE.QuadraticBezierCurve3(
          fromPos.clone(),
          midPoint,
          toPos.clone()
        );
        const points = curve.getPoints(20);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({
          color: new THREE.Color(conn.color || '#666666'),
          transparent: true,
          opacity: 0.5
        });
        const line = new THREE.Line(lineGeo, lineMat);
        this.cityGroup.add(line);
        this.connectionLines.push(line);
      }
    }

    // Outputs (cylinders outside city)
    if (layout.outputs) {
      for (const out of layout.outputs) {
        const cylGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8);
        const cylMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(out.color || '#EAB308'),
          emissive: new THREE.Color(out.color || '#EAB308'),
          emissiveIntensity: 0.2,
          roughness: 0.3
        });
        const cyl = new THREE.Mesh(cylGeo, cylMat);
        cyl.position.set(out.x || 2, 0.1, out.z || 0);
        this.cityGroup.add(cyl);
        this.outputMeshes.push(cyl);
      }
    }

    // Hotspot rings
    if (layout.hotspots && layout.buildings) {
      const buildingMap = {};
      for (const bm of this.buildingMeshes) {
        buildingMap[bm.entry.id] = bm;
      }

      for (const hotId of layout.hotspots) {
        const bm = buildingMap[hotId];
        if (!bm) continue;

        const ringGeo = new THREE.RingGeometry(0.12, 0.15, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xEF4444,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(bm.mesh.position);
        ring.position.y = bm.mesh.position.y + (bm.entry.height || 0.3) / 2 + 0.02;
        this.cityGroup.add(ring);
        this.hotspotRings.push(ring);
      }
    }

    // Control panel window
    this._showControlPanel(layout);
  }

  // ── Control panel with stats + legend ────────────────────────
  _showControlPanel(layout) {
    const stats = layout.stats || {};
    this._controlPanel = this.wm.createWindow({
      title: 'CODE CITY',
      width: 0.45,
      height: 0.4,
      position: [0.5, 1.5, -0.8],
      content: (ctx, w, h) => {
        const ps = 3;
        let y = 10;

        // City name
        ctx.fillStyle = '#F97316';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(layout.cityName || 'CODE CITY', 20, y += 20);

        // Stats
        ctx.fillStyle = '#FFB347';
        ctx.font = '16px monospace';
        y += 10;
        ctx.fillText(`LOC: ${stats.totalLOC || '?'}`, 20, y += 22);
        ctx.fillText(`Classes: ${stats.numClasses || 0}  Functions: ${stats.numFunctions || 0}`, 20, y += 22);
        ctx.fillText(`Variables: ${stats.numVariables || 0}  Imports: ${stats.numImports || 0}`, 20, y += 22);

        // Legend
        y += 15;
        ctx.fillStyle = '#888';
        ctx.font = '14px monospace';
        ctx.fillText('LEGEND:', 20, y += 18);

        const legend = [
          { color: '#F97316', label: 'Class' },
          { color: '#3B82F6', label: 'Function' },
          { color: '#22C55E', label: 'Variable' },
          { color: '#A855F7', label: 'Import' },
          { color: '#EF4444', label: 'Hotspot (complex)' },
        ];

        for (const item of legend) {
          y += 20;
          ctx.fillStyle = item.color;
          ctx.fillRect(20, y - 10, 14, 14);
          ctx.fillStyle = '#ccc';
          ctx.font = '14px monospace';
          ctx.fillText(item.label, 42, y + 2);
        }
      }
    });
  }

  // ── Hover detection from controllers ─────────────────────────
  updateHover(controllers) {
    if (!controllers || this.buildingMeshes.length === 0) return;

    let closestHit = null;
    let closestDist = Infinity;
    let closestEntry = null;

    for (const ctrl of controllers) {
      if (!ctrl || !ctrl.matrixWorld) continue;

      this._tempMatrix.identity().extractRotation(ctrl.matrixWorld);
      this._raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
      this._raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this._tempMatrix);

      const meshes = this.buildingMeshes.map(bm => bm.mesh);
      const hits = this._raycaster.intersectObjects(meshes, false);

      if (hits.length > 0 && hits[0].distance < closestDist) {
        closestDist = hits[0].distance;
        closestHit = hits[0];
        // Find the entry for this mesh
        const bm = this.buildingMeshes.find(b => b.mesh === hits[0].object);
        if (bm) closestEntry = bm.entry;
      }
    }

    const now = performance.now();
    if (closestEntry && closestEntry !== this._hoveredEntry) {
      this._hoveredEntry = closestEntry;
      this._hoverLockUntil = now + 500; // hold for 500ms min
      this._showTooltip(closestEntry);
    } else if (!closestEntry && this._hoveredEntry && now > this._hoverLockUntil) {
      this._hoveredEntry = null;
      this._hideTooltip();
    }
  }

  // ── Tooltip window for a building ────────────────────────────
  _showTooltip(entry) {
    this._hideTooltip();

    const hp = this._rightHandPos;
    const tooltipPos = hp ? [hp.x, hp.y + 0.12, hp.z] : [-0.5, 1.5, -0.8];

    this._tooltipWindow = this.wm.createWindow({
      title: entry.name || 'BUILDING',
      width: 0.22,
      height: 0.12,
      position: tooltipPos,
      content: (ctx, w, h) => {
        const typeColors = {
          'class': '#F97316',
          'function': '#3B82F6',
          'variable': '#22C55E',
          'import': '#A855F7'
        };
        ctx.fillStyle = typeColors[entry.type] || '#888';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(entry.type ? entry.type.toUpperCase() : '?', 10, 18);

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px monospace';
        const name = (entry.name || '???').substring(0, 20);
        ctx.fillText(name, 10, 38);

        if (entry.metrics) {
          ctx.fillStyle = '#FFB347';
          ctx.font = '11px monospace';
          ctx.fillText(`LOC:${entry.metrics.loc || '?'} C:${entry.metrics.complexity || '?'}`, 10, 55);
        }
      }
    });
  }

  _hideTooltip() {
    if (this._tooltipWindow) {
      this._tooltipWindow.close();
      this._tooltipWindow = null;
    }
  }

  // ── Grab interaction: move / rotate / scale ─────────────────
  onGrabStart(handIdx, grabPoint) {
    const gs = this._grabState[handIdx];
    gs.grabbing = true;
    gs.point.copy(grabPoint);
    // Offset = city position minus grab point (so city doesn't snap to hand)
    gs.offset.copy(this.cityGroup.position).sub(grabPoint);

    // Check if both hands are now grabbing → init two-hand anchor
    const other = this._grabState[1 - handIdx];
    if (other.grabbing) {
      this._initTwoHandAnchor();
    }
  }

  onGrabEnd(handIdx) {
    this._grabState[handIdx].grabbing = false;
    this._twoHandAnchor = null;

    // If the other hand is still grabbing, recalculate its single-hand offset
    const other = this._grabState[1 - handIdx];
    if (other.grabbing) {
      other.offset.copy(this.cityGroup.position).sub(other.point);
    }
  }

  onGrabMove(handIdx, grabPoint) {
    const gs = this._grabState[handIdx];
    gs.point.copy(grabPoint);

    const otherGs = this._grabState[1 - handIdx];

    if (gs.grabbing && otherGs.grabbing) {
      // ── Two-hand: move + rotate + scale ──
      // Grab points stay locked to where the hands originally touched.
      if (!this._twoHandAnchor) this._initTwoHandAnchor();
      const anchor = this._twoHandAnchor;

      const p0 = this._grabState[0].point;
      const p1 = this._grabState[1].point;

      // Local grab points (in city local space at grab time)
      const lx0 = anchor.local0.x, lz0 = anchor.local0.z;
      const lx1 = anchor.local1.x, lz1 = anchor.local1.z;

      // World hand positions
      const wx0 = p0.x, wz0 = p0.z;
      const wx1 = p1.x, wz1 = p1.z;

      // Local vector between grab points
      const ldx = lx1 - lx0, ldz = lz1 - lz0;
      const localDist = Math.sqrt(ldx * ldx + ldz * ldz);

      // World vector between hands
      const wdx = wx1 - wx0, wdz = wz1 - wz0;
      const worldDist = Math.sqrt(wdx * wdx + wdz * wdz);

      // Scale
      const newScale = (localDist > 0.001)
        ? Math.max(0.05, Math.min(5.0, worldDist / localDist))
        : anchor.startScale;
      this.cityGroup.scale.setScalar(newScale);

      // Rotation
      const localAngle = Math.atan2(ldx, ldz);
      const worldAngle = Math.atan2(wdx, wdz);
      const newRotY = worldAngle - localAngle;
      this.cityGroup.rotation.y = newRotY;

      // Position: place so local0 maps exactly to hand0 in world
      const cosR = Math.cos(newRotY);
      const sinR = Math.sin(newRotY);
      const sx = lx0 * newScale;
      const sz = lz0 * newScale;
      const rx = sx * cosR + sz * sinR;
      const rz = -sx * sinR + sz * cosR;

      this.cityGroup.position.x = wx0 - rx;
      this.cityGroup.position.z = wz0 - rz;

      // Y: average of hands minus average of local grab Y scaled
      this.cityGroup.position.y = (p0.y + p1.y) / 2
        - (anchor.local0.y + anchor.local1.y) / 2 * newScale;

    } else if (gs.grabbing) {
      // ── Single-hand: drag/move only ──
      this.cityGroup.position.copy(grabPoint).add(gs.offset);
    }
  }

  _initTwoHandAnchor() {
    const p0 = this._grabState[0].point;
    const p1 = this._grabState[1].point;

    // Convert hand world positions to cityGroup LOCAL space
    const invMatrix = new THREE.Matrix4().copy(this.cityGroup.matrixWorld).invert();

    const local0 = new THREE.Vector3(p0.x, p0.y, p0.z).applyMatrix4(invMatrix);
    const local1 = new THREE.Vector3(p1.x, p1.y, p1.z).applyMatrix4(invMatrix);

    this._twoHandAnchor = {
      local0: local0,
      local1: local1,
      startScale: this.cityGroup.scale.x,
    };
  }

  // ── Clear all city objects ───────────────────────────────────
  clearCity() {
    // Remove all children from city group
    while (this.cityGroup.children.length > 0) {
      const child = this.cityGroup.children[0];
      this.cityGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    this.buildingMeshes = [];
    this.connectionLines = [];
    this.outputMeshes = [];
    this.hotspotRings = [];
    this.districtPlates = [];

    // Dispose matrix rain textures
    for (const fx of this._matrixEffects) {
      if (fx.texture) fx.texture.dispose();
    }
    this._matrixEffects = [];

    // Close control panel & tooltip
    if (this._controlPanel) {
      this._controlPanel.close();
      this._controlPanel = null;
    }
    this._hideTooltip();
    this._layout = null;
    this._hoveredEntry = null;
  }

  // ── Matrix rain colour palette by building type ──────────────
  _matrixPalette(type) {
    const p = {
      'class':    { bright: '#FFCC44', mid: '#F97316' }, // Mistral orange
      'function': { bright: '#93C5FD', mid: '#3B82F6' }, // blue
      'variable': { bright: '#86EFAC', mid: '#22C55E' }, // green
      'import':   { bright: '#E9D5FF', mid: '#A855F7' }, // purple
    };
    return p[type] || p['class'];
  }

  // ── Init per-building matrix canvas + CanvasTexture ──────────
  _initMatrixEffect(building, bw, bh) {
    const CW = 128, CH = 256;
    const canvas = document.createElement('canvas');
    canvas.width  = CW;
    canvas.height = CH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);

    const palette = this._matrixPalette(building.type);
    const FS   = 9; // font-size px
    const cols = Math.floor(CW / FS);

    // Taller / larger buildings → faster rain
    const heightNorm = Math.min(1.0, Math.max(0.1, bh / 0.4));
    const baseSpeed  = 5 + heightNorm * 15; // chars/sec: 5–20

    const drops = Array.from({ length: cols }, () => ({
      y:         Math.random() * (CH / FS), // start at random row
      speed:     baseSpeed * (0.6 + Math.random() * 0.8),
      waitUntil: Math.random() * 1.5,       // stagger start
    }));

    const texture = new THREE.CanvasTexture(canvas);
    return { canvas, ctx, cols, drops, palette, FS, CW, CH, texture, elapsed: 0 };
  }

  // ── Tick: update every building's matrix canvas ──────────────
  updateMatrix(dt) {
    if (!this._matrixEffects.length) return;

    const CHARS = '01{}[]()=+-*/;:.#<>!&|ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const cdt   = Math.min(dt, 0.05); // cap jump at 50 ms

    for (const fx of this._matrixEffects) {
      const { ctx, cols, drops, palette, FS, CW, CH, texture } = fx;
      fx.elapsed += cdt;

      // Semi-transparent black overlay — creates the fade trail
      const fadeA = Math.min(0.9, 0.04 * cdt * 60);
      ctx.fillStyle = `rgba(0,0,0,${fadeA.toFixed(3)})`;
      ctx.fillRect(0, 0, CW, CH);

      ctx.font = `bold ${FS}px monospace`;

      for (let i = 0; i < cols; i++) {
        const drop = drops[i];
        if (fx.elapsed < drop.waitUntil) continue;

        const x    = i * FS;
        const y    = drop.y * FS;
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];

        // Bright leading character
        ctx.fillStyle = palette.bright;
        ctx.fillText(char, x, y);

        drop.y += drop.speed * cdt;

        // Reset drop off bottom → random gap before restarting
        if (drop.y * FS > CH) {
          drop.y         = -(Math.random() * 3);
          drop.waitUntil = fx.elapsed + Math.random() * 1.2;
        }
      }

      texture.needsUpdate = true;
    }
  }
}
