// ═══════════════════════════════════════════════════════════════════
//  HandRenderer.js — 3D glove models driven by WebXR hand tracking
//  Loads a single .glb hand model, clones & mirrors it for both hands
// ═══════════════════════════════════════════════════════════════════

import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { HAND_JOINTS, getJointPos } from './hand-tracking.js';

// WebXR joint name → common bone name fragments for auto-mapping
const JOINT_BONE_HINTS = {
  'wrist':                              ['wrist', 'hand'],
  'thumb-metacarpal':                   ['thumb', 'metacarpal', '0', 'thumb.01', 'thumb_01'],
  'thumb-phalanx-proximal':             ['thumb', 'proximal', '1', 'thumb.02', 'thumb_02'],
  'thumb-phalanx-distal':               ['thumb', 'distal', '2', 'thumb.03', 'thumb_03'],
  'thumb-tip':                          ['thumb', 'tip', '3', 'thumb.04', 'thumb_04'],
  'index-finger-metacarpal':            ['index', 'metacarpal', 'index.00', 'index_00'],
  'index-finger-phalanx-proximal':      ['index', 'proximal', 'index.01', 'index_01'],
  'index-finger-phalanx-intermediate':  ['index', 'intermediate', 'index.02', 'index_02'],
  'index-finger-phalanx-distal':        ['index', 'distal', 'index.03', 'index_03'],
  'index-finger-tip':                   ['index', 'tip', 'index.04', 'index_04'],
  'middle-finger-metacarpal':           ['middle', 'metacarpal', 'middle.00', 'middle_00'],
  'middle-finger-phalanx-proximal':     ['middle', 'proximal', 'middle.01', 'middle_01'],
  'middle-finger-phalanx-intermediate': ['middle', 'intermediate', 'middle.02', 'middle_02'],
  'middle-finger-phalanx-distal':       ['middle', 'distal', 'middle.03', 'middle_03'],
  'middle-finger-tip':                  ['middle', 'tip', 'middle.04', 'middle_04'],
  'ring-finger-metacarpal':             ['ring', 'metacarpal', 'ring.00', 'ring_00'],
  'ring-finger-phalanx-proximal':       ['ring', 'proximal', 'ring.01', 'ring_01'],
  'ring-finger-phalanx-intermediate':   ['ring', 'intermediate', 'ring.02', 'ring_02'],
  'ring-finger-phalanx-distal':         ['ring', 'distal', 'ring.03', 'ring_03'],
  'ring-finger-tip':                    ['ring', 'tip', 'ring.04', 'ring_04'],
  'pinky-finger-metacarpal':            ['pinky', 'little', 'metacarpal', 'pinky.00', 'little.00'],
  'pinky-finger-phalanx-proximal':      ['pinky', 'little', 'proximal', 'pinky.01', 'little.01'],
  'pinky-finger-phalanx-intermediate':  ['pinky', 'little', 'intermediate', 'pinky.02', 'little.02'],
  'pinky-finger-phalanx-distal':        ['pinky', 'little', 'distal', 'pinky.03', 'little.03'],
  'pinky-finger-tip':                   ['pinky', 'little', 'tip', 'pinky.04', 'little.04'],
};

class HandRenderer {
  constructor(scene) {
    this.scene = scene;
    this._loaded = false;
    this._modelTemplate = null;

    // Per-hand state: [left=0, right=1]
    this.hands = [
      { group: null, boneMap: null, visible: false },
      { group: null, boneMap: null, visible: false },
    ];

    this._load();
  }

  async _load() {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync('/models/hand.glb');
      this._modelTemplate = gltf.scene;

      // Log skeleton for debugging
      const boneNames = [];
      gltf.scene.traverse((node) => {
        if (node.isBone || node.isSkinnedMesh) boneNames.push(`${node.type}: ${node.name}`);
      });
      console.log('[HandRenderer] Model bones:', boneNames);

      // Set up right hand (index 1) — use original model as-is
      this._setupHand(1, gltf.scene.clone(), false);

      // Set up left hand (index 0) — clone and mirror on X axis
      this._setupHand(0, gltf.scene.clone(), true);

      this._loaded = true;
      console.log('[HandRenderer] Glove models ready');
    } catch (e) {
      console.error('[HandRenderer] Failed to load hand model:', e);
    }
  }

  _setupHand(handIdx, model, mirror) {
    const group = new THREE.Group();
    group.add(model);
    group.visible = false;

    if (mirror) {
      group.scale.x = -1;
    }

    // Attempt to build bone map from skeleton
    const boneMap = {};
    const allBones = [];
    model.traverse((node) => {
      if (node.isBone) allBones.push(node);
    });

    if (allBones.length > 0) {
      console.log(`[HandRenderer] Hand ${handIdx} has ${allBones.length} bones:`,
        allBones.map(b => b.name));
      // Try to auto-map WebXR joints to bones
      for (const joint of HAND_JOINTS) {
        const mapped = this._findBone(allBones, joint);
        if (mapped) boneMap[joint] = mapped;
      }
      console.log(`[HandRenderer] Mapped ${Object.keys(boneMap).length}/${HAND_JOINTS.length} joints`);
    }

    this.scene.add(group);
    this.hands[handIdx] = {
      group,
      model,
      boneMap: Object.keys(boneMap).length > 0 ? boneMap : null,
      visible: false,
    };
  }

  _findBone(bones, jointName) {
    const hints = JOINT_BONE_HINTS[jointName];
    if (!hints) return null;
    const jLower = jointName.toLowerCase().replace(/-/g, '');

    // 1) Exact name match (case-insensitive, ignoring separators)
    for (const bone of bones) {
      const bLower = bone.name.toLowerCase().replace(/[_.\-\s]/g, '');
      if (bLower === jLower) return bone;
    }

    // 2) Check if bone name contains key hint fragments
    // For finger joints, require both finger name AND position
    const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky', 'little'];
    const positionNames = ['metacarpal', 'proximal', 'intermediate', 'distal', 'tip'];

    const jointParts = jointName.split('-');
    const fingerHint = jointParts.find(p => fingerNames.includes(p));
    const posHint = jointParts.find(p => positionNames.includes(p));

    if (fingerHint && posHint) {
      for (const bone of bones) {
        const bLower = bone.name.toLowerCase();
        const hasFinger = bLower.includes(fingerHint) ||
          (fingerHint === 'pinky' && bLower.includes('little'));
        const hasPos = bLower.includes(posHint);
        if (hasFinger && hasPos) return bone;
      }
    }

    // 3) Wrist special case
    if (jointName === 'wrist') {
      for (const bone of bones) {
        const bLower = bone.name.toLowerCase();
        if (bLower.includes('wrist') || bLower === 'hand' ||
            bLower.includes('hand_r') || bLower.includes('hand_l')) return bone;
      }
    }

    return null;
  }

  /**
   * Update hand models from WebXR frame data.
   * Called each frame from render loop.
   * @param {XRFrame} frame
   * @param {XRReferenceSpace} refSpace
   * @param {XRInputSource[]} handSources — filtered to hand inputs only
   */
  update(frame, refSpace, handSources) {
    if (!this._loaded) return;

    // Track which hands are active this frame
    const activeThisFrame = [false, false];

    for (const src of handSources) {
      if (!src.hand) continue;
      const handIdx = src.handedness === 'left' ? 0 : 1;
      const hand = this.hands[handIdx];
      if (!hand.group) continue;

      activeThisFrame[handIdx] = true;

      // Get wrist pose for base positioning
      const wristJoint = src.hand.get('wrist');
      if (!wristJoint) continue;

      let wristPose;
      try { wristPose = frame.getJointPose(wristJoint, refSpace); } catch { continue; }
      if (!wristPose) continue;

      const wp = wristPose.transform.position;
      const wo = wristPose.transform.orientation;

      if (hand.boneMap && hand.boneMap['wrist']) {
        // Skeleton-driven: position the group at wrist, then update each bone
        hand.group.position.set(wp.x, wp.y, wp.z);
        hand.group.quaternion.set(wo.x, wo.y, wo.z, wo.w);

        // Update individual bones with relative transforms
        for (const [jointName, bone] of Object.entries(hand.boneMap)) {
          const jointSpace = src.hand.get(jointName);
          if (!jointSpace) continue;
          let pose;
          try { pose = frame.getJointPose(jointSpace, refSpace); } catch { continue; }
          if (!pose) continue;

          // Convert world pose to local bone rotation
          const q = pose.transform.orientation;
          bone.quaternion.set(q.x, q.y, q.z, q.w);

          // For mirrored hand, invert rotation on mirrored axis
          if (handIdx === 0) {
            bone.quaternion.x = -bone.quaternion.x;
            bone.quaternion.w = -bone.quaternion.w;
          }
        }
      } else {
        // No bone mapping — just position entire model at wrist with its orientation
        hand.group.position.set(wp.x, wp.y, wp.z);
        hand.group.quaternion.set(wo.x, wo.y, wo.z, wo.w);
      }

      if (!hand.visible) {
        hand.group.visible = true;
        hand.visible = true;
      }
    }

    // Hide hands that aren't tracked this frame
    for (let i = 0; i < 2; i++) {
      if (!activeThisFrame[i] && this.hands[i].visible) {
        this.hands[i].group.visible = false;
        this.hands[i].visible = false;
      }
    }
  }

  dispose() {
    for (const hand of this.hands) {
      if (hand.group) {
        this.scene.remove(hand.group);
        hand.group.traverse((node) => {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
            else node.material.dispose();
          }
        });
      }
    }
  }
}

export { HandRenderer };
