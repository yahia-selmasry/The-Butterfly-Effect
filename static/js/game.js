// ─── Constants ───────────────────────────────────────────────────────────────
const LOOP_DURATION_MS = 60000;
const TIMER_SHOW_AT_MS = 50000;
const MAX_LOOPS = 5;
const GHOST_COLORS = [0x4488ff, 0xff8844, 0x44ff88, 0xff44aa];

// ─── State ───────────────────────────────────────────────────────────────────
let scene, camera, renderer, clock;
let levelConfig = null;
let playerBody, playerVelocity;
let keys = {};
let yaw = 0, pitch = 0;
let isPointerLocked = false;

let loopNumber = 1;
let loopStartTime = 0;
let ghostRecordings = [];   // array of completed loop recordings
let currentRecording = [];  // actions recorded this loop
let ghosts = [];            // live ghost meshes + playback state
let levelObjects = {};      // id → { mesh, state }
let levelComplete = false;
let levelFailed = false;

let minimapCanvas, minimapCtx;
let interactTarget = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  levelConfig = await fetch('/static/levels/level1.json').then(r => r.json());
  initThree();
  buildLevel();
  setupInput();
  setupMinimap();
  startLoop();
  renderer.setAnimationLoop(tick);
}

// ─── Three.js init ────────────────────────────────────────────────────────────
function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 15, 40);

  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 100);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;

  clock = new THREE.Clock();

  // Lighting
  scene.add(new THREE.AmbientLight(0x404060, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Point lights for atmosphere
  const p1 = new THREE.PointLight(0x4444ff, 0.5, 12);
  p1.position.set(-5, 3, -4);
  scene.add(p1);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ─── Level building ───────────────────────────────────────────────────────────
function buildLevel() {
  const [w, h, d] = levelConfig.vault_size;

  const floorMat = new THREE.MeshLambertMaterial({ color: 0x222233 });
  const wallMat  = new THREE.MeshLambertMaterial({ color: 0x2a2a4a });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Ceiling
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: 0x111122 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  scene.add(ceiling);

  // Walls
  const walls = [
    { pos: [0, h/2, -d/2], rot: [0, 0, 0],        size: [w, h] },
    { pos: [0, h/2,  d/2], rot: [0, Math.PI, 0],   size: [w, h] },
    { pos: [-w/2, h/2, 0], rot: [0,  Math.PI/2, 0], size: [d, h] },
    { pos: [ w/2, h/2, 0], rot: [0, -Math.PI/2, 0], size: [d, h] },
  ];
  for (const { pos, rot, size } of walls) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), wallMat);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    scene.add(mesh);
  }

  // Vault door (glowing gold target)
  const vd = levelConfig.vault_door;
  const vaultDoor = new THREE.Mesh(
    new THREE.BoxGeometry(...vd.size),
    new THREE.MeshLambertMaterial({ color: 0xddaa00, emissive: 0x443300 })
  );
  vaultDoor.position.set(...vd.position);
  vaultDoor.userData.isVaultDoor = true;
  scene.add(vaultDoor);

  // Level objects
  for (const obj of levelConfig.objects) {
    if (obj.type === 'lever') buildLever(obj);
    if (obj.type === 'gate')  buildGate(obj);
  }

  // Player capsule (invisible, just a position anchor)
  playerBody = new THREE.Object3D();
  playerBody.position.set(...levelConfig.player_start);
  scene.add(playerBody);
  playerVelocity = new THREE.Vector3();

  camera.position.set(0, 1.6, 0);
  playerBody.add(camera);
}

function buildLever(obj) {
  const group = new THREE.Group();
  group.position.set(...obj.position);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.1, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x555566 })
  );
  group.add(base);

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.6),
    new THREE.MeshLambertMaterial({ color: 0xff6644 })
  );
  handle.position.set(0, 0.35, 0);
  handle.rotation.z = 0.4;
  handle.name = 'handle';
  group.add(handle);

  // Glow ring to signal interactability
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.03, 8, 20),
    new THREE.MeshLambertMaterial({ color: 0xffdd44, emissive: 0x443300 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  group.userData = { id: obj.id, type: 'lever', pulled: false, interactRadius: 2 };
  scene.add(group);
  levelObjects[obj.id] = { mesh: group, state: { pulled: false } };
}

function buildGate(obj) {
  const gate = new THREE.Mesh(
    new THREE.BoxGeometry(...obj.size),
    new THREE.MeshLambertMaterial({ color: 0x334455, transparent: true, opacity: 0.85 })
  );
  gate.position.set(...obj.position);
  gate.castShadow = true;
  gate.userData = { id: obj.id, type: 'gate', open: false };
  scene.add(gate);
  levelObjects[obj.id] = {
    mesh: gate,
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
    loopNumber === 1 ? levelConfig.hint : `Loop ${loopNumber} — coordinate with your ghost${loopNumber > 2 ? 's' : ''}.`;
}

function resetLevelObjects() {
  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.config && obj.config.type === 'gate') {
      obj.mesh.visible = true;
      obj.mesh.position.y = obj.config.position[1];
      obj.state.open = false;
    }
    if (obj.mesh.userData.type === 'lever') {
      obj.state.pulled = false;
      const handle = obj.mesh.getObjectByName('handle');
      if (handle) handle.rotation.z = 0.4;
    }
  }
  // Reset player
  playerBody.position.set(...levelConfig.player_start);
  yaw = 0; pitch = 0;
  camera.rotation.set(0, 0, 0);
  levelComplete = false;
}

function spawnGhosts() {
  // Remove old ghost meshes
  for (const g of ghosts) scene.remove(g.mesh);
  ghosts = [];

  for (let i = 0; i < ghostRecordings.length; i++) {
    const geo = new THREE.CapsuleGeometry(0.3, 1.0, 4, 8);
    const mat = new THREE.MeshLambertMaterial({
      color: GHOST_COLORS[i % GHOST_COLORS.length],
      transparent: true,
      opacity: 0.45
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...levelConfig.player_start);
    scene.add(mesh);

    ghosts.push({
      mesh,
      recording: ghostRecordings[i],
      actionIndex: 0,
      position: new THREE.Vector3(...levelConfig.player_start),
      yaw: 0,
      loopObjects: {}  // ghost's own view of object states
    });
  }
}

// ─── Main tick ────────────────────────────────────────────────────────────────
function tick() {
  const dt = clock.getDelta();
  const now = performance.now();
  const elapsed = now - loopStartTime;

  if (!levelComplete && !levelFailed) {
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
  if (loopObjs) loopObjs[gateId] = { open: true };
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function checkInteract() {
  interactTarget = null;
  const playerPos = playerBody.position;

  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.mesh.userData.type !== 'lever') continue;
    const dist = playerPos.distanceTo(obj.mesh.position);
    if (dist < 2.2) {
      interactTarget = id;
      break;
    }
  }

  const prompt = document.getElementById('interact-prompt');
  if (interactTarget) {
    prompt.style.display = 'block';
    prompt.textContent = 'Press E to pull lever';
  } else {
    prompt.style.display = 'none';
  }
}

function interact() {
  if (!interactTarget) return;
  applyInteraction(interactTarget, null);
  recordAction({ type: 'interact', objectId: interactTarget, t: performance.now() - loopStartTime });
}

function applyInteraction(objectId, loopObjs) {
  const obj = levelObjects[objectId];
  if (!obj || obj.mesh.userData.type !== 'lever') return;
  if (obj.state.pulled) return;

  obj.state.pulled = true;
  const handle = obj.mesh.getObjectByName('handle');
  if (handle) handle.rotation.z = -0.4;

  // Find gates controlled by this lever
  for (const levelObj of levelConfig.objects) {
    if (levelObj.type === 'gate' && levelObj.controlled_by === objectId) {
      openGate(levelObj.id, loopObjs);
    }
  }
}

// ─── Win condition ────────────────────────────────────────────────────────────
function checkWin() {
  const vd = levelConfig.vault_door;
  const dist = playerBody.position.distanceTo(new THREE.Vector3(...vd.position));

  // Check that the gate is open (player can reach vault door)
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
  showOverlay('vault-open', `
    <h1>Vault Opened!</h1>
    <p>Loop ${loopsUsed} of ${MAX_LOOPS}</p>
    <div class="big-time">${secs}s</div>
    <p>Total time across all loops</p>
    <button onclick="restartLevel()">Play Again</button>
  `);

  submitScore(totalMs, loopsUsed);
}

// ─── Loop end ─────────────────────────────────────────────────────────────────
function endLoop() {
  const loopDuration = performance.now() - loopStartTime;
  currentRecording.loopDuration = loopDuration;
  ghostRecordings.push(currentRecording);

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
  showOverlay('failed', `
    <h1>Loop 5 Complete</h1>
    <p>The vault held its secrets this time.</p>
    <p>Moving on...</p>
    <button onclick="restartLevel()">Try Again</button>
  `);
}

// ─── Recording ────────────────────────────────────────────────────────────────
function recordAction(action) {
  currentRecording.push(action);
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateLoopHUD() {
  document.getElementById('loop-counter').textContent = `LOOP ${loopNumber} / ${MAX_LOOPS}`;
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
  const ctx = minimapCtx;
  const [w, , d] = levelConfig.vault_size;
  const scale = 150 / Math.max(w, d);

  ctx.clearRect(0, 0, 150, 150);
  ctx.fillStyle = 'rgba(0,0,20,0.8)';
  ctx.fillRect(0, 0, 150, 150);

  // Walls
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.strokeRect(2, 2, 146, 146);

  function worldToMap(x, z) {
    return [(x + w/2) * scale, (z + d/2) * scale];
  }

  // Gate
  for (const [id, obj] of Object.entries(levelObjects)) {
    if (obj.mesh.userData.type === 'gate') {
      const [mx, mz] = worldToMap(obj.mesh.position.x, obj.mesh.position.z);
      ctx.fillStyle = obj.state.open ? 'rgba(0,255,100,0.6)' : 'rgba(100,150,255,0.6)';
      ctx.fillRect(mx - 8, mz - 2, 16, 4);
    }
    if (obj.mesh.userData.type === 'lever') {
      const [mx, mz] = worldToMap(obj.mesh.position.x, obj.mesh.position.z);
      ctx.fillStyle = obj.state.pulled ? '#ff8844' : '#ffdd44';
      ctx.fillRect(mx - 3, mz - 3, 6, 6);
    }
  }

  // Vault door
  const vd = levelConfig.vault_door;
  const [vx, vz] = worldToMap(vd.position[0], vd.position[2]);
  ctx.fillStyle = '#ddaa00';
  ctx.fillRect(vx - 6, vz - 3, 12, 6);

  // Ghosts
  for (let i = 0; i < ghosts.length; i++) {
    const [gx, gz] = worldToMap(ghosts[i].position.x, ghosts[i].position.z);
    ctx.fillStyle = `#${GHOST_COLORS[i].toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.arc(gx, gz, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player
  const [px, pz] = worldToMap(playerBody.position.x, playerBody.position.z);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px, pz, 5, 0, Math.PI * 2);
  ctx.fill();

  // Player direction indicator
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, pz);
  ctx.lineTo(px + Math.sin(yaw) * -10, pz + Math.cos(yaw) * -10);
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
  } catch (e) {
    // Guest or network error — silently ignore
  }
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
    if (!levelComplete && !levelFailed) requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = !!document.pointerLockElement;
  });

  document.addEventListener('mousemove', e => {
    if (!isPointerLocked) return;
    yaw   -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch  = Math.max(-Math.PI/3, Math.min(Math.PI/3, pitch));
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
function showOverlay(type, html) {
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = html;
  overlay.style.display = 'flex';
}

function hideOverlay() {
  document.getElementById('overlay').style.display = 'none';
}

// ─── Restart ──────────────────────────────────────────────────────────────────
function restartLevel() {
  loopNumber = 1;
  ghostRecordings = [];
  currentRecording = [];
  ghosts = [];
  levelComplete = false;
  levelFailed = false;

  // Remove ghost meshes
  for (const g of ghosts) scene.remove(g.mesh);

  hideOverlay();
  startLoop();
  requestPointerLock();
}

// ─── Start ────────────────────────────────────────────────────────────────────
window.restartLevel = restartLevel;

// Show start overlay
document.getElementById('overlay').innerHTML = `
  <h1>The Butterfly Effect</h1>
  <p>Level 1 — The First Door</p>
  <p style="margin-top:8px; font-size:14px; color:rgba(255,255,255,0.5)">
    WASD to move &nbsp;·&nbsp; Mouse to look &nbsp;·&nbsp; E to interact
  </p>
  <button onclick="hideOverlay(); requestPointerLock(); boot();">Play</button>
`;
document.getElementById('overlay').style.display = 'flex';

window.hideOverlay = hideOverlay;
window.requestPointerLock = requestPointerLock;
window.boot = boot;
