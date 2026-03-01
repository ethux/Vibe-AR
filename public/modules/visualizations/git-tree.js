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

    // Polling for realtime updates
    this._pollTimer = null;
    this._lastSnapshot = '';  // hash of HEAD + branch list to detect changes
  }

  _log(msg) {
    const m = `[GIT-TREE] ${msg}`;
    console.log(m);
    fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: m }) }).catch(() => {});
  }

  // Helper: run a git command via the web server's /api/git/run endpoint
  async _gitRun(command, cwd) {
    const params = new URLSearchParams({ command });
    if (cwd) params.set('cwd', cwd);
    const res = await fetch('/api/git/run?' + params.toString(), { method: 'POST' });
    return res.json();
  }

  async loadHistory() {
    try {
      // The /api/git/run endpoint auto-discovers git repos in workspace/
      // Test with a simple command — if it finds a repo, returncode=0
      const checkData = await this._gitRun('git rev-parse --show-toplevel');
      if (checkData.returncode !== 0) {
        this._log('No git repo found in workspace');
        return;
      }
      const repoPath = (checkData.stdout || '').trim();
      this._log(`Found git repo at: ${repoPath}`);

      // Fetch git log with structured format (including %P for parent hashes)
      const logData = await this._gitRun(
        'git log --all --decorate --format="%H|%h|%P|%s|%an|%ar|%D" -50'
      );

      if (logData.returncode !== 0) {
        this._log(`Git log failed: ${logData.stderr}`);
        return;
      }

      // Fetch current branch
      const branchData = await this._gitRun('git branch --show-current');
      this.currentBranch = (branchData.stdout || '').trim();

      // Fetch all branches with their HEAD commits
      const allBranchData = await this._gitRun('git branch -a --format="%(refname:short) %(objectname:short)"');

      // Parse the log output
      this._parseGitLog(logData.stdout || '');
      this._log(`Parsed ${this.commits.length} commits, HEAD=${this.headHash?.substring(0,7)}`);

      // Enrich branch info from explicit branch listing
      if (allBranchData.returncode === 0) {
        for (const line of (allBranchData.stdout || '').split('\n')) {
          const parts = line.trim().split(' ');
          if (parts.length >= 2) {
            const [branchName, shortHash] = parts;
            if (!this.branches[branchName]) {
              this.branches[branchName] = shortHash;
            }
            // Tag commit with branch name if not already tagged
            const commit = this.commits.find(c => c.shortHash === shortHash || c.hash.startsWith(shortHash));
            if (commit && !commit.branchNames.includes(branchName)) {
              commit.branchNames.push(branchName);
            }
          }
        }
      }

      // Build snapshot fingerprint to detect future changes
      const branchList = Object.keys(this.branches).sort().join(',');
      this._lastSnapshot = `${this.headHash}|${this.commits.length}|${branchList}`;

      // Render the tree
      this.clearTree();
      this.renderTree();
      this._log(`Rendered ${this.commitMeshes.length} commit spheres`);

      // Start polling for realtime updates
      this.startPolling();
    } catch (e) {
      this._log(`ERROR: ${e.message || e}`);
    }
  }

  // ── Realtime polling — detect new commits/branches ────────────

  startPolling(intervalMs = 5000) {
    this.stopPolling();
    this._pollTimer = setInterval(() => this._checkForUpdates(), intervalMs);
    this._log(`Polling started (${intervalMs}ms)`);
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _checkForUpdates() {
    try {
      // Quick lightweight check: HEAD hash + commit count + branch names
      const [headData, countData, branchData] = await Promise.all([
        this._gitRun('git rev-parse HEAD'),
        this._gitRun('git rev-list --all --count'),
        this._gitRun('git branch -a --format="%(refname:short)"'),
      ]);

      if (headData.returncode !== 0) return;

      const headHash = (headData.stdout || '').trim();
      const count = (countData.stdout || '').trim();
      const branches = (branchData.stdout || '').trim().split('\n').sort().join(',');
      const snapshot = `${headHash}|${count}|${branches}`;

      if (snapshot !== this._lastSnapshot) {
        this._log(`Change detected — reloading tree`);
        // Stop polling during reload, loadHistory will restart it
        this.stopPolling();
        await this.loadHistory();
      }
    } catch (e) {
      // Silently ignore polling errors
    }
  }

  // ── Parse git log output into structured data ─────────────────

  _parseGitLog(raw) {
    this.commits = [];
    this.branches = {};
    this.headHash = '';

    const lines = raw.split('\n').filter(l => l.trim());
    const commitMap = new Map();

    // Format: %H|%h|%P|%s|%an|%ar|%D
    // %P = space-separated parent hashes
    for (const line of lines) {
      const match = line.match(/([a-f0-9]{40})\|([a-f0-9]+)\|([\sa-f0-9]*)\|(.*?)\|(.*?)\|(.*?)\|(.*)/);
      if (!match) continue;

      const [, hash, shortHash, parentStr, subject, author, date, decorations] = match;
      const parents = parentStr.trim() ? parentStr.trim().split(/\s+/) : [];
      const commit = {
        hash,
        shortHash,
        subject: subject.trim(),
        author: author.trim(),
        date: date.trim(),
        decorations: decorations.trim(),
        parents,
        children: [],
        branchNames: [],
        tags: [],
        isHead: false,
        isMerge: parents.length > 1,
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
            commit.branchNames.push(dec.trim());
          }
        }
      }

      for (const bn of commit.branchNames) {
        this.branches[bn] = hash;
      }

      this.commits.push(commit);
      commitMap.set(hash, commit);
    }

    if (this.commits.length === 0) return;

    if (!this.headHash && this.commits.length > 0) {
      this.headHash = this.commits[0].hash;
      this.commits[0].isHead = true;
    }

    // Build children from parent data
    for (const commit of this.commits) {
      for (const ph of commit.parents) {
        const parent = commitMap.get(ph);
        if (parent) parent.children.push(commit.hash);
      }
    }

    this._assignLanes(commitMap);
  }

  _assignLanes(commitMap) {
    // Walk from HEAD along first-parents → lane 0 (main trunk)
    const mainSet = new Set();
    let walk = this.headHash;
    while (walk) {
      mainSet.add(walk);
      const c = commitMap.get(walk);
      if (!c || c.parents.length === 0) break;
      walk = c.parents[0]; // first parent = main line
    }

    // Assign lane 0 to main trunk
    for (const commit of this.commits) {
      if (mainSet.has(commit.hash)) {
        commit.lane = 0;
      }
    }

    // For non-main commits, walk each branch tip backwards to find
    // where it diverges from main, and assign a lane
    let nextLane = 1;
    const hashToLane = new Map();
    for (const c of this.commits) {
      if (mainSet.has(c.hash)) {
        hashToLane.set(c.hash, 0);
      }
    }

    // Process commits top-down (newest first, which is the array order)
    for (const commit of this.commits) {
      if (hashToLane.has(commit.hash)) continue; // already assigned

      // This commit is off the main trunk — assign a branch lane
      // Check if a sibling (same parent) already has a lane
      let lane = null;
      for (const ph of commit.parents) {
        const parent = commitMap.get(ph);
        if (!parent) continue;
        // If parent is on main and has multiple children, this is a branch
        for (const ch of parent.children) {
          if (ch !== commit.hash && hashToLane.has(ch)) {
            // Sibling already has a lane, use a new one
          }
        }
      }

      if (lane === null) {
        lane = nextLane;
        // Alternate sides: 1, -1, 2, -2, 3, -3...
        nextLane++;
      }

      // Walk this branch backwards until we hit main or a known lane
      const branchCommits = [commit.hash];
      let w = commit.hash;
      while (true) {
        const c = commitMap.get(w);
        if (!c || c.parents.length === 0) break;
        const fp = c.parents[0];
        if (mainSet.has(fp) || hashToLane.has(fp)) break;
        branchCommits.push(fp);
        w = fp;
      }

      // Convert lane number to alternating left/right offset
      const offset = lane % 2 === 1 ? Math.ceil(lane / 2) : -(lane / 2);
      for (const h of branchCommits) {
        hashToLane.set(h, offset);
        const c = commitMap.get(h);
        if (c) c.lane = offset;
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

    // ── Assign a color to each lane (= branch) ──
    const laneColorMap = new Map();
    laneColorMap.set(0, BRANCH_COLORS[0]); // main trunk = Mistral orange

    // Find branch tips per lane so we can name them
    const laneBranchName = new Map();
    laneBranchName.set(0, this.currentBranch || 'main');
    for (const commit of this.commits) {
      if (commit.lane !== 0 && commit.branchNames.length > 0 && !laneBranchName.has(commit.lane)) {
        const bn = commit.branchNames.find(b => !b.startsWith('origin/')) || commit.branchNames[0];
        laneBranchName.set(commit.lane, bn);
      }
    }

    // Assign colors to each unique lane
    let colorIdx = 1; // 0 is reserved for main
    for (const commit of this.commits) {
      if (!laneColorMap.has(commit.lane)) {
        laneColorMap.set(commit.lane, BRANCH_COLORS[colorIdx % BRANCH_COLORS.length]);
        colorIdx++;
      }
    }

    // Also build branchName → color for labels
    const branchColorMap = new Map();
    for (const [lane, bn] of laneBranchName) {
      branchColorMap.set(bn, laneColorMap.get(lane) || CYAN);
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

        // Color connection by child commit's lane
        const lineColor = laneColorMap.get(commit.lane) || CYAN;

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

      // Determine sphere color from lane
      const sphereColor = laneColorMap.get(commit.lane) || CYAN;

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
        branchColor: sphereColor,
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

      // Pick label color from branch
      const labelBranch = commit.branchNames.find(b => !b.startsWith('origin/'));
      const labelColor = labelBranch ? (branchColorMap.get(labelBranch) || laneColorMap.get(commit.lane) || CYAN) : (commit.isHead ? ORANGE : laneColorMap.get(commit.lane) || CYAN);
      const sprite = this._makeLabel(labelText, commit.isHead, labelColor);
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

  _makeLabel(text, isHead, color) {
    const CW = 256, CH = 40;
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');

    // Background pill — use branch color
    const hex = (color || CYAN).toString(16).padStart(6, '0');
    const cr = parseInt(hex.substring(0, 2), 16);
    const cg = parseInt(hex.substring(2, 4), 16);
    const cb = parseInt(hex.substring(4, 6), 16);
    ctx.fillStyle = isHead ? `rgba(${cr}, ${cg}, ${cb}, 0.9)` : `rgba(${cr}, ${cg}, ${cb}, 0.75)`;
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

    // Text — always white for readability on colored pills
    ctx.fillStyle = '#FFFFFF';
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
      const diffCmd = `git show ${commit.hash} --stat --format=""`;
      const diffData = await this._gitRun(diffCmd);
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

  // ── MCP Scene Control Methods ─────────────────────────────────

  highlightCommit(hash, color) {
    if (!hash) return;
    const hexColor = typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : (color || ORANGE);
    for (const cm of this.commitMeshes) {
      if (cm.commit.hash.startsWith(hash) || cm.commit.shortHash === hash) {
        if (cm.mesh.material) {
          cm.mesh.material.color.setHex(hexColor);
          cm.mesh.material.emissive.setHex(hexColor);
        }
        if (cm.glowMesh && cm.glowMesh.material) {
          cm.glowMesh.material.color.setHex(hexColor);
        }
        break;
      }
    }
  }

  highlightBranch(branchName, color) {
    if (!branchName) return;
    const hexColor = typeof color === 'string' ? parseInt(color.replace('#', ''), 16) : (color || CYAN);
    for (const cm of this.commitMeshes) {
      if (cm.commit.branchNames.includes(branchName)) {
        if (cm.mesh.material) {
          cm.mesh.material.color.setHex(hexColor);
          cm.mesh.material.emissive.setHex(hexColor);
        }
        if (cm.glowMesh && cm.glowMesh.material) {
          cm.glowMesh.material.color.setHex(hexColor);
        }
      }
    }
  }

  showCommitDetails(hash) {
    if (!hash) return;
    const entry = this.commitMeshes.find(
      cm => cm.commit.hash.startsWith(hash) || cm.commit.shortHash === hash
    );
    if (entry) this._showCommitDetail(entry.commit);
  }

  navigateToCommit(hash) {
    if (!hash) return;
    const entry = this.commitMeshes.find(
      cm => cm.commit.hash.startsWith(hash) || cm.commit.shortHash === hash
    );
    if (entry && entry.mesh) {
      // Get world position of the commit sphere
      const worldPos = new THREE.Vector3();
      entry.mesh.getWorldPosition(worldPos);
      // Smoothly shift the tree group so the commit is centered at eye level
      const targetY = 1.4 - worldPos.y + this.treeGroup.position.y;
      const startY = this.treeGroup.position.y;
      const duration = 600;
      const start = performance.now();
      const animate = () => {
        const t = Math.min((performance.now() - start) / duration, 1);
        const ease = t * (2 - t); // ease-out
        this.treeGroup.position.y = startY + (targetY - startY) * ease;
        if (t < 1) requestAnimationFrame(animate);
      };
      animate();
    }
  }

  clearHighlights() {
    // Reset all commit colors to their stored branch colors
    for (const cm of this.commitMeshes) {
      const baseColor = cm.branchColor || CYAN;
      if (cm.mesh.material) {
        cm.mesh.material.color.setHex(baseColor);
        cm.mesh.material.emissive.setHex(baseColor);
      }
      if (cm.glowMesh && cm.glowMesh.material) {
        cm.glowMesh.material.color.setHex(baseColor);
      }
    }
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

  destroy() {
    this.stopPolling();
    this.clearTree();
    this.scene.remove(this.treeGroup);
  }
}

export { GitTreeRenderer };
