// ═══════════════════════════════════════════════════════════════════
//  AnimationManager.js — JS-driven canvas animation for WebXR AR
// ═══════════════════════════════════════════════════════════════════
//
//  Draws characters frame-by-frame on a canvas → Three.js texture.
//  No SVG CSS animations (they don't work on Quest/img tags).
//  All motion is driven by pure JS easing each frame.
//
//  Built-in animations: 'mascot-bounce'
//
//  USAGE:
//    const animMgr = new AnimationManager(scene);
//    const inst = animMgr.play('mascot-bounce', position);
//    // In render loop:
//    animMgr.update(dt, camera);
//    // Control:
//    inst.fastHide();   // quick fade out on palm close
//    inst.kill();       // instant remove
//    inst.moveTo(pos);  // follow hand
//
// ═══════════════════════════════════════════════════════════════════

// ── Easing helpers ───────────────────────────────────────────────
function cubicBezier(p1x, p1y, p2x, p2y) {
  // Approximate a CSS cubic-bezier via Newton's method
  return function(t) {
    // Using De Casteljau for y only (x~t approximation for ease)
    const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    // Solve for t in x, then get y
    let u = t;
    for (let i = 0; i < 8; i++) {
      const xu = ((ax * u + bx) * u + cx) * u - t;
      const dxu = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(dxu) < 1e-6) break;
      u -= xu / dxu;
    }
    return ((ay * u + by) * u + cy) * u;
  };
}

const easeOut  = cubicBezier(0.2, 0.8, 0.2, 1.0);  // fast launch, float up
const easeIn   = cubicBezier(0.8, 0.0, 0.8, 0.2);  // gravity fall

// Linear interpolation between keyframe values
function lerp(a, b, t) { return a + (b - a) * t; }

// Clamp t to [0,1]
function clamp01(t) { return Math.max(0, Math.min(1, t)); }

// Remap t from [a,b] to [0,1]
function remap(t, a, b) { return clamp01((t - a) / (b - a)); }


// ── The mascot draw function ──────────────────────────────────────
// Faithfully reproduces the SVG: 140×140 body, 3 color bands, 2 square eyes
// with rounded-rect clip, jump/squash/stretch/eye physics.
// t = animation progress 0→1, mode = 'idle' | 'recording' | 'listening'
function drawMascot(ctx, t, canvasW, canvasH, mode) {
  mode = mode || 'idle';
  const S = canvasW;
  ctx.clearRect(0, 0, canvasW, canvasH);

  // ── Scale factor: map SVG body (140px) to canvas ──
  // We want the character to fill most of the canvas nicely.
  // The SVG body is 140×140. Canvas is S×S.
  // Use ~70% of canvas width for the body.
  const scale = (S * 0.70) / 140;

  // SVG body dimensions (in SVG units, then multiply by scale)
  const bodyW  = 140 * scale;  // full body width
  const bodyH  = 140 * scale;  // full body height
  const r      = 12  * scale;  // border radius

  // SVG eye positions (SVG coords relative to body top-left at 0,0):
  //   Left eye:  x=20,y=80  w=40,h=40    pupil: x=40,y=100  w=20,h=20
  //   Right eye: x=80,y=80  w=40,h=40    pupil: x=80,y=100  w=20,h=20
  // In body-local coords (origin at body bottom-center = pivot):
  //   body top-left is at (-bodyW/2, -bodyH)
  //   so eye top-left in pivot coords = (-bodyW/2 + eyeSvgX*scale, -bodyH + eyeSvgY*scale)

  // ── Compute jump translateY ──
  let jumpY = 0;
  // Peak: ~38% of canvas height upward (fits within taller canvas)
  const peakPx = -(canvasH * 0.38);

  if (t < 0.15) {
    // Wind-up: tiny downward push
    jumpY = lerp(0, canvasH * 0.015, remap(t, 0, 0.15));
  } else if (t < 0.40) {
    const p = easeOut(remap(t, 0.15, 0.40));
    jumpY = lerp(0, peakPx, p);
  } else if (t < 0.65) {
    const p = easeIn(remap(t, 0.40, 0.65));
    jumpY = lerp(peakPx, 0, p);
  } else {
    jumpY = 0;
  }

  // ── Compute squash/stretch scale ──
  let scaleX = 1, scaleY = 1;
  if (t < 0.10) {
    scaleX = 1; scaleY = 1;
  } else if (t < 0.15) {
    // Wind-up squash: SVG 10%→15% = scale(1.2, 0.8)
    const p = remap(t, 0.10, 0.15);
    scaleX = lerp(1.0, 1.2,  p);
    scaleY = lerp(1.0, 0.8,  p);
  } else if (t < 0.22) {
    // Launch stretch: SVG 15% = scale(0.8, 1.25)
    const p = remap(t, 0.15, 0.22);
    scaleX = lerp(1.2,  0.8,  p);
    scaleY = lerp(0.8,  1.25, p);
  } else if (t < 0.40) {
    // Mid-air normalize: SVG 40% = scale(1,1)
    const p = remap(t, 0.22, 0.40);
    scaleX = lerp(0.8,  1.0,  p);
    scaleY = lerp(1.25, 1.0,  p);
  } else if (t < 0.60) {
    // Falling stretch: SVG 60% = scale(0.9, 1.15)
    const p = remap(t, 0.40, 0.60);
    scaleX = lerp(1.0,  0.9,  p);
    scaleY = lerp(1.0,  1.15, p);
  } else if (t < 0.67) {
    // Impact squash: SVG 65% = scale(1.3, 0.65)
    const p = remap(t, 0.60, 0.67);
    scaleX = lerp(0.9,  1.3,  p);
    scaleY = lerp(1.15, 0.65, p);
  } else if (t < 0.78) {
    // Overshoot: SVG 75% = scale(0.85, 1.15)
    const p = remap(t, 0.67, 0.78);
    scaleX = lerp(1.3,  0.85, p);
    scaleY = lerp(0.65, 1.15, p);
  } else if (t < 0.88) {
    // Wobble: SVG 85% = scale(1.05, 0.95)
    const p = remap(t, 0.78, 0.88);
    scaleX = lerp(0.85, 1.05, p);
    scaleY = lerp(1.15, 0.95, p);
  } else {
    // Rest
    const p = remap(t, 0.88, 1.0);
    scaleX = lerp(1.05, 1.0, p);
    scaleY = lerp(0.95, 1.0, p);
  }

  // ── Eye offset Y (SVG eye-follow keyframes, scaled) ──
  // SVG values are in SVG px; multiply by scale to get canvas px
  let eyeOffsetY = 0;
  if (t < 0.10) {
    eyeOffsetY = 0;
  } else if (t < 0.15) {
    // SVG: 0→14px
    eyeOffsetY = lerp(0, 14 * scale, remap(t, 0.10, 0.15));
  } else if (t < 0.22) {
    // SVG: 14→-18px
    eyeOffsetY = lerp(14 * scale, -18 * scale, remap(t, 0.15, 0.22));
  } else if (t < 0.40) {
    // SVG: -18→0
    eyeOffsetY = lerp(-18 * scale, 0, remap(t, 0.22, 0.40));
  } else if (t < 0.60) {
    // SVG: 0→-10px
    eyeOffsetY = lerp(0, -10 * scale, remap(t, 0.40, 0.60));
  } else if (t < 0.67) {
    // SVG: -10→22px (eyes crash on impact)
    eyeOffsetY = lerp(-10 * scale, 22 * scale, remap(t, 0.60, 0.67));
  } else if (t < 0.78) {
    // SVG: 22→-12px
    eyeOffsetY = lerp(22 * scale, -12 * scale, remap(t, 0.67, 0.78));
  } else if (t < 0.88) {
    // SVG: -12→4px
    eyeOffsetY = lerp(-12 * scale, 4 * scale, remap(t, 0.78, 0.88));
  } else {
    eyeOffsetY = lerp(4 * scale, 0, remap(t, 0.88, 1.0));
  }

  // ── Shadow scale/opacity (SVG shadow-shrink) ──
  let shadowScale = 1, shadowOpacity = 0.15;
  if (t >= 0.15 && t < 0.40) {
    const p = easeOut(remap(t, 0.15, 0.40));
    shadowScale   = lerp(1.0,  0.3,  p);
    shadowOpacity = lerp(0.15, 0.04, p);
  } else if (t >= 0.40 && t < 0.65) {
    const p = easeIn(remap(t, 0.40, 0.65));
    shadowScale   = lerp(0.3,  1.0,  p);
    shadowOpacity = lerp(0.04, 0.15, p);
  }

  // ── Canvas layout ──
  // Ground sits at ~85% down the tall canvas so there's room above for the full jump arc
  const groundY = canvasH * 0.85;
  // Pivot = bottom-center of body at rest
  const pivotX  = S / 2;
  const pivotY  = groundY;

  // ── Shadow ──
  ctx.save();
  ctx.globalAlpha = shadowOpacity;
  const sRx = (bodyW * 0.38) * shadowScale;
  const sRy = (bodyH * 0.065) * shadowScale;
  ctx.beginPath();
  ctx.ellipse(pivotX, groundY + sRy * 0.6, sRx, sRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fill();
  ctx.restore();

  // ── Body with squash/stretch (clipped rounded rect) ──
  ctx.save();
  ctx.translate(pivotX, pivotY + jumpY);
  ctx.scale(scaleX, scaleY);

  // body top-left in pivot-relative coords
  const bx = -bodyW / 2;
  const by = -bodyH;

  // SVG clip path: notched top (cat ears) — exact path from SVG scaled
  // Original: M 12 0 L 40 0 L 40 60 L 100 60 L 100 0 L 128 0
  //           arc(140,12) → down → arc(128,140) → left → arc(0,128) → up → arc(12,0)
  // In pivot-relative coords: svgX→ bx + svgX*scale,  svgY→ by + svgY*scale
  const sp = (svgPx) => svgPx * scale; // helper: svg px → canvas px
  ctx.beginPath();
  // Left ear top-left corner
  ctx.moveTo(bx + sp(12), by);
  // Top of left ear → inner notch top-left
  ctx.lineTo(bx + sp(40), by);
  // Drop down into notch
  ctx.lineTo(bx + sp(40), by + sp(60));
  // Notch bottom across
  ctx.lineTo(bx + sp(100), by + sp(60));
  // Rise back up to right ear top
  ctx.lineTo(bx + sp(100), by);
  // Top of right ear
  ctx.lineTo(bx + sp(128), by);
  // Top-right rounded corner
  ctx.quadraticCurveTo(bx + sp(140), by,          bx + sp(140), by + sp(12));
  // Right side down
  ctx.lineTo(bx + sp(140), by + sp(128));
  // Bottom-right rounded corner
  ctx.quadraticCurveTo(bx + sp(140), by + sp(140), bx + sp(128), by + sp(140));
  // Bottom across
  ctx.lineTo(bx + sp(12),  by + sp(140));
  // Bottom-left rounded corner
  ctx.quadraticCurveTo(bx,            by + sp(140), bx,           by + sp(128));
  // Left side up
  ctx.lineTo(bx, by + sp(12));
  // Top-left rounded corner
  ctx.quadraticCurveTo(bx,            by,           bx + sp(12),  by);
  ctx.closePath();
  ctx.clip();

  // SVG color bands: top 60/140, mid 40/140, bottom 40/140
  // Always orange
  ctx.fillStyle = '#FF9900';
  ctx.fillRect(bx, by, bodyW, bodyH * (60 / 140));
  ctx.fillStyle = '#FF6600';
  ctx.fillRect(bx, by + bodyH * (60 / 140), bodyW, bodyH * (40 / 140));
  ctx.fillStyle = '#FF3300';
  ctx.fillRect(bx, by + bodyH * (100 / 140), bodyW, bodyH * (40 / 140));

  ctx.restore();

  // ── Eyes: drawn WITHOUT squash (separate transform), only follow jumpY + eyeOffsetY ──
  ctx.save();
  ctx.translate(pivotX, pivotY + jumpY + eyeOffsetY);

  // SVG eye positions are in body-local space (body top-left = 0,0):
  //   Left eye white:  x=20, y=80, w=40, h=40
  //   Left pupil:      x=40, y=100, w=20, h=20
  //   Right eye white: x=80, y=80, w=40, h=40
  //   Right pupil:     x=80, y=100, w=20, h=20
  // Convert to pivot-relative: subtract (bodyW/2) from x, subtract bodyH from y
  // i.e. offsetX = svgX * scale - bodyW/2
  //      offsetY = svgY * scale - bodyH
  const ex = (svgX) => svgX * scale - bodyW / 2;
  const ey = (svgY) => svgY * scale - bodyH;

  // Left eye white
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(ex(20), ey(80), 40 * scale, 40 * scale);
  // Left pupil
  ctx.fillStyle = '#000000';
  ctx.fillRect(ex(40), ey(100), 20 * scale, 20 * scale);

  // Right eye white
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(ex(80), ey(80), 40 * scale, 40 * scale);
  // Right pupil
  ctx.fillStyle = '#000000';
  ctx.fillRect(ex(80), ey(100), 20 * scale, 20 * scale);

  ctx.restore();


}


// ═══════════════════════════════════════════════════════════════════
//  AnimationManager
// ═══════════════════════════════════════════════════════════════════

class AnimationManager {
  constructor(scene) {
    this.scene = scene;
    this.instances = [];
  }

  // ── Play the mascot bounce at a world position ──────────────────
  play(name, position, overrides = {}) {
    if (name !== 'mascot-bounce') {
      console.warn('AnimationManager: only "mascot-bounce" is built-in.');
    }

    const RES_W  = 512;
    const RES_H  = 768;  // taller canvas so jump arc doesn't clip at top
    const WIDTH  = overrides.width   ?? 0.11;  // meters
    const HEIGHT = overrides.height  ?? 0.11;
    const DUR    = overrides.duration ?? 2.5;  // seconds
    const FADEIN = overrides.fadeIn   ?? 0.12;
    const FADEOUT = overrides.fadeOut ?? 0.08;
    const MODE   = overrides.mode    ?? 'idle';

    // Canvas + texture
    const canvas = document.createElement('canvas');
    canvas.width = RES_W; canvas.height = RES_H;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    // Plane mesh — height scaled to match canvas aspect ratio (512×768 = 1:1.5)
    const geo = new THREE.PlaneGeometry(WIDTH, HEIGHT * (RES_H / RES_W));
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      alphaTest: 0.01,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);

    // Draw first frame immediately so it doesn't pop in blank
    drawMascot(ctx, 0, RES_W, RES_H, MODE);
    texture.needsUpdate = true;

    const inst = {
      mesh, texture, canvas, ctx,
      origin: position.clone(),
      duration: DUR,
      fadeIn: FADEIN,
      fadeOut: FADEOUT,
      time: 0,
      opacity: 0,
      stopping: false,
      finished: false,
      mode: MODE,
      res: RES_W,
      resH: RES_H,
      visScale: 1,

      moveTo(pos) { this.origin.copy(pos); },
      setMode(m) { this.mode = m; },
      setVisScale(v) { this.visScale = Math.max(0, Math.min(1, v)); },
      stop()  { this.stopping = true; },
      fastHide(dur) { this.fadeOut = dur ?? 0.08; this.stopping = true; },
      kill()  { this.finished = true; },
    };

    this.instances.push(inst);
    return inst;
  }

  // ── Update (call every frame) ───────────────────────────────────
  update(dt, _elapsed, camera) {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];

      if (inst.finished) {
        this.scene.remove(inst.mesh);
        inst.mesh.geometry.dispose();
        inst.mesh.material.dispose();
        inst.texture.dispose();
        this.instances.splice(i, 1);
        continue;
      }

      inst.time += dt;

      // Opacity
      if (inst.stopping) {
        inst.opacity -= dt / inst.fadeOut;
        if (inst.opacity <= 0) {
          inst.opacity = 0;
          inst.finished = true;
        }
      } else if (inst.time < inst.fadeIn) {
        inst.opacity = inst.time / inst.fadeIn;
      } else {
        inst.opacity = 1;
      }
      inst.mesh.material.opacity = inst.opacity * inst.visScale;

      // Redraw canvas — play once and hold last frame
      const t = Math.min(1.0, inst.time / inst.duration);
      drawMascot(inst.ctx, t, inst.res, inst.resH, inst.mode);
      inst.texture.needsUpdate = true;

      // Position + billboard — scale driven by visScale for palm-close shrink
      inst.mesh.position.copy(inst.origin);
      inst.mesh.scale.set(inst.visScale, inst.visScale, 1);
      if (camera) inst.mesh.quaternion.copy(camera.quaternion);
    }
  }

  clear() {
    for (const inst of this.instances) inst.finished = true;
  }
}

export { AnimationManager };
