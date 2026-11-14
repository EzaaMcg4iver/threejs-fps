/**
 * main.js — BREACHLINE bootstrap and game loop.
 *
 * A round-based tactical FPS on "Yard 7": Vanguard (you + 3 bots) attack
 * two bombsites, Sentinel (4 bots) defend. Money buys better guns between
 * rounds; the bomb is planted with E and wins the round on detonation.
 *
 * Loop: fixed 60 Hz simulation steps, render every animation frame.
 * `?shot=start|mid|plant|end` sets up a deterministic scene for the
 * entry screenshots; `?seed=N` changes the bot seed.
 */
import * as THREE from 'three';
import { PHASE, TEAM, createState, resetRound } from './state.js';
import { mulberry32, range } from './rng.js';
import { buildWorld, collideCircle, segmentBlocked, SPAWNS, SITES } from './world.js';
import { createFighter, fighterEye, fireShot, damage, createTracers, spawnTracer, stepTracers, createSparks, spawnSparks, stepSparks } from './combat.js';
import { arm, startReload, stepWeapon, WEAPONS } from './weapons.js';
import { createBot, stepBot } from './bots.js';
import { stepPlayer, playerEyePos } from './player.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { startMatch, stepRounds, endRound, buyWeapon, timeoutWinner } from './rounds.js';
import { stepPlant, stepDefuse } from './bomb.js';
import { createHud, updateHud, showBanner, renderBuyMenu, setBuyVisible, flashHitmarker, flashDamage } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') ?? '1337', 10);

// ---------------------------------------------------------------- setup
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';

const world = buildWorld(scene);
const state = createState(SEED);
const rnd = mulberry32(SEED);
const audio = createAudio();
const input = createInput(canvas);
const hud = createHud();
const tracers = createTracers(scene);
const sparks = createSparks(scene);

// muzzle flash light (one, reused)
const flashLight = new THREE.PointLight(0xffc860, 0, 9, 1.8);
scene.add(flashLight);
let flashT = 0;

// explosion effect (one sphere + light, reused)
const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true, opacity: 0 })
);
scene.add(blastMesh);
const blastLight = new THREE.PointLight(0xff7a20, 0, 30, 1.5);
scene.add(blastLight);
let blastT = 0;
const pendingBlasts = []; // {x, y, z, t, from}

// bomb prop (visible when carried / planted)
const bombMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.22, 0.24),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 })
);
const bombBlink = new THREE.Mesh(
  new THREE.BoxGeometry(0.06, 0.03, 0.06),
  new THREE.MeshBasicMaterial({ color: 0xff3020 })
);
bombBlink.position.set(0, 0.13, 0);
bombMesh.add(bombBlink);
scene.add(bombMesh);

// ---------------------------------------------------------------- fighters
const BOT_NAMES = {
  VAN: ['Rook', 'Dagger', 'Wraith'],
  SEN: ['Havoc', 'Jinx', 'Nomad', 'Bishop'],
};

function makeTeam() {
  const fighters = [];
  const vanSpawns = [...SPAWNS.VAN];
  const senSpawns = [...SPAWNS.SEN];
  // player
  const ps = vanSpawns.shift();
  const player = createFighter({ team: TEAM.VAN, isPlayer: true, name: 'You', x: ps.x, z: ps.z, yaw: ps.yaw, money: 800 });
  player.weapon = arm('P9');
  state.playerId = player.id;
  fighters.push(player);
  // Vanguard bots (deep reserve: bots have no buy phase, so the standard
  // 36-round reserve would leave them dry halfway through the match)
  BOT_NAMES.VAN.forEach((name, i) => {
    const s = vanSpawns[i];
    const f = createFighter({ team: TEAM.VAN, name, x: s.x, z: s.z, yaw: s.yaw, money: 800, weaponId: 'P9' });
    f.weapon = arm('P9');
    f.weapon.reserve = 240;
    f.bot = createBot(f, i === 0 ? 'carrier' : 'rifle', rnd);
    fighters.push(f);
  });
  // Sentinel bots
  BOT_NAMES.SEN.forEach((name, i) => {
    const s = senSpawns[i];
    const f = createFighter({ team: TEAM.SEN, name, x: s.x, z: s.z, yaw: s.yaw, money: 800, weaponId: 'P9' });
    f.weapon = arm('P9');
    f.weapon.reserve = 240;
    f.bot = createBot(f, 'holder', rnd);
    fighters.push(f);
  });
  return fighters;
}

state.fighters = makeTeam();
const player = state.fighters[0];

// bot body meshes
const TEAM_COLOR = { VAN: 0xd86a20, SEN: 0x1f9a9a };
const TEAM_DARK = { VAN: 0x8a3f10, SEN: 0x0f5a5a };
function buildBodyMesh(f) {
  const g = new THREE.Group();
  const col = TEAM_COLOR[f.team];
  const dark = TEAM_DARK[f.team];
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.66, 0.3), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xc8a882, roughness: 0.8 }));
  head.position.y = 1.58;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.34), new THREE.MeshStandardMaterial({ color: dark, roughness: 0.7 }));
  helmet.position.y = 1.72;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), new THREE.MeshStandardMaterial({ color: dark, roughness: 0.9 }));
  legL.position.set(0, 0.36, 0.11);
  const legR = legL.clone();
  legR.position.z = -0.11;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.09), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.5 }));
  gun.position.set(0.42, 1.28, 0.12);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 24),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(torso, head, helmet, legL, legR, gun, ring);
  g.userData.gun = gun;
  scene.add(g);
  return g;
}
for (const f of state.fighters) {
  if (!f.isPlayer) f.mesh = buildBodyMesh(f);
}

// ---------------------------------------------------------------- shooting
const ctx = {
  colliders: world.colliders,
  waypoints: world.waypoints,
  edges: world.edges,
  sites: SITES,
  lastShot: null,
  audio,
  shoot(f) {
    return shootFighter(f);
  },
  plant(f, dt) {
    const r = stepPlant(state, f, true, dt);
    if (r === 'planted') onPlanted(f);
  },
  defuse(f, dt) {
    const r = stepDefuse(state, f, true, dt);
    if (r === 'defused') onDefused(f);
  },
};

function blockedByWorld(a, b) {
  return segmentBlocked(world.colliders, a, b);
}

function muzzlePos(f) {
  const eye = fighterEye(f);
  const d = { x: Math.cos(f.yaw), y: 0, z: -Math.sin(f.yaw) };
  return { x: eye.x + d.x * 0.6, y: eye.y - 0.18, z: eye.z + d.z * 0.6 };
}

function shootFighter(f) {
  const def = WEAPONS[f.weaponId];
  if (!f.weapon || f.weapon.mag <= 0 || f.weapon.cooldown > 0 || f.weapon.reloading > 0) return false;
  if (f.weaponId === 'FRAG') return throwFrag(f);
  const from = muzzlePos(f);
  const fired = fireShot(
    f,
    state.fighters,
    blockedByWorld,
    ({ target, zone, damage: dmg, point }) => {
      spawnTracer(tracers, from, point, def.tracer);
      spawnSparks(sparks, point, rnd);
      const died = damage(state, target, dmg, f, zone);
      if (f.isPlayer) {
        flashHitmarker(hud, zone === 'head');
        if (zone === 'head') audio.headshot();
        else audio.hit();
      }
      if (target.isPlayer) flashDamage(hud);
      if (died) checkRoundEnd();
    },
    ({ point }) => {
      spawnTracer(tracers, from, point, def.tracer);
      spawnSparks(sparks, point, rnd);
    },
    rnd
  );
  if (fired) {
    f.lastShotAt = state.time;
    ctx.lastShot = { x: f.x, z: f.z, t: state.time, team: f.team };
    const dist = Math.hypot(f.x - player.x, f.z - player.z);
    if (dist < 45) audio.shot(def.kind);
    flashLight.position.set(from.x, from.y, from.z);
    flashLight.intensity = 14;
    flashT = 0.05;
  }
  return fired;
}

function throwFrag(f) {
  const w = f.weapon;
  if (w.mag <= 0 || w.cooldown > 0) return false;
  w.mag = 0;
  w.cooldown = 1;
  f.hasFrag = false;
  // the grenade lands where the fighter is aiming, up to 25 m out
  const eye = fighterEye(f);
  const d = { x: Math.cos(f.yaw) * Math.cos(f.pitch), y: Math.sin(f.pitch), z: -Math.sin(f.yaw) * Math.cos(f.pitch) };
  let t = 25;
  for (let i = 0; i < 10; i++) {
    const mid = t / 2;
    const p = { x: eye.x + d.x * mid, y: eye.y + d.y * mid, z: eye.z + d.z * mid };
    if (blockedByWorld(eye, p) || p.y < 0) t = mid;
    else break;
  }
  const land = { x: eye.x + d.x * t, y: Math.max(0.15, eye.y + d.y * t), z: eye.z + d.z * t };
  pendingBlasts.push({ ...land, t: 0.6, from: f });
  audio.shot('pistol');
  return true;
}

function detonate(blast) {
  const { x, y, z } = blast;
  blastMesh.position.set(x, y, z);
  blastMesh.scale.setScalar(0.5);
  blastLight.position.set(x, y + 1, z);
  blastLight.intensity = 60;
  blastT = 0.55;
  audio.explosion();
  const def = WEAPONS.FRAG;
  for (const t of state.fighters) {
    if (!t.alive || t.id === blast.from.id) continue;
    const d = Math.hypot(t.x - x, t.z - z);
    if (d > def.blast) continue;
    if (blockedByWorld({ x, y: y + 0.5, z }, fighterEye(t))) continue;
    const dmg = Math.round(def.damage * (1 - d / (def.blast * 1.4)));
    if (damage(state, t, Math.max(12, dmg), blast.from, 'torso')) checkRoundEnd();
  }
}

// ---------------------------------------------------------------- round flow
function checkRoundEnd() {
  if (state.phase !== PHASE.LIVE) return;
  const vanAlive = state.fighters.some((f) => f.team === TEAM.VAN && f.alive);
  const senAlive = state.fighters.some((f) => f.team === TEAM.SEN && f.alive);
  if (!vanAlive) endRound(state, TEAM.SEN, 'SENTINEL WINS — Vanguard eliminated');
  else if (!senAlive) endRound(state, TEAM.VAN, 'VANGUARD WINS — Sentinel eliminated');
}

function onPlanted(f) {
  audio.planted();
  showBanner(hud, 'BOMB PLANTED', `Site ${state.bomb.site} — ${state.bomb.fuseT.toFixed(0)} seconds to detonation`, 3);
  state.events.unshift({ text: `${f.name} planted the bomb at ${state.bomb.site}`, t: state.time });
}

function onDefused(f) {
  audio.roundWin();
  endRound(state, TEAM.SEN, 'SENTINEL WINS — bomb defused');
}

function onExploded() {
  blastMesh.position.set(state.bomb.pos.x, 0.6, state.bomb.pos.z);
  blastMesh.scale.setScalar(0.5);
  blastLight.position.set(state.bomb.pos.x, 1.5, state.bomb.pos.z);
  blastLight.intensity = 80;
  blastT = 0.8;
  audio.explosion();
  state.bomb.state = 'exploded';
  endRound(state, TEAM.VAN, 'VANGUARD WINS — the bomb detonated');
}

function handleRoundEvent(ev) {
  if (!ev) return;
  if (ev === 'live') {
    showBanner(hud, `ROUND ${state.round}`, 'Eliminate the enemy or plant the bomb', 2.5);
  } else if (ev === 'bombExploded') {
    onExploded();
  } else if (ev === 'timeExpired') {
    const w = timeoutWinner(state);
    endRound(state, w, w === TEAM.SEN ? 'SENTINEL WINS — time expired, bomb not planted' : 'VANGUARD WINS — bomb planted, time expired');
  } else if (ev.startsWith('eliminated:')) {
    const w = ev.split(':')[1];
    endRound(state, w, w === TEAM.VAN ? 'VANGUARD WINS — Sentinel eliminated' : 'SENTINEL WINS — Vanguard eliminated');
  } else if (ev === 'nextRound') {
    for (const f of state.fighters) {
      // respawn everyone at their spawn, keep money and guns
      const list = f.team === TEAM.VAN ? SPAWNS.VAN : SPAWNS.SEN;
      const idx = state.fighters.filter((x) => x.team === f.team).indexOf(f);
      const s = list[idx % list.length];
      f.x = s.x;
      f.z = s.z;
      f.yaw = s.yaw;
      f.pitch = 0;
      f.weapon = arm(f.weaponId);
      f.hasFrag = false;
      if (f.bot) f.bot = createBot(f, f.bot.role, rnd);
    }
    state.bomb.carrierId = state.playerId;
    showBanner(hud, `ROUND ${state.round}`, 'Buy phase — B for the buy menu', 2.5);
  } else if (ev === 'matchOver') {
    const w = state.winner;
    showBanner(hud, w === TEAM.VAN ? 'VANGUARD WINS THE MATCH' : 'SENTINEL WINS THE MATCH', `Final score ${state.score.VAN} — ${state.score.SEN}`, 6);
    if (w === TEAM.VAN) audio.roundWin();
    else audio.roundLose();
  }
}

// ---------------------------------------------------------------- buy menu
let buyOpen = false;
function toggleBuy(open) {
  if (state.phase !== PHASE.FREEZE) open = false;
  buyOpen = open;
  setBuyVisible(hud, open);
  if (open) renderBuyMenu(hud, state, player);
  if (open && document.pointerLockElement) document.exitPointerLock();
}

// ---------------------------------------------------------------- screenshot presets
function applyShotPreset() {
  startMatch(state);
  const van = state.fighters.filter((f) => f.team === TEAM.VAN);
  const sen = state.fighters.filter((f) => f.team === TEAM.SEN);
  if (SHOT === 'start') {
    // freeze/buy phase at the Vanguard spawn, looking down mid
    player.x = -27;
    player.z = 0;
    player.yaw = 0;
    player.pitch = 0;
    toggleBuy(true);
    showBanner(hud, 'ROUND 1', 'Buy phase — B for the buy menu', 6);
  } else if (SHOT === 'mid') {
    // live round, firefight down the north lane (A long): two Sentinels
    // visible ahead, a Vanguard teammate peeking from the crates
    state.phase = PHASE.LIVE;
    state.phaseT = 0;
    state.timer = 62;
    player.x = -12;
    player.z = -16;
    player.yaw = 0.12;
    player.pitch = 0;
    player.weaponId = 'KESTREL';
    player.weapon = arm('KESTREL');
    player.money = 1250;
    sen[0].x = 2; sen[0].z = -16; sen[0].yaw = Math.PI; sen[0].bot.site = 'A';
    sen[1].x = 10; sen[1].z = -15; sen[1].yaw = 2.8; sen[1].bot.site = 'A';
    sen[2].x = 22; sen[2].z = 6; sen[2].yaw = Math.PI;
    van[1].x = -5.5; van[1].z = -17.5; van[1].yaw = 0.2;
    van[2].x = -4; van[2].z = -18; van[2].yaw = 0.15;
    // a tracer mid-flight for the action read
    spawnTracer(tracers, { x: -11, y: 1.5, z: -16 }, { x: 2, y: 1.4, z: -16 }, 0xfff2b0);
  } else if (SHOT === 'plant') {
    // bomb planted at A, a Sentinel defusing, fuse running
    state.phase = PHASE.LIVE;
    state.phaseT = 0;
    state.timer = 48;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.fuseT = 24;
    state.bomb.pos = { x: -22, z: -14 };
    state.bomb.defuseT = 2.1;
    player.x = -22;
    player.z = -6;
    player.yaw = Math.PI / 2;
    player.pitch = -0.04;
    player.weaponId = 'KESTREL';
    player.weapon = arm('KESTREL');
    sen[0].x = -22; sen[0].z = -14; sen[0].yaw = -Math.PI / 2; sen[0].defusing = true;
    sen[1].x = -19; sen[1].z = -18; sen[1].yaw = 2.2;
    van[1].x = -20; van[1].z = -9; van[1].yaw = 1.3;
    showBanner(hud, 'BOMB PLANTED', 'Site A — 24 seconds to detonation', 6);
  } else if (SHOT === 'end') {
    // round just won by Vanguard
    state.phase = PHASE.ROUND_END;
    state.phaseT = 3.5;
    state.score.VAN = 1;
    state.roundWinner = TEAM.VAN;
    player.x = -20;
    player.z = -12;
    player.yaw = 0.15;
    player.weaponId = 'KESTREL';
    player.weapon = arm('KESTREL');
    sen[0].x = -16; sen[0].z = -13; sen[0].yaw = 2.1;
    sen[1].x = -15; sen[1].z = -14; sen[1].yaw = 1.4;
    sen[0].alive = false; sen[0].hp = 0;
    sen[1].alive = false; sen[1].hp = 0;
    state.bomb.state = 'idle';
    showBanner(hud, 'VANGUARD WINS THE ROUND', 'Sentinel eliminated — 1 : 0', 6);
  }
}

// ---------------------------------------------------------------- input wiring
input.onFirstGesture = () => audio.unlock();
input.onLockChange = (locked) => {
  if (!locked && state.phase === PHASE.LIVE && !buyOpen && !SHOT) {
    // pointer unlocked mid-round: the menu overlay explains how to resume
  }
};
canvas.addEventListener('click', () => {
  if (state.phase === PHASE.MENU) {
    startMatch(state);
    showBanner(hud, 'ROUND 1', 'Buy phase — B for the buy menu', 2.5);
    input.requestLock();
  } else if (!input.locked && player.alive && state.phase === PHASE.LIVE) {
    input.requestLock();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && state.phase === PHASE.FREEZE) toggleBuy(!buyOpen);
  if (buyOpen && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
    const id = BUY_ORDER[parseInt(e.code.slice(-1), 10) - 1];
    if (buyWeapon(state, player, id)) {
      audio.buy();
      renderBuyMenu(hud, state, player);
    }
  }
  if (e.code === 'KeyM') {
    audio.enabled = !audio.enabled;
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- fixed step
let stagedT = 0;
function simStep(dt) {
  state.time += dt;
  const staged = !!SHOT; // screenshot presets are dioramas: pose, don't play

  // round clock + events
  if (!staged) handleRoundEvent(stepRounds(state, dt));

  // player
  if (!staged && (state.phase === PHASE.LIVE || state.phase === PHASE.FREEZE)) {
    stepPlayer(state, player, input, ctx, dt);
    // plant / defuse (player holds E)
    const holdingE = input.isDown('KeyE');
    const pr = stepPlant(state, player, holdingE, dt);
    if (pr === 'planted') onPlanted(player);
    const dr = stepDefuse(state, player, holdingE, dt);
    if (dr === 'defused') onDefused(player);
  }

  // bots
  for (const f of state.fighters) {
    if (f.isPlayer || !f.alive) continue;
    if (!staged && state.phase === PHASE.LIVE) stepBot(state, f, ctx, dt, rnd);
    stepWeapon(f.weapon, WEAPONS[f.weaponId], dt);
  }

  // staged action: a tracer every half second keeps the scene alive
  if (staged && (SHOT === 'mid' || SHOT === 'plant')) {
    stagedT -= dt;
    if (stagedT <= 0) {
      stagedT = 0.4;
      const foe = state.fighters.find((f) => f.team === TEAM.SEN && f.alive);
      if (foe) {
        spawnTracer(tracers, muzzlePos(player), { x: foe.x, y: 1.35, z: foe.z }, 0xfff2b0, 0.22);
        flashLight.position.set(player.x, 1.45, player.z);
        flashLight.intensity = 10;
        flashT = 0.05;
      }
    }
  }

  // pending grenade blasts
  for (let i = pendingBlasts.length - 1; i >= 0; i--) {
    pendingBlasts[i].t -= dt;
    if (pendingBlasts[i].t <= 0) {
      detonate(pendingBlasts.splice(i, 1)[0]);
    }
  }

  // effects
  stepTracers(tracers, dt);
  stepSparks(sparks, dt);
  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) flashLight.intensity = 0;
  }
  if (blastT > 0) {
    blastT -= dt;
    const k = Math.max(0, blastT / 0.55);
    blastMesh.scale.setScalar(0.5 + (1 - k) * 7);
    blastMesh.material.opacity = k * 0.55;
    blastLight.intensity = 60 * k;
    if (blastT <= 0) {
      blastMesh.material.opacity = 0;
      blastLight.intensity = 0;
    }
  }
  // bomb blink
  bombBlink.material.color.setHex(state.bomb.state === 'planted' ? (Math.floor(state.time * 3) % 2 ? 0xff3020 : 0x401008) : 0x20ff40);

  // bomb prop position
  if (state.bomb.state === 'planted' && state.bomb.pos) {
    bombMesh.position.set(state.bomb.pos.x, 0.12, state.bomb.pos.z);
    bombMesh.visible = true;
  } else if (state.bomb.state === 'carried') {
    const carrier = state.fighters.find((f) => f.id === state.bomb.carrierId);
    if (carrier && !carrier.isPlayer) {
      bombMesh.position.set(carrier.x, 0.9, carrier.z);
      bombMesh.visible = true;
    } else {
      bombMesh.visible = false; // the player carries it: hidden in first person
    }
  } else {
    bombMesh.visible = false;
  }

  // fighter meshes
  for (const f of state.fighters) {
    if (!f.mesh) continue;
    const m = f.mesh;
    m.position.set(f.x, 0, f.z);
    if (!f.alive) {
      m.rotation.set(0, f.yaw, Math.PI / 2);
      m.position.y = 0.15;
    } else {
      m.rotation.set(0, f.yaw, 0);
      m.position.y = Math.sin(state.time * 8 + f.id) * 0.01;
    }
    m.visible = true;
  }
}

// ---------------------------------------------------------------- render
function render() {
  // camera: first person, or spectate a living teammate when down
  let eye;
  let yaw = player.yaw;
  let pitch = player.pitch;
  if (player.alive) {
    eye = playerEyePos(player, state.time);
  } else {
    const mate = state.fighters.find((f) => f.team === player.team && f.alive);
    if (mate) {
      eye = playerEyePos(mate, state.time);
      yaw = mate.yaw;
      pitch = mate.pitch;
    } else {
      eye = { x: player.x, y: 6, z: player.z };
      pitch = -0.6;
    }
  }
  camera.position.set(eye.x, eye.y, eye.z);
  camera.rotation.y = yaw - Math.PI / 2;
  camera.rotation.x = pitch + (player.weapon ? player.weapon.recoilP * 0.5 : 0);
  camera.rotation.z = 0;
  renderer.render(scene, camera);
  updateHud(hud, state, player, 1 / 60, !!SHOT);
}

// ---------------------------------------------------------------- boot
if (SHOT) {
  // no mouse pointer in the stills: the HUD overlay is the topmost element
  // under the mouse, so it (not the canvas) decides the cursor
  document.documentElement.style.cursor = 'none';
  document.body.style.cursor = 'none';
  canvas.style.cursor = 'none';
  hud.root.style.cursor = 'none';
  applyShotPreset();
} else {
  state.phase = PHASE.MENU;
  // no banner here: the menu overlay already carries the title
}

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    simStep(STEP);
    acc -= STEP;
    n++;
  }
  if (n === 5) acc = 0;
  render();
}
requestAnimationFrame(frame);

// debug handle for local testing
window.__game = { state, player, startMatch: () => startMatch(state) };
