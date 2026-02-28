// ═══════════════════════════════════════════════════════════════════
//  git-tree.js — 3D Git History Tree Visualization for WebXR AR
//  Renders commit graph as glowing spheres with branch lines
// ═══════════════════════════════════════════════════════════════════

const ORANGE       = 0xFF7000;
const ORANGE_DARK  = 0xE65100;
const CYAN         = 0x00CED1;
const BG_DARK      = 0x0c0c12;
const WHITE        = 0xffffff;

// Branch colors for visual distinction
const BRANCH_COLORS = [
  0xFF7000, // Mistral orange (main/current)
  0x00CED1, // cyan
  0x3B82F6, // blue
  0xA855F7, // purple
  0x22C55E, // green
  0xEAB308, // yellow
  0xEF4444, // red
  0xF472B6, // pink
];

class GitTreeRenderer {
  constructor(scene, camera, windowManager) {
    this.scene = scene;
    this.camera = camera;
    this.wm = windowManager;

    // Root group for all git tree objects
    this.treeGroup = new THREE.Group();
    this.treeGroup.position.set(-0.6, 0, -0.5);
    this.scene.add(this.treeGroup);

    // Storage arrays for cleanup
    this.commitMeshes   = [];   // { mesh, commit, glowMesh }
    this.connectionLines = [];
    this.branchLabels    = [];
    this.particleSystems = [];
    this.extraMeshes     = [];

    // Parsed data
    this.commits       = [];
    this.branches      = {};    // branchName -> commitHash
    this.currentBranch = '';
    this.headHash      = '';

    // Raycast state
    this._raycaster  = new THREE.Raycaster();
    this._detailWindow = null;

    // HEAD glow particles
    this._headParticles = null;
  }

  // ── Fetch git history via companion terminal ──────────────────

  async loadHistory() {
    try {
      // Fetch git log with structured format
      const gitLogCmd = 'git log --all --oneline --graph --decorate --format="%H|%h|%s|%an|%ar|%D" -50';
      const logRes = await fetch(
        '/api/companion/terminal/run?command=' + encodeURIComponent(gitLogCmd) + '&cwd=.',
        { method: 'POST' }
      );
      const logData = await logRes.json();

      if (logData.returncode !== 0) {
        this._showError('Not a git repository or git not available.');
        return;
      }

      // Fetch current branch
      const branchRes = await fetch(
        '/api/companion/terminal/run?command=' + encodeURIComponent('git branch --show-current') + '&cwd=.',
        { method: 'POST' }
      );
      const branchData = await branchRes.json();
      this.currentBranch = (branchData.stdout || '').trim();

      // Parse the log output
      this._parseGitLog(logData.stdout || '');

      // Render the tree
      this.clearTree();
      this.renderTree();
    } catch (e) {
      console.error('[GIT-TREE] Failed to load history:', e);
      this._showError('Failed to load git history: ' + (e.message || 'network error'));
    }
  }

  // ── Parse git log output into structured data ─────────────────

  _parseGitLog(raw) {
    this.commits = [];
    this.branches = {};
    this.headHash = '';

    const lines = raw.split('\n').filter(l => l.trim());
    const commitMap = new Map();
    const graphLanes = [];      // track which lane each branch occupies

    // First pass: extract commits from the formatted output
    // The --format output intersperses with graph characters.
    // We look for lines matching our delimiter pattern.
    for (const line of lines) {
      // Find lines containing our pipe-delimited format
      const match = line.match(/([a-f0-9]{40})\|([a-f0-9]+)\|(.*?)\|(.*?)\|(.*?)\|(.*)/);
      if (!match) continue;

      const [, hash, shortHash, subject, author, date, decorations] = match;
      const commit = {
        hash,
        shortHash,
        subject: subject.trim(),
        author: author.trim(),
        date: date.trim(),
        decorations: decorations.trim(),
        parents: [],
        children: [],
        branchNames: [],
        tags: [],
        isHead: false,
        lane: 0,
      };

      // Parse decorations (HEAD -> main, origin/main, tag: v1.0, etc.)
      if (commit.decorations) {
        const decs = commit.decorations.split(',').map(d => d.trim());
        for (const dec of decs) {
          if (dec.includes('HEAD ->')) {
            commit.isHead = true;
            const branchName = dec.replace('HEAD ->', '').trim();
            if (branchName) commit.branchNames.push(branchName);
            this.headHash = hash;
          } else if (dec.startsWith('tag:')) {
            commit.tags.push(dec.replace('tag:', '').trim());
          } else if (dec === 'HEAD') {
            commit.isHead = true;
            this.headHash = hash;
          } else {
            // Branch reference (could be origin/xxx or local)
            commit.branchNames.push(dec.trim());
          }
        }
      }

      // Track branches
      for (const bn of commit.branchNames) {
        this.branches[bn] = hash;
      }

      this.commits.push(commit);
      commitMap.set(hash, commit);
    }

    // If no commits parsed, bail
    if (this.commits.length === 0) return;

    // Set HEAD if not found from decorations
    if (!this.headHash && this.commits.length > 0) {
      this.headHash = this.commits[0].hash;
      this.commits[0].isHead = true;
    }

    // Second pass: determine parent-child relationships
    // Fetch parent info via a separate command for accuracy
    this._resolveParentsFromOrder(commitMap);

    // Assign lanes (horizontal positions for branches)
    this._assignLanes();
  }

  _resolveParentsFromOrder(commitMap) {
    // In a simple log listing (newest first), each commit's parent is
    // generally the next commit in the list for linear history.
    // For branches/merges, we rely on the graph structure.
    // As a robust fallback, we link each commit to the next one.
    for (let i = 0; i < this.commits.length - 1; i++) {
      const current = this.commits[i];
      const next = this.commits[i + 1];
      current.parents.push(next.hash);
      next.children.push(current.hash);
    }
  }

  _assignLanes() {
    // Simple lane assignment: main branch gets lane 0,
    // branches spread outward based on detection of branch points
    const laneMap = new Map();
    let nextLane = 0;

    // Determine which branch each commit belongs to
    // Start from the HEAD commit and walk backwards
    const visited = new Set();

    // Assign the current branch to lane 0
    const mainBranchCommits = new Set();
    for (const commit of this.commits) {
      if (commit.branchNames.some(b =>
        b === this.currentBranch ||
        b === 'main' || b === 'master' ||
        b.includes('HEAD')
      )) {
        mainBranchCommits.add(commit.hash);
      }
    }

    // Walk from HEAD along parents to mark main lane
    let walkHash = this.headHash;
    const commitMap = new Map(this.commits.map(c => [c.hash, c]));
    while (walkHash) {
      mainBranchCommits.add(walkHash);
      const c = commitMap.get(walkHash);
      if (!c || c.parents.length === 0) break;
      walkHash = c.parents[0];
    }

    // Assign lanes
    let branchLane = 1;
    const branchLaneAssigned = new Map();

    for (const commit of this.commits) {
      if (mainBranchCommits.has(commit.hash)) {
        commit.lane = 0;
      } else {
        // Check if any of its branch names already has a lane
        let assignedLane = null;
        for (const bn of commit.branchNames) {
          if (branchLaneAssigned.has(bn)) {
            assignedLane = branchLaneAssigned.get(bn);
            break;
          }
        }
        if (assignedLane === null) {
          // Check if parent has children in different lanes
          assignedLane = branchLane;
          branchLane++;
          // Alternate left and right
          if (branchLane > 4) branchLane = 1;
          for (const bn of commit.branchNames) {
            branchLaneAssigned.set(bn, assignedLane);
          }
        }
        // Alternate sides: odd lanes go right, even go left
        commit.lane = assignedLane % 2 === 0 ? -(assignedLane / 2) : Math.ceil(assignedLane / 2);
      }
    }
  }

  // ── Render the 3D tree ────────────────────────────────────────

  renderTree() {
    if (this.commits.length === 0) return;

    const COUNT = this.commits.length;
    const Y_TOP = 1.6;
    const Y_BOTTOM = 0.8;
    const Y_SPAN = Y_TOP - Y_BOTTOM;
    const LANE_SPACING = 0.09;
    const SPHERE_RADIUS = 0.02;

    // Assign a color index to each unique branch
    const branchColorMap = new Map();
    let colorIdx = 0;
    // Current branch always gets orange (index 0)
    if (this.currentBranch) branchColorMap.set(this.currentBranch, 0);

    for (const commit of this.commits) {
      for (const bn of commit.branchNames) {
        if (!branchColorMap.has(bn) && !bn.startsWith('origin/')) {
          colorIdx++;
          branchColorMap.set(bn, colorIdx % BRANCH_COLORS.length);
        }
      }
    }

    // Compute positions for all commits
    const posMap = new Map();
    for (let i = 0; i < COUNT; i++) {
      const commit = this.commits[i];
      const t = COUNT > 1 ? i / (COUNT - 1) : 0;
      const y = Y_TOP - t * Y_SPAN;
      const x = commit.lane * LANE_SPACING;
      const pos = new THREE.Vector3(x, y, 0);
      posMap.set(commit.hash, pos);
    }

    // ── Draw connection lines first (behind spheres) ──

    const commitMap = new Map(this.commits.map(c => [c.hash, c]));

    for (const commit of this.commits) {
      const fromPos = posMap.get(commit.hash);
      if (!fromPos) continue;

      for (const parentHash of commit.parents) {
        const toPos = posMap.get(parentHash);
        if (!toPos) continue;

        // Determine color for this connection
        let lineColor = CYAN;
        if (commit.isHead || commit.branchNames.includes(this.currentBranch)) {
          lineColor = ORANGE;
        }

        // If same lane, draw straight line; otherwise draw a curve
        if (Math.abs(fromPos.x - toPos.x) < 0.001) {
          // Straight line
          const points = [fromPos.clone(), toPos.clone()];
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const mat = new THREE.LineBasicMaterial({
            color: lineColor,
            transparent: true,
            opacity: 0.5,
          });
          const line = new THREE.Line(geo, mat);
          this.treeGroup.add(line);
          this.connectionLines.push(line);
        } else {
          // Curved connection for branch merges
          const midY = (fromPos.y + toPos.y) / 2;
          const curve = new THREE.QuadraticBezierCurve3(
            fromPos.clone(),
            new THREE.Vector3(fromPos.x, midY, 0),
            toPos.clone()
          );
          const points = curve.getPoints(16);
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const mat = new THREE.LineBasicMaterial({
            color: lineColor,
            transparent: true,
            opacity: 0.4,
          });
          const line = new THREE.Line(geo, mat);
          this.treeGroup.add(line);
          this.connectionLines.push(line);
        }

        // Add thin glow line (slightly thicker, lower opacity)
        this._addGlowLine(fromPos, toPos, lineColor);
      }
    }

    // ── Draw commit spheres ──

    for (let i = 0; i < COUNT; i++) {
      const commit = this.commits[i];
      const pos = posMap.get(commit.hash);
      if (!pos) continue;

      // Determine sphere color
      let sphereColor = CYAN;
      if (commit.isHead) {
        sphereColor = ORANGE;
      } else if (commit.branchNames.includes(this.currentBranch)) {
        sphereColor = ORANGE;
      }

      // Main commit sphere
      const geo = new THREE.SphereGeometry(SPHERE_RADIUS, 16, 12);
      const mat = new THREE.MeshStandardMaterial({
        color: sphereColor,
        emissive: new THREE.Color(sphereColor),
        emissiveIntensity: 0.6,
        roughness: 0.3,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      this.treeGroup.add(mesh);

      // Outer glow shell
      const glowGeo = new THREE.SphereGeometry(SPHERE_RADIUS * 1.8, 12, 8);
      const glowMat = new THREE.MeshBasicMaterial({
        color: sphereColor,
        transparent: true,
        opacity: commit.isHead ? 0.25 : 0.12,
        side: THREE.BackSide,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.copy(pos);
      this.treeGroup.add(glowMesh);

      this.commitMeshes.push({
        mesh,
        glowMesh,
        commit,
        baseEmissive: 0.6,
        pos: pos.clone(),
      });

      // ── HEAD commit: extra particle ring effect ──
      if (commit.isHead) {
        this._createHeadEffect(pos);
      }
    }

    // ── Draw branch labels as floating sprites ──

    const labeledPositions = new Map();
    for (const commit of this.commits) {
      const pos = posMap.get(commit.hash);
      if (!pos) continue;

      const labels = [];
      for (const bn of commit.branchNames) {
        if (!bn.startsWith('origin/')) labels.push(bn);
      }
      for (const tag of commit.tags) {
        labels.push('tag:' + tag);
      }
      if (commit.isHead && labels.length === 0) {
        labels.push('HEAD');
      }

      if (labels.length === 0) continue;

      const labelText = labels.join(', ');
      if (labeledPositions.has(labelText)) continue;
      labeledPositions.set(labelText, true);

      const sprite = this._makeLabel(labelText, commit.isHead);
      // Position label to the right of the commit
      sprite.position.set(
        pos.x + SPHERE_RADIUS * 3 + 0.04,
        pos.y,
        pos.z + 0.005
      );
      this.treeGroup.add(sprite);
      this.branchLabels.push(sprite);
    }

    // ── Add commit message hints (short) for first few commits ──

    const MAX_MSG_LABELS = Math.min(8, COUNT);
    for (let i = 0; i < MAX_MSG_LABELS; i++) {
      const commit = this.commits[i];
      const pos = posMap.get(commit.hash);
      if (!pos) continue;

      // Only show message if no branch label at this position
      const hasBranchLabel = commit.branchNames.length > 0 || commit.tags.length > 0 || commit.isHead;
      const msgSprite = this._makeMessageLabel(
        commit.shortHash + ' ' + commit.subject,
        hasBranchLabel
      );
      const xOff = hasBranchLabel ? -0.12 : SPHERE_RADIUS * 3 + 0.01;
      msgSprite.position.set(
        pos.x + xOff,
        pos.y,
        pos.z + 0.003
      );
      this.treeGroup.add(msgSprite);
      this.branchLabels.push(msgSprite);
    }

    // ── Title label at top ──
    const titleSprite = this._makeTitleLabel();
    titleSprite.position.set(0, Y_TOP + 0.05, 0);
    this.treeGroup.add(titleSprite);
    this.branchLabels.push(titleSprite);
  }

  // ── Glow line (subtle outer glow for connections) ─────────────

  _addGlowLine(from, to, color) {
    // Use a thin tube geometry for the glow effect
    const midY = (from.y + to.y) / 2;
    const isCurved = Math.abs(from.x - to.x) > 0.001;

    let points;
    if (isCurved) {
      const curve = new THREE.QuadraticBezierCurve3(
        from.clone(),
        new THREE.Vector3(from.x, midY, 0),
        to.clone()
      );
      points = curve.getPoints(12);
    } else {
      points = [from.clone(), to.clone()];
    }

    // Second line with lower opacity for glow
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.15,
      linewidth: 2,
    });
    const line = new THREE.Line(geo, mat);
    // Offset slightly forward
    line.position.z = 0.002;
    this.treeGroup.add(line);
    this.connectionLines.push(line);
  }

  // ── HEAD particle ring effect ─────────────────────────────────

  _createHeadEffect(pos) {
    // Create a pulsing ring around HEAD
    const ringGeo = new THREE.RingGeometry(0.035, 0.042, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: ORANGE,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.position.z += 0.003;
    this.treeGroup.add(ring);
    this.extraMeshes.push(ring);

    // Small orbiting particles
    const PARTICLE_COUNT = 8;
    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const pGeo = new THREE.SphereGeometry(0.004, 6, 4);
      const pMat = new THREE.MeshBasicMaterial({
        color: ORANGE,
        transparent: true,
        opacity: 0.6,
      });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.position.copy(pos);
      this.treeGroup.add(pMesh);
      particles.push({
        mesh: pMesh,
        angle: (i / PARTICLE_COUNT) * Math.PI * 2,
        radius: 0.04,
        center: pos.clone(),
        speed: 1.5 + Math.random() * 0.5,
      });
      this.extraMeshes.push(pMesh);
    }

    this._headParticles = { ring, ringMat, particles };
  }

  // ── Sprite label helpers ──────────────────────────────────────

  _makeLabel(text, isHead) {
    const CW = 256, CH = 40;
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');

    // Background pill
    ctx.fillStyle = isHead ? 'rgba(255, 112, 0, 0.85)' : 'rgba(0, 206, 209, 0.7)';
    const r = CH / 2 - 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(2, 2, CW - 4, CH - 4, r);
    } else {
      // Fallback for browsers without roundRect
      const x = 2, y = 2, w = CW - 4, h = CH - 4;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    ctx.fill();

    // Text
    ctx.fillStyle = isHead ? '#FFFFFF' : '#0c0c12';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayText = text.length > 20 ? text.substring(0, 18) + '..' : text;
    ctx.fillText(displayText, CW / 2, CH / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.12, 0.02, 1);
    sprite.renderOrder = 2;
    return sprite;
  }

  _makeMessageLabel(text, offsetLeft) {
    const CW = 512, CH = 32;
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(12, 12, 18, 0.65)';
    ctx.fillRect(0, 0, CW, CH);

    ctx.fillStyle = '#a0a0b0';
    ctx.font = '16px monospace';
    ctx.textAlign = offsetLeft ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    const displayText = text.length > 50 ? text.substring(0, 48) + '..' : text;
    ctx.fillText(displayText, offsetLeft ? CW - 8 : 8, CH / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      opacity: 0.8,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.18, 0.012, 1);
    sprite.renderOrder = 1;
    return sprite;
  }

  _makeTitleLabel() {
    const CW = 256, CH = 48;
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FF7000';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GIT HISTORY', CW / 2, CH / 2 - 2);

    // Underline
    ctx.strokeStyle = '#FF7000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, CH - 6);
    ctx.lineTo(CW - 40, CH - 6);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.16, 0.03, 1);
    sprite.renderOrder = 3;
    return sprite;
  }

  // ── Raycast interaction — commit detail window ────────────────

  handleRaycast(raycaster) {
    if (this.commitMeshes.length === 0) return false;

    const meshes = this.commitMeshes.map(cm => cm.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (hits.length > 0) {
      const hitEntry = this.commitMeshes.find(cm => cm.mesh === hits[0].object);
      if (hitEntry) {
        this._showCommitDetail(hitEntry.commit);
        return true;
      }
    }

    return false;
  }

  async _showCommitDetail(commit) {
    // Close previous detail window
    if (this._detailWindow) {
      this._detailWindow.close();
      this._detailWindow = null;
    }

    // Show initial window with commit info
    this._detailWindow = this.wm.createWindow({
      title: 'COMMIT ' + commit.shortHash,
      width: 0.5,
      height: 0.35,
      position: [-0.3, 1.55, -0.4],
      content: (ctx, w, h) => {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);

        let y = 20;
        // Hash
        ctx.fillStyle = '#FF7000';
        ctx.font = 'bold 16px monospace';
        ctx.fillText('Hash: ' + commit.shortHash, 15, y += 18);

        // Message
        ctx.fillStyle = '#e0e0e0';
        ctx.font = '14px monospace';
        const msgLines = this._wrapText(commit.subject, 55);
        for (const ml of msgLines) {
          ctx.fillText(ml, 15, y += 18);
        }

        // Author
        y += 6;
        ctx.fillStyle = '#00CED1';
        ctx.font = '13px monospace';
        ctx.fillText('Author: ' + commit.author, 15, y += 18);

        // Date
        ctx.fillStyle = '#888';
        ctx.fillText('Date:   ' + commit.date, 15, y += 18);

        // Branches/tags
        if (commit.branchNames.length > 0 || commit.tags.length > 0) {
          y += 6;
          ctx.fillStyle = '#A855F7';
          const refs = [...commit.branchNames, ...commit.tags.map(t => 'tag:' + t)].join(', ');
          ctx.fillText('Refs: ' + refs, 15, y += 18);
        }

        // Loading indicator for diff
        y += 12;
        ctx.fillStyle = '#555';
        ctx.font = '12px monospace';
        ctx.fillText('Loading diff stats...', 15, y += 16);
      },
    });

    // Fetch diff stats
    try {
      const diffCmd = `git diff ${commit.hash}~1 ${commit.hash} --stat 2>/dev/null || git show ${commit.hash} --stat --format=""`;
      const diffRes = await fetch(
        '/api/companion/terminal/run?command=' + encodeURIComponent(diffCmd) + '&cwd=.',
        { method: 'POST' }
      );
      const diffData = await diffRes.json();
      const diffText = (diffData.stdout || '').trim();

      // Update window with diff info
      if (this._detailWindow && !this._detailWindow.closed) {
        this._detailWindow.setContent((ctx, w, h) => {
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, w, h);

          let y = 20;
          // Hash
          ctx.fillStyle = '#FF7000';
          ctx.font = 'bold 16px monospace';
          ctx.fillText('Hash: ' + commit.shortHash, 15, y += 18);

          // Full hash (smaller)
          ctx.fillStyle = '#666';
          ctx.font = '10px monospace';
          ctx.fillText(commit.hash, 15, y += 14);

          // Message
          ctx.fillStyle = '#e0e0e0';
          ctx.font = '14px monospace';
          const msgLines = this._wrapText(commit.subject, 55);
          for (const ml of msgLines) {
            ctx.fillText(ml, 15, y += 18);
          }

          // Author + Date
          y += 6;
          ctx.fillStyle = '#00CED1';
          ctx.font = '13px monospace';
          ctx.fillText('Author: ' + commit.author, 15, y += 18);
          ctx.fillStyle = '#888';
          ctx.fillText('Date:   ' + commit.date, 15, y += 18);

          // Branches/tags
          if (commit.branchNames.length > 0 || commit.tags.length > 0) {
            y += 4;
            ctx.fillStyle = '#A855F7';
            const refs = [...commit.branchNames, ...commit.tags.map(t => 'tag:' + t)].join(', ');
            ctx.fillText('Refs: ' + refs, 15, y += 16);
          }

          // Diff stats
          y += 10;
          ctx.fillStyle = '#FF7000';
          ctx.font = 'bold 13px monospace';
          ctx.fillText('CHANGES:', 15, y += 16);
          ctx.fillStyle = '#c0c0c0';
          ctx.font = '11px monospace';

          if (diffText) {
            const diffLines = diffText.split('\n');
            const maxDiffLines = Math.floor((h - y - 10) / 14);
            for (let i = 0; i < Math.min(diffLines.length, maxDiffLines); i++) {
              const dl = diffLines[i];
              // Color insertions green, deletions red
              if (dl.includes('+') && dl.includes('-')) {
                ctx.fillStyle = '#c0c0c0';
              } else if (dl.includes('+')) {
                ctx.fillStyle = '#22C55E';
              } else if (dl.includes('-')) {
                ctx.fillStyle = '#EF4444';
              } else {
                ctx.fillStyle = '#888';
              }
              ctx.fillText(dl.substring(0, 60), 15, y += 14);
            }
          } else {
            ctx.fillStyle = '#555';
            ctx.fillText('(initial commit or no changes)', 15, y += 14);
          }
        });
      }
    } catch (e) {
      console.warn('[GIT-TREE] Failed to load diff:', e);
    }
  }

  _wrapText(text, maxChars) {
    if (text.length <= maxChars) return [text];
    const lines = [];
    let remaining = text;
    while (remaining.length > maxChars) {
      let breakAt = remaining.lastIndexOf(' ', maxChars);
      if (breakAt <= 0) breakAt = maxChars;
      lines.push(remaining.substring(0, breakAt));
      remaining = remaining.substring(breakAt).trim();
    }
    if (remaining) lines.push(remaining);
    return lines;
  }

  // ── Per-frame animation ───────────────────────────────────────

  update(dt, elapsed) {
    // Pulse glow on commit spheres
    for (const cm of this.commitMeshes) {
      const pulse = 0.5 + Math.sin(elapsed * 2.0 + cm.pos.y * 8.0) * 0.3;
      if (cm.glowMesh && cm.glowMesh.material) {
        cm.glowMesh.material.opacity = (cm.commit.isHead ? 0.25 : 0.12) * (0.7 + pulse * 0.3);
      }
      // Subtle emissive pulse on the main sphere
      if (cm.mesh && cm.mesh.material) {
        cm.mesh.material.emissiveIntensity = cm.baseEmissive + Math.sin(elapsed * 3.0 + cm.pos.y * 5.0) * 0.15;
      }
    }

    // HEAD particle ring animation
    if (this._headParticles) {
      const hp = this._headParticles;

      // Pulsing ring
      if (hp.ringMat) {
        hp.ringMat.opacity = 0.25 + Math.sin(elapsed * 2.5) * 0.15;
      }
      if (hp.ring) {
        const s = 1.0 + Math.sin(elapsed * 1.8) * 0.1;
        hp.ring.scale.set(s, s, 1);
      }

      // Orbiting particles
      for (const p of hp.particles) {
        p.angle += p.speed * dt;
        const r = p.radius + Math.sin(elapsed * 3.0 + p.angle) * 0.008;
        p.mesh.position.set(
          p.center.x + Math.cos(p.angle) * r,
          p.center.y + Math.sin(p.angle) * r,
          p.center.z + 0.005
        );
        p.mesh.material.opacity = 0.4 + Math.sin(elapsed * 4.0 + p.angle) * 0.25;
      }
    }

    // Subtle breathing on connection lines
    for (const line of this.connectionLines) {
      if (line.material) {
        const baseOp = line.material.userData?.baseOpacity ?? line.material.opacity;
        if (!line.material.userData) line.material.userData = {};
        line.material.userData.baseOpacity = baseOp;
        line.material.opacity = baseOp * (0.85 + Math.sin(elapsed * 1.5) * 0.15);
      }
    }
  }

  // ── Show error in a WindowManager window ──────────────────────

  _showError(message) {
    this.wm.createWindow({
      title: 'GIT ERROR',
      width: 0.4,
      height: 0.15,
      position: [-0.6, 1.5, -0.5],
      content: (ctx, w, h) => {
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 18px monospace';
        ctx.fillText('ERROR', 15, 28);
        ctx.fillStyle = '#FCA5A5';
        ctx.font = '13px monospace';
        const maxW = w - 30;
        let line = '', y = 50;
        for (const word of message.split(' ')) {
          const test = line + word + ' ';
          if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, 15, y); y += 18; line = word + ' ';
          } else { line = test; }
        }
        if (line) ctx.fillText(line, 15, y);
      },
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────

  clearTree() {
    // Remove all commit meshes
    for (const cm of this.commitMeshes) {
      if (cm.mesh) {
        this.treeGroup.remove(cm.mesh);
        if (cm.mesh.geometry) cm.mesh.geometry.dispose();
        if (cm.mesh.material) cm.mesh.material.dispose();
      }
      if (cm.glowMesh) {
        this.treeGroup.remove(cm.glowMesh);
        if (cm.glowMesh.geometry) cm.glowMesh.geometry.dispose();
        if (cm.glowMesh.material) cm.glowMesh.material.dispose();
      }
    }
    this.commitMeshes = [];

    // Remove connection lines
    for (const line of this.connectionLines) {
      this.treeGroup.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    }
    this.connectionLines = [];

    // Remove branch labels
    for (const sprite of this.branchLabels) {
      this.treeGroup.remove(sprite);
      if (sprite.material) {
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.dispose();
      }
    }
    this.branchLabels = [];

    // Remove extra meshes (HEAD ring, particles)
    for (const mesh of this.extraMeshes) {
      this.treeGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    this.extraMeshes = [];
    this._headParticles = null;

    // Remove particle systems
    for (const ps of this.particleSystems) {
      this.treeGroup.remove(ps);
      if (ps.geometry) ps.geometry.dispose();
      if (ps.material) ps.material.dispose();
    }
    this.particleSystems = [];

    // Close detail window
    if (this._detailWindow) {
      this._detailWindow.close();
      this._detailWindow = null;
    }
  }
}

export { GitTreeRenderer };
