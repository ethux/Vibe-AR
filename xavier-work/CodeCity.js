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

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(4, 4);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.6,
      roughness: 0.9,
      side: THREE.DoubleSide
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    this.cityGroup.add(ground);

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
        const color = new THREE.Color(b.color || '#3B82F6');
        const mat = new THREE.MeshStandardMaterial({
          color: color,
          roughness: 0.4,
          metalness: 0.1,
          emissive: color,
          emissiveIntensity: 0.15
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

    if (closestEntry && closestEntry !== this._hoveredEntry) {
      this._hoveredEntry = closestEntry;
      this._showTooltip(closestEntry);
    } else if (!closestEntry && this._hoveredEntry) {
      this._hoveredEntry = null;
      this._hideTooltip();
    }
  }

  // ── Tooltip window for a building ────────────────────────────
  _showTooltip(entry) {
    this._hideTooltip();

    const hp = this._rightHandPos;
    const tooltipPos = hp ? [hp.x, hp.y + 0.15, hp.z] : [-0.5, 1.5, -0.8];

    this._tooltipWindow = this.wm.createWindow({
      title: entry.name || 'BUILDING',
      width: 0.5,
      height: 0.35,
      position: tooltipPos,
      content: (ctx, w, h) => {
        let y = 10;

        // Type badge
        const typeColors = {
          'class': '#F97316',
          'function': '#3B82F6',
          'variable': '#22C55E',
          'import': '#A855F7'
        };
        const typeColor = typeColors[entry.type] || '#888';
        ctx.fillStyle = typeColor;
        ctx.font = 'bold 18px monospace';
        ctx.fillText(entry.type ? entry.type.toUpperCase() : 'UNKNOWN', 20, y += 22);

        // Name
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(entry.name || '???', 20, y += 28);

        // Metrics
        if (entry.metrics) {
          ctx.fillStyle = '#FFB347';
          ctx.font = '14px monospace';
          y += 8;
          const m = entry.metrics;
          ctx.fillText(`LOC: ${m.loc || '?'}  Complexity: ${m.complexity || '?'}  Params: ${m.params || '?'}`, 20, y += 18);
        }

        // Explanation
        if (entry.explanation) {
          ctx.fillStyle = '#aaa';
          ctx.font = '14px monospace';
          y += 10;
          // Word wrap
          const maxW = w - 40;
          let line = '';
          for (const word of entry.explanation.split(' ')) {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > maxW && line) {
              ctx.fillText(line, 20, y += 18);
              line = word + ' ';
            } else {
              line = test;
            }
          }
          if (line) ctx.fillText(line, 20, y += 18);
        }

        // Code preview
        if (entry.codePreview) {
          ctx.fillStyle = '#666';
          ctx.font = '12px monospace';
          y += 12;
          const previewLines = entry.codePreview.split('\n').slice(0, 3);
          for (const pl of previewLines) {
            ctx.fillText(pl.substring(0, 60), 20, y += 16);
          }
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
      if (!this._twoHandAnchor) this._initTwoHandAnchor();
      const anchor = this._twoHandAnchor;

      const p0 = this._grabState[0].point;
      const p1 = this._grabState[1].point;

      // Current distance & midpoint between hands
      const currentDist = p0.distanceTo(p1);
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      const midZ = (p0.z + p1.z) / 2;

      // Scale
      const scaleFactor = (currentDist / anchor.startDist) * anchor.startScale;
      const clampedScale = Math.max(0.05, Math.min(5.0, scaleFactor));
      this.cityGroup.scale.setScalar(clampedScale);

      // Rotation (around Y axis)
      const currentAngle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      const deltaAngle = currentAngle - anchor.startAngle;
      this.cityGroup.rotation.y = anchor.startRotY + deltaAngle;

      // Position: follow midpoint with offset
      this.cityGroup.position.set(
        midX + anchor.startPosOffset.x,
        midY + anchor.startPosOffset.y,
        midZ + anchor.startPosOffset.z
      );
    } else if (gs.grabbing) {
      // ── Single-hand: drag/move only ──
      this.cityGroup.position.copy(grabPoint).add(gs.offset);
    }
  }

  _initTwoHandAnchor() {
    const p0 = this._grabState[0].point;
    const p1 = this._grabState[1].point;

    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    const midZ = (p0.z + p1.z) / 2;

    this._twoHandAnchor = {
      startDist: Math.max(0.01, p0.distanceTo(p1)),
      startScale: this.cityGroup.scale.x,
      startAngle: Math.atan2(p1.x - p0.x, p1.z - p0.z),
      startRotY: this.cityGroup.rotation.y,
      startPosOffset: new THREE.Vector3(
        this.cityGroup.position.x - midX,
        this.cityGroup.position.y - midY,
        this.cityGroup.position.z - midZ
      )
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

    // Close control panel & tooltip
    if (this._controlPanel) {
      this._controlPanel.close();
      this._controlPanel = null;
    }
    this._hideTooltip();
    this._layout = null;
    this._hoveredEntry = null;
  }
}
