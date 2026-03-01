// ═══════════════════════════════════════════════════════════════════
//  HandRenderer.js — WebXR hand tracking using Three.js built-in
//  XRHandModelFactory with ghost-hologram look:
//    • Black semi-transparent fill mesh
//    • White semi-transparent wireframe overlay (edge lines)
//  Uses the official Three.js hand input approach:
//    https://threejs.org/examples/webxr_vr_handinput
// ═══════════════════════════════════════════════════════════════════

import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

/**
 * After XRHandModelFactory loads the hand mesh, swap its material
 * to black transparent + add a wireframe clone for white edges.
 */
function applyGhostLook(handGroup) {
  handGroup.addEventListener('connected', () => {
    const tryApply = (attempts) => {
      let applied = false;
      const toAdd = [];

      handGroup.traverse((child) => {
        if ((child.isMesh || child.isSkinnedMesh) && !child.userData._ghostDone) {
          child.userData._ghostDone = true;
          applied = true;

          // ── Black transparent fill ──
          child.material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
          child.frustumCulled = false;
          child.renderOrder = 1;

          // ── White wireframe overlay (shares same geometry + skeleton) ──
          let wire;
          if (child.isSkinnedMesh) {
            wire = new THREE.SkinnedMesh(child.geometry, new THREE.MeshBasicMaterial({
              color: 0xffffff,
              wireframe: true,
              transparent: true,
              opacity: 0.35,
              depthWrite: false,
            }));
            wire.skeleton = child.skeleton;
            wire.bindMatrix.copy(child.bindMatrix);
            wire.bindMatrixInverse.copy(child.bindMatrixInverse);
          } else {
            wire = new THREE.Mesh(child.geometry, new THREE.MeshBasicMaterial({
              color: 0xffffff,
              wireframe: true,
              transparent: true,
              opacity: 0.35,
              depthWrite: false,
            }));
          }
          wire.frustumCulled = false;
          wire.renderOrder = 2;
          wire.userData._ghostDone = true;
          // Add wireframe as sibling (same parent so it inherits same transforms)
          toAdd.push({ parent: child.parent, mesh: wire });
        }
      });

      // Add wireframe meshes after traversal to avoid mutation during traverse
      for (const { parent, mesh } of toAdd) {
        if (parent) parent.add(mesh);
      }

      if (applied) {
        console.log('[HandRenderer] 🖤 Ghost look applied (black fill + white wireframe)');
      } else if (attempts > 0) {
        setTimeout(() => tryApply(attempts - 1), 250);
      }
    };
    setTimeout(() => tryApply(20), 400);
  });
}

/**
 * Sets up XRHandModelFactory-driven hand models on the renderer.
 * Call once after renderer is created and XR is enabled.
 */
export function initHands(scene, renderer) {
  const handModelFactory = new XRHandModelFactory();

  // ── Hand 1 (left) ──
  const hand1 = renderer.xr.getHand(0);
  hand1.add(handModelFactory.createHandModel(hand1, 'mesh'));
  applyGhostLook(hand1);
  scene.add(hand1);

  // ── Hand 2 (right) ──
  const hand2 = renderer.xr.getHand(1);
  hand2.add(handModelFactory.createHandModel(hand2, 'mesh'));
  applyGhostLook(hand2);
  scene.add(hand2);

  console.log('[HandRenderer] ✅ XRHandModelFactory hands initialized (mesh + ghost look)');

  return {
    hand1,
    hand2,
    dispose() {
      scene.remove(hand1);
      scene.remove(hand2);
      hand1.clear();
      hand2.clear();
    },
  };
}

// Legacy compat — kept as no-op so any existing `handRenderer.update()` calls don't crash
export class HandRenderer {
  constructor() { this._noop = true; }
  update() {}
  dispose() {}
}
