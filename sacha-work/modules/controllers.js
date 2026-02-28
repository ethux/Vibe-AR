// ── XR Controllers (fallback when hand tracking not available) ────────────────
const controllerGrip0 = renderer.xr.getControllerGrip(0);
const controllerGrip1 = renderer.xr.getControllerGrip(1);
scene.add(controllerGrip0, controllerGrip1);

const controller0 = renderer.xr.getController(0);
const controller1 = renderer.xr.getController(1);
scene.add(controller0, controller1);

// Ray line visual
function addRayVisual(ctrl) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -3)]);
  ctrl.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6366f1, linewidth: 2 })));
}
addRayVisual(controller0);
addRayVisual(controller1);

// Simple box grip model
function addControllerModel(grip) {
  grip.add(new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.5 })
  ));
}
addControllerModel(controllerGrip0);
addControllerModel(controllerGrip1);

// ── Controller window drag ────────────────────────────────────────────────────
const raycaster     = new THREE.Raycaster();
const tempMatrix    = new THREE.Matrix4();
let   dragging      = false;
let   activeController = null;
let   dragOffset    = new THREE.Vector3();

function onSelectStart(event) {
  const ctrl = event.target;
  tempMatrix.identity().extractRotation(ctrl.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  const hits = raycaster.intersectObject(titleBar, true);
  if (hits.length > 0) {
    dragging = true;
    activeController = ctrl;
    dragOffset.copy(windowBody.position).sub(hits[0].point);
    borderMat.opacity = 0.7;
    titleMat.color.set(0x5a5a8c);
  }
}

function onSelectEnd(event) {
  if (dragging && event.target === activeController) {
    dragging = false;
    activeController = null;
    borderMat.opacity = 0.3;
    titleMat.color.set(0x3a3a5c);
  }
}

controller0.addEventListener('selectstart', onSelectStart);
controller0.addEventListener('selectend',   onSelectEnd);
controller1.addEventListener('selectstart', onSelectStart);
controller1.addEventListener('selectend',   onSelectEnd);
