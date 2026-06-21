// ─── Constants ───────────────────────────────────────────────────────────────
const LOOP_DURATION_MS = 60000;
const TIMER_SHOW_AT_MS = 50000;
const MAX_LOOPS = 5;
const MAX_LEVELS = 20;
const GHOST_COLORS = [0x4488ff, 0xff8844, 0x44ff88, 0xff44aa];

// ─── State ───────────────────────────────────────────────────────────────────
let scene, camera, renderer, clock;
let levelConfig = null;
let playerBody;
let keys = {};
let yaw = 0, pitch = 0;
let isPointerLocked = false;

let currentLevelNumber = 1;
let loopNumber = 1;
let loopStartTime = 0;
let ghostRecordings = [];
let currentRecording = [];
let ghosts = [];
let levelObjects = {};
let levelComplete = false;
let levelFailed = false;
let gameStarted = false;

let minimapCanvas, minimapCtx;
let interactTarget = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot(levelNum) {
  currentLevelNumber = levelNum || 1;
  levelConfig = await fetch('/js/levels/level' + currentLevelNumber + '.json').then(r => r.json());
  if (!scene) {
    initThree();
    setupInput();
    setupMinimap();
    renderer.setAnimationLoop(tick);
  } else {
    // Clear old scene objects for level transition
    while (scene.children.length > 0) scene.remove(scene.children[0]);
    // Re-add lights
    scene.add(new THREE.AmbientLight(0x6688aa, 1.2));
    const overhead = new THREE.DirectionalLight(0xffffff, 1.5);
    overhead.position.set(0, 8, 0);
    overhead.castShadow = true;
    scene.add(overhead);
    const vaultLight = new THREE.PointLight(0x4466ff, 2.5, 10);
    vaultLight.position.set(0, 3, -7);
    scene.add(vaultLight);
    const fillLight = new THREE.PointLight(0xffaa44, 1.2, 14);
    fillLight.position.set(0, 3, 7);
    scene.add(fillLight);
    levelObjects = {};
    ghosts = [];
  }
  buildLevel();
  loopNumber = 1;
  ghostRecordings = [];
  currentRecording = [];
  levelComplete = false;
  levelFailed = false;
  gameStarted = true;
  startLoop();
}

// ─── Three.js init ────────────────────────────────────────────────────────────
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d1a);
  scene.fog = new THREE.Fog(0x0d0d1a, 18, 45);

  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 100);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true
  });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  clock = new THREE.Clock();

  // Ambient — bright enough to see walls clearly
  scene.add(new THREE.AmbientLight(0x6688aa, 1.2));

  // Main overhead light
  const overhead = new THREE.DirectionalLight(0xffffff, 1.5);
  overhead.position.set(0, 8, 0);
  overhead.castShadow = true;
  overhead.shadow.mapSize.set(1024, 1024);
  overhead.shadow.camera.near = 0.1;
  overhead.shadow.camera.far = 30;
  overhead.shadow.camera.left = -12;
  overhead.shadow.camera.right = 12;
  overhead.shadow.camera.top = 12;
  overhead.shadow.camera.bottom = -12;
  scene.add(overhead);

  // Blue accent lights on back wall near vault door
  const vaultLight = new THREE.PointLight(0x4466ff, 2.5, 10);
  vaultLight.position.set(0, 3, -7);
  scene.add(vaultLight);

  // Warm fill light on player side
  const fillLight = new THREE.PointLight(0xffaa44, 1.2, 14);
  fillLight.position.set(0, 3, 7);
  scene.add(fillLight);

  // Lever area light
  const leverLight = new THREE.PointLight(0xffee88, 1.5, 6);
  leverLight.position.set(-5, 3, -4);
  scene.add(leverLight);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ─── Level building ───────────────────────────────────────────────────────────
function buildLevel() {
  const [w, h, d] = levelConfig.vault_size;

  // Floor — checkered tiles
  const floorGeo = new THREE.PlaneGeometry(w, d, w, d);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x1a1a30 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Floor grid lines for depth perception
  const gridHelper = new THREE.GridHelper(w, w, 0x334466, 0x223355);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // Ceiling
  const ceilMat = new THREE.MeshLambertMaterial({ color: 0x0d0d1f });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  scene.add(ceiling);

  // Walls with a slightly different color per side for orientation
  const wallDefs = [
    { pos: [0, h/2, -d/2], rot: [0, 0, 0],           size: [w, h], color: 0x1e2040 }, // back
    { pos: [0, h/2,  d/2], rot: [0, Math.PI, 0],      size: [w, h], color: 0x1a1c38 }, // front
    { pos: [-w/2, h/2, 0], rot: [0,  Math.PI/2, 0],   size: [d, h], color: 0x181b35 }, // left
    { pos: [ w/2, h/2, 0], rot: [0, -Math.PI/2, 0],   size: [d, h], color: 0x181b35 }, // right
  ];
  for (const { pos, rot, size, color } of wallDefs) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(...size),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Wall trim strips (glowing edge lines)
  addWallTrim(w, h, d);

  // Vault door — glowing gold safe door
  buildVaultDoor(levelConfig.vault_door, h);

  // Level objects
  for (const obj of levelConfig.objects) {
    if (obj.type === 'lever') buildLever(obj);
    if (obj.type === 'gate')  buildGate(obj);
  }

  // Player anchor
  playerBody = new THREE.Object3D();
  playerBody.position.set(...levelConfig.player_start);
  scene.add(playerBody);

  camera.position.set(0, 1.6, 0);
  playerBody.add(camera);
}

function addWallTrim(w, h, d) {
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x334488, emissive: 0x111133 });
  const trimH = 0.08;

  // Floor-level trim on all 4 walls
  const trims = [
    { pos: [0, trimH/2, -d/2 + 0.02], size: [w, trimH, 0.05] },
    { pos: [0, trimH/2,  d/2 - 0.02], size: [w, trimH, 0.05] },
    { pos: [-w/2 + 0.02, trimH/2, 0], size: [0.05, trimH, d] },
    { pos: [ w/2 - 0.02, trimH/2, 0], size: [0.05, trimH, d] },
  ];
  for (const { pos, size } of trims) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), trimMat);
    m.position.set(...pos);
    scene.add(m);
  }
}

function buildVaultDoor(vd, roomHeight) {
  const group = new THREE.Group();
  group.position.set(...vd.position);

  // Door frame
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x8b6914, emissive: 0x3a2800 });
  const frameThickness = 0.12;
  const [dw, dh] = [vd.size[0], vd.size[1]];

  // Top bar
  group.add(makeMesh([dw + frameThickness*2, frameThickness, 0.2], frameMat, [0, dh/2 + frameThickness/2, 0]));
  // Left bar
  group.add(makeMesh([frameThickness, dh, 0.2], frameMat, [-dw/2 - frameThickness/2, 0, 0]));
  // Right bar
  group.add(makeMesh([frameThickness, dh, 0.2], frameMat, [dw/2 + frameThickness/2, 0, 0]));

  // Door face — gold with circular pattern
  const doorMat = new THREE.MeshLambertMaterial({ color: 0xddaa00, emissive: 0x442200 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.15), doorMat);
  group.add(door);

  // Door wheel handle
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0xcc9900, emissive: 0x331100 });
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 24), wheelMat);
  wheel.position.z = 0.15;
  group.add(wheel);

  // Spokes
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.06), wheelMat);
    spoke.rotation.z = (i * Math.PI) / 4;
    spoke.position.z = 0.15;
    group.add(spoke);
  }

  // Glow indicator — shows it's the goal
  const glowLight = new THREE.PointLight(0xffaa00, 1.8, 5);
  glowLight.position.set(0, 0, 1);
  group.add(glowLight);

  group.userData.isVaultDoor = true;
  group.userData.position = vd.position;
  scene.add(group);
}

function makeMesh(size, mat, pos) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  if (pos) m.position.set(...pos);
  return m;
}

function buildLever(obj) {
  const group = new THREE.Group();
  group.position.set(...obj.position);

  // Base plate
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.08, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x445566 })
  );
  base.position.y = 0.04;
  group.add(base);

  // Pivot housing
  const pivot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12),
    new THREE.MeshLambertMaterial({ color: 0x556677 })
  );
  pivot.position.y = 0.14;
  group.add(pivot);

  // Handle rod
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 0.65, 10),
    new THREE.MeshLambertMaterial({ color: 0xff5522, emissive: 0x330a00 })
  );
  handle.position.set(0, 0.52, 0.12);
  handle.rotation.z = 0.45;
  handle.name = 'handle';
  group.add(handle);

  // Grip ball
  const grip = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0xff3300, emissive: 0x220000 })
  );
  grip.position.set(0.19, 0.78, 0.24);
  grip.name = 'grip';
  group.add(grip);

  // Interaction ring on floor
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.03, 6, 24),
    new THREE.MeshLambertMaterial({ color: 0xffdd44, emissive: 0x443300 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  ring.name = 'ring';
  group.add(ring);

  group.userData = { id: obj.id, type: 'lever', pulled: false, interactRadius: 2.2 };
  scene.add(group);
  levelObjects[obj.id] = { mesh: group, state: { pulled: false } };
}

function buildGate(obj) {
  const group = new THREE.Group();
  group.position.set(...obj.position);

  // Gate bars
  const barMat = new THREE.MeshLambertMaterial({ color: 0x3355aa, emissive: 0x0a1133 });
  const [gw, gh] = [obj.size[0], obj.size[1]];
  const barCount = Math.floor(gw / 0.5);

  for (let i = 0; i < barCount; i++) {
    const x = -gw/2 + 0.35 + i * (gw / barCount);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, gh, 8), barMat);
    bar.position.set(x, 0, 0);
    group.add(bar);
  }

  // Top and bottom crossbars
  const crossMat = new THREE.MeshLambertMaterial({ color: 0x2244aa, emissive: 0x0a1133 });
  group.add(makeMesh([gw, 0.1, 0.15], crossMat, [0, gh/2, 0]));
  group.add(makeMesh([gw, 0.1, 0.15], crossMat, [0, -gh/2 + 0.05, 0]));

  // Blue glow when closed
  const gateLight = new THREE.PointLight(0x2244ff, 1.0, 4);
  gateLight.name = 'gateLight';
  group.add(gateLight);

  group.userData = { id: obj.id, type: 'gate', open: false };
  scene.add(group);
  levelObjects[obj.id] = {
    mesh: group,
    state: { open: false, openUntil: 0 },
    config: obj
  };
}

// ─── Loop management ──────────────────────────────────────────────────────────
function startLoop() {
  loopStartTime = performance.now();
  currentRecording = [];
  resetLevelObjects();
  spawnGhosts();
  updateLoopHUD();

  document.getElementById('hint').textContent =
    loopNumber === 1
      ? (levelConfig.hint || 'Pull the lever to open the gate, then reach the vault door.')
      : `Loop ${loopNumber} — your ghost replays your last run. Coordinate!`;
}

function resetLevelObjects() {
  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.config && obj.config.type === 'gate') {
      obj.mesh.visible = true;
      obj.mesh.position.y = obj.config.position[1];
      obj.state.open = false;
      obj.state.openUntil = 0;
      const gl = obj.mesh.getObjectByName('gateLight');
      if (gl) { gl.color.set(0x2244ff); gl.intensity = 1.0; }
    }
    if (obj.mesh.userData.type === 'lever') {
      obj.state.pulled = false;
      const handle = obj.mesh.getObjectByName('handle');
      const grip   = obj.mesh.getObjectByName('grip');
      const ring   = obj.mesh.getObjectByName('ring');
      if (handle) { handle.rotation.z = 0.45; handle.position.set(0, 0.52, 0.12); }
      if (grip)   grip.position.set(0.19, 0.78, 0.24);
      if (ring)   ring.material.emissive.setHex(0x443300);
    }
  }
  playerBody.position.set(...levelConfig.player_start);
  yaw = 0; pitch = 0;
  camera.rotation.set(0, 0, 0);
  levelComplete = false;
}

function spawnGhosts() {
  for (const g of ghosts) scene.remove(g.mesh);
  ghosts = [];

  for (let i = 0; i < ghostRecordings.length; i++) {
    const geo = new THREE.CapsuleGeometry(0.28, 1.0, 4, 8);
    const col = GHOST_COLORS[i % GHOST_COLORS.length];
    const mat = new THREE.MeshLambertMaterial({
      color: col,
      transparent: true,
      opacity: 0.5,
      emissive: col,
      emissiveIntensity: 0.2
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...levelConfig.player_start);
    mesh.position.y += 0.8;
    scene.add(mesh);

    ghosts.push({
      mesh,
      recording: ghostRecordings[i],
      actionIndex: 0,
      position: new THREE.Vector3(...levelConfig.player_start),
      yaw: 0,
      loopObjects: {}
    });
  }
}

// ─── Main tick ────────────────────────────────────────────────────────────────
function tick() {
  const dt = clock.getDelta();
  const now = performance.now();
  const elapsed = now - loopStartTime;

  if (gameStarted && !levelComplete && !levelFailed) {
    movePlayer(dt);
    replayGhosts(now, elapsed);
    updateGates(now);
    checkInteract();
    checkWin();
    updateHUD(elapsed);
    drawMinimap();
  }

  renderer.render(scene, camera);
}

// ─── Player movement ──────────────────────────────────────────────────────────
function movePlayer(dt) {
  if (!isPointerLocked) return;

  const speed = 5;
  const dir = new THREE.Vector3();

  if (keys['KeyW'] || keys['ArrowUp'])    dir.z -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  dir.z += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  dir.x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dir.x += 1;

  if (dir.lengthSq() > 0) {
    dir.normalize();
    dir.applyEuler(new THREE.Euler(0, yaw, 0));
    playerBody.position.addScaledVector(dir, speed * dt);

    const [w, , d] = levelConfig.vault_size;
    playerBody.position.x = Math.max(-w/2 + 0.5, Math.min(w/2 - 0.5, playerBody.position.x));
    playerBody.position.z = Math.max(-d/2 + 0.5, Math.min(d/2 - 0.5, playerBody.position.z));

    recordAction({ type: 'move', x: playerBody.position.x, z: playerBody.position.z, yaw, t: performance.now() - loopStartTime });
  }

  camera.rotation.set(pitch, 0, 0);
  playerBody.rotation.set(0, yaw, 0);
}

// ─── Ghost replay ─────────────────────────────────────────────────────────────
function replayGhosts(now, elapsed) {
  for (const ghost of ghosts) {
    const rec = ghost.recording;
    while (ghost.actionIndex < rec.length && rec[ghost.actionIndex].t <= elapsed) {
      const action = rec[ghost.actionIndex];
      if (action.type === 'move') {
        ghost.position.set(action.x, 0.5, action.z);
        ghost.yaw = action.yaw;
      }
      if (action.type === 'interact') {
        applyInteraction(action.objectId, ghost.loopObjects);
      }
      ghost.actionIndex++;
    }
    ghost.mesh.position.copy(ghost.position);
    ghost.mesh.position.y += 0.8;
    ghost.mesh.rotation.y = ghost.yaw;
  }
}

// ─── Gate logic ───────────────────────────────────────────────────────────────
function updateGates(now) {
  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.mesh.userData.type === 'gate' && obj.state.open) {
      if (now > obj.state.openUntil) {
        obj.state.open = false;
        obj.mesh.visible = true;
      }
    }
  }
}

function openGate(gateId, loopObjs) {
  const obj = levelObjects[gateId];
  if (!obj) return;
  const duration = obj.config.open_duration || 8000;
  obj.state.open = true;
  obj.state.openUntil = performance.now() + duration;
  obj.mesh.visible = false;
  const gl = obj.mesh.getObjectByName('gateLight');
  if (gl) { gl.color.set(0x00ff88); gl.intensity = 0; }
  if (loopObjs) loopObjs[gateId] = { open: true };
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function checkInteract() {
  interactTarget = null;
  const playerPos = playerBody.position;

  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.mesh.userData.type !== 'lever') continue;
    const dist = playerPos.distanceTo(obj.mesh.position);
    if (dist < 2.5) {
      interactTarget = id;
      break;
    }
  }

  const prompt = document.getElementById('interact-prompt');
  if (interactTarget) {
    const pulled = levelObjects[interactTarget].state.pulled;
    prompt.style.display = 'block';
    prompt.textContent = pulled ? 'Lever already pulled' : 'Press E to pull lever';
    prompt.style.color = pulled ? 'rgba(255,255,255,0.4)' : '#ffdd44';
  } else {
    prompt.style.display = 'none';
  }
}

function interact() {
  if (!interactTarget || !isPointerLocked) return;
  applyInteraction(interactTarget, null);
  recordAction({ type: 'interact', objectId: interactTarget, t: performance.now() - loopStartTime });
}

function applyInteraction(objectId, loopObjs) {
  const obj = levelObjects[objectId];
  if (!obj || obj.mesh.userData.type !== 'lever') return;
  if (obj.state.pulled) return;

  obj.state.pulled = true;
  const handle = obj.mesh.getObjectByName('handle');
  const grip   = obj.mesh.getObjectByName('grip');
  const ring   = obj.mesh.getObjectByName('ring');
  if (handle) { handle.rotation.z = -0.45; handle.position.set(0, 0.52, -0.12); }
  if (grip)   grip.position.set(-0.19, 0.78, -0.24);
  if (ring)   ring.material.emissive.setHex(0x885500);

  for (const levelObj of levelConfig.objects) {
    if (levelObj.type === 'gate' && levelObj.controlled_by === objectId) {
      openGate(levelObj.id, loopObjs);
    }
  }
}

// ─── Win condition ────────────────────────────────────────────────────────────
function checkWin() {
  const vd = levelConfig.vault_door;
  const vaultPos = new THREE.Vector3(...vd.position);
  const dist = playerBody.position.distanceTo(vaultPos);

  let gateOpen = false;
  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.mesh.userData.type === 'gate' && obj.state.open) {
      gateOpen = true;
    }
  }

  if (dist < 2.5 && gateOpen) {
    const elapsed = performance.now() - loopStartTime;
    const totalMs = ghostRecordings.reduce((acc, r) => acc + (r.loopDuration || LOOP_DURATION_MS), 0) + elapsed;
    onLevelComplete(totalMs, loopNumber);
  }
}

function onLevelComplete(totalMs, loopsUsed) {
  levelComplete = true;
  exitPointerLock();

  const secs = (totalMs / 1000).toFixed(2);
  const isLast = currentLevelNumber >= MAX_LEVELS;
  const nextBtn = isLast
    ? '<button onclick="restartLevel()">Play Again</button>'
    : '<button onclick="nextLevel()">Next Level</button><button onclick="restartLevel()" style="margin-left:12px;background:#555;color:#fff">Replay</button>';

  showOverlay(`
    <h1>Vault Opened!</h1>
    <p>Level ${currentLevelNumber} — ${levelConfig.name}</p>
    <p>Completed on Loop ${loopsUsed} of ${MAX_LOOPS}</p>
    <div class="big-time">${secs}s</div>
    ${isLast ? '<p style="color:#ffdd44">You beat all 20 levels!</p>' : ''}
    ${nextBtn}
  `);

  submitScore(totalMs, loopsUsed);
}

// ─── Loop end ─────────────────────────────────────────────────────────────────
function endLoop() {
  const loopDuration = performance.now() - loopStartTime;
  currentRecording.loopDuration = loopDuration;
  ghostRecordings.push([...currentRecording]);

  if (loopNumber >= MAX_LOOPS) {
    onAllLoopsFailed();
    return;
  }

  loopNumber++;
  startLoop();
}

function onAllLoopsFailed() {
  levelFailed = true;
  exitPointerLock();
  const isLast = currentLevelNumber >= MAX_LEVELS;
  const nextBtn = isLast
    ? '<button onclick="restartLevel()">Try Again</button>'
    : '<button onclick="nextLevel()">Next Level</button><button onclick="restartLevel()" style="margin-left:12px;background:#555;color:#fff">Try Again</button>';
  showOverlay(`
    <h1>Loop 5 Complete</h1>
    <p>Level ${currentLevelNumber} — ${levelConfig.name}</p>
    <p style="margin-top:8px;font-size:14px;color:rgba(255,255,255,0.5)">The vault held its secrets this time.</p>
    ${nextBtn}
  `);
}

// ─── Recording ────────────────────────────────────────────────────────────────
function recordAction(action) {
  currentRecording.push(action);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateLoopHUD() {
  document.getElementById('loop-counter').textContent =
    `LVL ${currentLevelNumber}  ·  LOOP ${loopNumber} / ${MAX_LOOPS}`;
}

function updateHUD(elapsed) {
  updateLoopHUD();

  const timerEl = document.getElementById('timer');
  if (elapsed >= TIMER_SHOW_AT_MS) {
    const remaining = Math.ceil((LOOP_DURATION_MS - elapsed) / 1000);
    timerEl.style.display = 'block';
    timerEl.textContent = remaining > 0 ? remaining : '0';
    if (remaining <= 0) endLoop();
  } else {
    timerEl.style.display = 'none';
  }
}

// ─── Minimap ──────────────────────────────────────────────────────────────────
function setupMinimap() {
  minimapCanvas = document.createElement('canvas');
  minimapCanvas.width = 150;
  minimapCanvas.height = 150;
  document.getElementById('minimap').appendChild(minimapCanvas);
  minimapCtx = minimapCanvas.getContext('2d');
}

function drawMinimap() {
  if (!minimapCtx) return;
  const ctx = minimapCtx;
  const [w, , d] = levelConfig.vault_size;
  const scale = 144 / Math.max(w, d);

  ctx.clearRect(0, 0, 150, 150);
  ctx.fillStyle = 'rgba(5,5,20,0.92)';
  ctx.fillRect(0, 0, 150, 150);

  ctx.strokeStyle = 'rgba(80,120,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(3, 3, 144, 144);

  function worldToMap(x, z) {
    return [(x + w/2) * scale + 3, (z + d/2) * scale + 3];
  }

  // Gate
  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.mesh.userData.type === 'gate') {
      const [mx, mz] = worldToMap(obj.mesh.position.x, obj.mesh.position.z);
      ctx.fillStyle = obj.state.open ? 'rgba(0,255,140,0.7)' : 'rgba(60,120,255,0.7)';
      ctx.fillRect(mx - 10, mz - 2, 20, 4);
    }
    if (obj.mesh.userData.type === 'lever') {
      const [mx, mz] = worldToMap(obj.mesh.position.x, obj.mesh.position.z);
      ctx.fillStyle = obj.state.pulled ? '#ff8844' : '#ffee44';
      ctx.beginPath();
      ctx.arc(mx, mz, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Vault door
  const vd = levelConfig.vault_door;
  const [vx, vz] = worldToMap(vd.position[0], vd.position[2]);
  ctx.fillStyle = '#ddaa00';
  ctx.fillRect(vx - 7, vz - 3, 14, 6);

  // Ghost trails
  for (let i = 0; i < ghosts.length; i++) {
    const [gx, gz] = worldToMap(ghosts[i].position.x, ghosts[i].position.z);
    const hex = GHOST_COLORS[i].toString(16).padStart(6, '0');
    ctx.fillStyle = `#${hex}`;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(gx, gz, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Player dot + direction
  const [px, pz] = worldToMap(playerBody.position.x, playerBody.position.z);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px, pz, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, pz);
  ctx.lineTo(px + Math.sin(yaw) * -12, pz + Math.cos(yaw) * -12);
  ctx.stroke();
}

// ─── Score submission ─────────────────────────────────────────────────────────
async function submitScore(totalMs, loopsUsed) {
  try {
    await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level_number: 1, time_ms: Math.round(totalMs), loops_used: loopsUsed })
    });
  } catch (e) { /* guest or offline — ignore */ }
}

// ─── Input ────────────────────────────────────────────────────────────────────
function setupInput() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyE') interact();
    if (e.code === 'Escape') exitPointerLock();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });

  document.getElementById('game-canvas').addEventListener('click', () => {
    if (gameStarted && !levelComplete && !levelFailed) requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = !!document.pointerLockElement;
  });

  document.addEventListener('mousemove', e => {
    if (!isPointerLocked) return;
    yaw   -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch  = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, pitch));
  });
}

function requestPointerLock() {
  document.getElementById('game-canvas').requestPointerLock();
}

function exitPointerLock() {
  if (document.pointerLockElement) document.exitPointerLock();
  isPointerLocked = false;
}

// ─── Overlay ──────────────────────────────────────────────────────────────────
function showOverlay(html) {
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = html;
  overlay.style.display = 'flex';
}

function hideOverlay() {
  document.getElementById('overlay').style.display = 'none';
}

// ─── Restart / Next ───────────────────────────────────────────────────────────
function restartLevel() {
  hideOverlay();
  boot(currentLevelNumber).then(() => requestPointerLock());
}

function nextLevel() {
  const next = currentLevelNumber < MAX_LEVELS ? currentLevelNumber + 1 : 1;
  hideOverlay();
  boot(next).then(() => requestPointerLock());
}

// ─── Global exports ───────────────────────────────────────────────────────────
window.restartLevel = restartLevel;
window.nextLevel = nextLevel;
window.hideOverlay = hideOverlay;
window.requestPointerLock = requestPointerLock;
window.boot = boot;

// ─── Start screen ─────────────────────────────────────────────────────────────
showOverlay(`
  <h1>The Butterfly Effect</h1>
  <p>20 Levels &nbsp;·&nbsp; 5 Loops Each</p>
  <p style="margin-top:8px;font-size:15px;color:rgba(255,255,255,0.6)">
    Pull levers to open gates.<br>Reach the vault door before time runs out.<br>
    Each loop, your past self replays beside you.
  </p>
  <p style="margin-top:10px;font-size:13px;color:rgba(255,255,255,0.3)">
    WASD — move &nbsp;·&nbsp; Mouse — look &nbsp;·&nbsp; E — interact
  </p>
  <button onclick="hideOverlay(); boot(1).then(() => requestPointerLock());">Play Level 1</button>
`);
