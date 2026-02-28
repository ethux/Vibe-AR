// ── Animation loop ────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let handDetectedOnce = false;

renderer.setAnimationLoop((timestamp, frame) => {
  const dt      = clock.getDelta();
  const elapsed = clock.elapsedTime;

  // Controller window drag
  if (dragging && activeController) {
    tempMatrix.identity().extractRotation(activeController.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(activeController.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    const dist   = windowBody.position.distanceTo(raycaster.ray.origin);
    const target = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(dist)).add(dragOffset);
    windowBody.position.lerp(target, 0.5);
    const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
    windowBody.lookAt(cp);
  }

  // ── Hand tracking ─────────────────────────────────────────────────────────
  if (frame && renderer.xr.isPresenting) {
    const session  = renderer.xr.getSession();
    const refSpace = renderer.xr.getReferenceSpace();
    if (session && refSpace) {
      const handInputs = [null, null];
      for (const src of session.inputSources) {
        if (src.hand) handInputs[src.handedness === 'left' ? 0 : 1] = src;
      }

      handInputs.forEach((inputSource, idx) => {
        if (!inputSource?.hand) return;
        const state = handStates[idx];
        state.handedness = inputSource.handedness;

        if (!handDetectedOnce) {
          handDetectedOnce = true;
          debugMat.color.set(0x00ff00);
        }

        // Joint visuals
        HAND_JOINTS.forEach((name, j) => {
          const pos  = getJointPos(inputSource, name, frame, refSpace);
          const mesh = state.jointMeshes[j];
          if (pos) { mesh.position.copy(pos); mesh.visible = true; mesh.scale.setScalar(name.endsWith('-tip') ? 1.4 : 1); }
          else     { mesh.visible = false; }
        });

        // Palm orb
        const palmResult = detectPalmOpen(inputSource, frame, refSpace, state.handedness);
        state.palmOpen = palmResult.open;
        if (state.palmOpen) debugMat.color.set(0xffff00);
        state.palmOpenSmooth += ((state.palmOpen ? 1 : 0) - state.palmOpenSmooth) * 0.12;

        const orb = state.bubble;
        if (palmResult.palmCenter) {
          orb.position.lerp(palmResult.palmCenter.clone().setY(palmResult.palmCenter.y + 0.06 + Math.sin(elapsed * 2.5) * 0.008), 0.3);
        }
        if (state.palmOpenSmooth > 0.05) {
          orb.visible = true;
          const s = state.palmOpenSmooth;
          orb.scale.set(s, s, s);
          orb.userData.sparkles.forEach((sp, i) => {
            const a = elapsed * (1.5 + i * 0.3) + i * (Math.PI * 2 / 5);
            const r = 0.035 + Math.sin(elapsed * 2 + i) * 0.008;
            sp.position.set(Math.cos(a) * r, Math.sin(elapsed * 3 + i * 1.2) * 0.015, Math.sin(a) * r);
            sp.material.opacity = 0.5 + Math.sin(elapsed * 4 + i) * 0.3;
          });
          const core = orb.userData.coreMesh;
          const cs   = 0.9 + Math.sin(elapsed * 2.5) * 0.1;
          core.material.opacity = 0.5 + Math.sin(elapsed * 3) * 0.2;
          core.scale.set(cs, cs, cs);
          orb.userData.haloMesh.material.opacity = 0.1 + state.palmOpenSmooth * 0.1;
          orb.rotation.y += dt * 0.5;
          state.jointMeshes.forEach(m => {
            if (!m.material.emissive) m.material.emissive = new THREE.Color();
            m.material.emissive.setHex(0x4466ff);
            m.material.emissiveIntensity = state.palmOpenSmooth * 0.5;
          });
        } else {
          orb.visible = false; orb.scale.set(0, 0, 0);
          state.jointMeshes.forEach(m => { if (m.material.emissiveIntensity !== undefined) m.material.emissiveIntensity = 0; });
        }

        // ── Interactions ────────────────────────────────────────────────────
        const pinch = detectPinch(inputSource, frame, refSpace);

        if (state.handedness === 'left') {
          // LEFT: free bubble → add context | context bubble → remove | title → drag
          if (pinch.pinching && !state.pinching) {
            state.pinching = true;
            if (pinch.pinchPoint) {
              const titleWP = new THREE.Vector3(); titleBar.getWorldPosition(titleWP);
              if (pinch.pinchPoint.distanceTo(titleWP) < 0.15) {
                state.dragging = true;
                state.dragOffset.copy(windowBody.position).sub(pinch.pinchPoint);
                borderMat.opacity = 0.7; titleMat.color.set(0x5a5a8c);
              } else {
                // Free bubble first
                let closest = null, cd = 0.12;
                fileBubbles.forEach(b => { if (b.userData.inPalm) return; const d = pinch.pinchPoint.distanceTo(b.position); if (d < cd) { cd = d; closest = b; } });
                if (closest) {
                  closest.userData.inPalm = true;
                  closest.userData.scaleTarget = 0.5; closest.userData.palmOrbitIndex = palmBubbles.length;
                  closest.visible = true; palmBubbles.push(closest); markBubbleOpened(closest);
                } else {
                  // Palm bubble → remove from context
                  let pc = null, pd = 0.08, pi = -1;
                  palmBubbles.forEach((b, i) => { const d = pinch.pinchPoint.distanceTo(b.position); if (d < pd) { pd = d; pc = b; pi = i; } });
                  if (pc) {
                    pc.userData.inPalm = false; pc.userData.opened = false; pc.userData.scaleTarget = 1;
                    pc.userData.restPos.copy(pc.userData.basePos); pc.visible = true;
                    if (openedBubble === pc) openedBubble = null;
                    palmBubbles.splice(pi, 1); palmBubbles.forEach((b, i) => { b.userData.palmOrbitIndex = i; });
                  }
                }
              }
            }
          } else if (!pinch.pinching && state.pinching) {
            state.pinching = false;
            if (state.dragging) { state.dragging = false; borderMat.opacity = 0.3; titleMat.color.set(0x3a3a5c); }
          }
          if (state.dragging && pinch.pinchPoint) {
            const t = pinch.pinchPoint.clone().add(state.dragOffset); windowBody.position.lerp(t, 0.4);
            const cp = new THREE.Vector3(); camera.getWorldPosition(cp); windowBody.lookAt(cp);
          }
          // Palm center tracking + visibility
          const palmData = detectPalmOpen(inputSource, frame, refSpace, 'left');
          if (palmData.palmCenter) { leftPalmCenter = palmData.palmCenter.clone(); leftPalmCenter.y += 0.05; }
          palmBubbles.forEach(b => { b.visible = palmData.open; });

        } else {
          // RIGHT: free bubble → open | empty + swipe → back | title → drag | fist → rotate
          const fist = detectFist(inputSource, frame, refSpace);
          if (fist.fisting) {
            if (!_fistRotating) { _fistRotating = true; _fistLastX = fist.wristPos?.x ?? 0; }
            else if (fist.wristPos) {
              const dx = fist.wristPos.x - _fistLastX; _fistLastX = fist.wristPos.x;
              if (Math.abs(dx) > 0.0005) {
                const a = dx * 3.5, cos = Math.cos(a), sin = Math.sin(a);
                fileBubbles.forEach(b => {
                  if (b.userData.inPalm) return;
                  const bp = b.userData.basePos;
                  const nx = bp.x * cos + bp.z * sin, nz = -bp.x * sin + bp.z * cos;
                  bp.x = nx; bp.z = nz; b.userData.restPos.x = nx; b.userData.restPos.z = nz;
                });
              }
            }
          } else { _fistRotating = false; }

          if (pinch.pinching && !state.pinching) {
            state.pinching = true;
            if (pinch.pinchPoint) {
              const titleWP = new THREE.Vector3(); titleBar.getWorldPosition(titleWP);
              if (pinch.pinchPoint.distanceTo(titleWP) < 0.15) {
                state.dragging = true;
                state.dragOffset.copy(windowBody.position).sub(pinch.pinchPoint);
                borderMat.opacity = 0.7; titleMat.color.set(0x5a5a8c);
              } else {
                let fc = null, fd = 0.12;
                fileBubbles.forEach(b => { if (b.userData.inPalm) return; const d = pinch.pinchPoint.distanceTo(b.position); if (d < fd) { fd = d; fc = b; } });
                if (fc) { openFileBubble(fc); _backSwipeActive = false; }
                else    { _backSwipeActive = true; _backSwipeStart.copy(pinch.pinchPoint); }
              }
            }
          } else if (!pinch.pinching && state.pinching) {
            state.pinching = false;
            if (state.dragging) { state.dragging = false; borderMat.opacity = 0.3; titleMat.color.set(0x3a3a5c); }
            if (_backSwipeActive) {
              _backSwipeActive = false;
              if (pinch.pinchPoint && pinch.pinchPoint.distanceTo(_backSwipeStart) >= 0.07) {
                const parts = currentPath.split('/').filter(Boolean);
                if (parts.length > 1) { parts.pop(); loadFiles(parts.join('/')); }
                else if (currentPath !== 'Mistral_AI_Hackathon_2026_Paris_Vibe_AR') loadFiles('Mistral_AI_Hackathon_2026_Paris_Vibe_AR');
              }
            }
          }
          if (state.dragging && pinch.pinchPoint) {
            const t = pinch.pinchPoint.clone().add(state.dragOffset); windowBody.position.lerp(t, 0.4);
            const cp = new THREE.Vector3(); camera.getWorldPosition(cp); windowBody.lookAt(cp);
          }
        }
      });
    }
  }

  // Idle window float
  if (!dragging && !handStates[0].dragging && !handStates[1].dragging)
    windowBody.position.y += Math.sin(elapsed * 0.8) * 0.0002;

  // ── Animate file bubbles ───────────────────────────────────────────────────
  fileBubbles.forEach(group => {
    const d = group.userData;

    if (d.inPalm && leftPalmCenter) {
      const total = Math.max(palmBubbles.length, 1);
      const r     = 0.07 + total * 0.018;
      const angle = elapsed * 1.5 + (d.palmOrbitIndex / total) * Math.PI * 2;
      const tilt  = d.palmOrbitIndex * 0.6;
      group.position.lerp(new THREE.Vector3(
        leftPalmCenter.x + Math.cos(angle) * r,
        leftPalmCenter.y + Math.sin(angle) * Math.sin(tilt) * r * 0.5,
        leftPalmCenter.z + Math.sin(angle) * Math.cos(tilt) * r
      ), 0.15);
    } else if (!d.inPalm) {
      const rp = d.restPos;
      group.position.x = rp.x + Math.sin(elapsed * 0.2 + d.index * 2) * 0.015;
      group.position.y = rp.y + Math.sin(elapsed * d.bobSpeed + d.index) * d.bobAmp;
      group.position.z = rp.z + Math.cos(elapsed * 0.25 + d.index * 1.5) * 0.015;
    }

    // Scale lerp
    const cs = group.scale.x;
    group.scale.setScalar(cs + (d.scaleTarget - cs) * 0.12);

    const bwp  = new THREE.Vector3(); group.getWorldPosition(bwp);
    const s    = Math.max(group.scale.x, 0.01);
    const cw   = d.cardW || 0.095;
    const pulse = d.opened ? 1 + Math.sin(elapsed * 3) * 0.04 : 1;

    if (d.cardSprite)  { d.cardSprite.position.copy(bwp); d.cardSprite.visible = group.visible; d.cardSprite.scale.set(cw * s * pulse, cw * s * pulse, 1); }
    if (d.labelSprite) { d.labelSprite.position.copy(bwp).setY(bwp.y - cw * s * 0.7); d.labelSprite.visible = group.visible; d.labelSprite.scale.set(cw * 2.2 * s, cw * 0.42 * s, 1); }

    if (d.glowRing) {
      d.glowRing.position.copy(bwp); d.glowRing.visible = group.visible && (d.opened || d.inPalm); d.glowRing.scale.setScalar(s);
      const rc = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
      const rcp = new THREE.Vector3(); rc.getWorldPosition(rcp); d.glowRing.lookAt(rcp);
      if (d.glowRingMat) {
        if      (d.opened) d.glowRingMat.opacity = 0.5 + Math.sin(elapsed * 3) * 0.2;
        else if (d.inPalm) d.glowRingMat.opacity = 0.3 + Math.sin(elapsed * 2) * 0.1;
        else               d.glowRingMat.opacity = Math.max(0, d.glowRingMat.opacity - 0.05);
      }
    }
  });

  renderer.render(scene, camera);
});

// ── Desktop camera orbit ──────────────────────────────────────────────────────
let _mouseDown = false, _mx = 0, _my = 0;
let _camTheta = 0, _camPhi = 0.15;
const _camTarget = new THREE.Vector3(0, 1.3, -0.5);
const _camRadius = 1.8;
function _updateCam() {
  if (renderer.xr.isPresenting) return;
  camera.position.set(
    _camTarget.x + _camRadius * Math.sin(_camTheta) * Math.cos(_camPhi),
    _camTarget.y + _camRadius * Math.sin(_camPhi),
    _camTarget.z + _camRadius * Math.cos(_camTheta) * Math.cos(_camPhi)
  );
  camera.lookAt(_camTarget);
}
camera.position.set(0, 1.6, 1); camera.lookAt(0, 1.3, -0.5);
renderer.domElement.addEventListener('mousedown', e => { _mouseDown = true; _mx = e.clientX; _my = e.clientY; });
window.addEventListener('mouseup', () => { _mouseDown = false; });
window.addEventListener('mousemove', e => {
  if (!_mouseDown || renderer.xr.isPresenting) return;
  _camTheta -= (e.clientX - _mx) * 0.005;
  _camPhi = Math.max(-0.4, Math.min(0.9, _camPhi + (e.clientY - _my) * 0.005));
  _mx = e.clientX; _my = e.clientY; _updateCam();
});
renderer.domElement.addEventListener('wheel', e => { if (!renderer.xr.isPresenting) { _camTarget.y -= e.deltaY * 0.001; _updateCam(); } });

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
