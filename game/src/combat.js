/**
 * combat.js — fighters, hit detection and damage. A fighter is a capsule
 * of three hit zones (head, torso, legs) tested with segment-vs-sphere /
 * segment-vs-box math, no three.js Raycaster: deterministic and fast.
 * Tracers and impact sparks are pooled so the hot loop allocates nothing.
 */
import * as THREE from 'three';
import { WEAPONS, applyShot, currentSpread } from './weapons.js';

export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE = 1.12;
export const FIGHTER_R = 0.42;

let nextId = 1;

/** Create a fighter: {team, isPlayer, x, z, yaw, weaponId, money}. */
export function createFighter(opts) {
  const f = {
    id: nextId++,
    team: opts.team,
    isPlayer: !!opts.isPlayer,
    name: opts.name,
    x: opts.x,
    z: opts.z,
    y: 0,
    yaw: opts.yaw ?? 0,
    pitch: 0,
    hp: 100,
    alive: true,
    money: opts.money ?? 800,
    weapon: null,
    weaponId: opts.weaponId ?? 'P9',
    kills: 0,
    deaths: 0,
    crouched: false,
    moving: false,
    speed: 0, // current horizontal speed, m/s
    vx: 0,
    vz: 0,
    // bot brain state (bots.js owns these fields)
    bot: null,
    // presentation (main.js owns these fields)
    mesh: null,
    muzzle: null,
    planting: false,
    defusing: false,
    lastShotAt: -10,
    lastHurtAt: -10,
    lastHurtDir: 0,
  };
  return f;
}

export function fighterEye(f) {
  return { x: f.x, y: (f.crouched ? CROUCH_EYE : EYE_HEIGHT), z: f.z };
}

/** Aim direction from yaw/pitch (yaw 0 faces -Z... here yaw 0 faces +X). */
export function aimDir(f) {
  const cp = Math.cos(f.pitch);
  return {
    x: Math.cos(f.yaw) * cp,
    y: Math.sin(f.pitch),
    z: -Math.sin(f.yaw) * cp,
  };
}

/** Segment vs sphere. Returns t in [0,1] or -1. */
export function segSphere(ax, ay, az, dx, dy, dz, cx, cy, cz, r) {
  const ox = ax - cx;
  const oy = ay - cy;
  const oz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-9) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + sq) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

/**
 * Ray (origin + dir, length `range`) against one fighter's zones.
 * Returns {t, zone} of the closest hit, or null. Zones: head (sphere),
 * torso (sphere), legs (sphere) — spheres sized to read as a body.
 */
export function rayFighter(ox, oy, oz, dx, dy, dz, range, f) {
  const headY = f.y + (f.crouched ? 1.05 : 1.52);
  const torsoY = f.y + (f.crouched ? 0.72 : 1.05);
  const legY = f.y + 0.38;
  const zones = [
    { zone: 'head', cx: f.x, cy: headY, cz: f.z, r: 0.26 },
    { zone: 'torso', cx: f.x, cy: torsoY, cz: f.z, r: 0.42 },
    { zone: 'legs', cx: f.x, cy: legY, cz: f.z, r: 0.36 },
  ];
  let best = null;
  for (const z of zones) {
    const t = segSphere(ox, oy, oz, dx * range, dy * range, dz * range, z.cx, z.cy, z.cz, z.r);
    if (t >= 0 && (best === null || t < best.t)) best = { t, zone: z.zone };
  }
  return best;
}

/** Damage multiplier by zone. */
export function zoneMult(zone) {
  return zone === 'head' ? 3 : zone === 'legs' ? 0.7 : 1;
}

/**
 * Fire one hitscan shot from fighter `shooter` at the current aim, with
 * spread applied. `targets` are the other fighters; `blockedByWorld` is
 * (a, b) => boolean for wall occlusion; `onHit` is called with
 * {target, zone, damage, point} on a fighter hit, `onMiss` with the end
 * point on a wall/ground miss. Returns true if a shot was fired.
 */
export function fireShot(shooter, targets, blockedByWorld, onHit, onMiss, rnd) {
  const def = WEAPONS[shooter.weaponId];
  const w = shooter.weapon;
  if (!w || w.mag <= 0 || w.cooldown > 0 || w.reloading > 0) return false;
  applyShot(w, def);

  // spread: random direction inside a cone around the aim
  const s = currentSpread(def, w, shooter.moving, shooter.crouched);
  const yawJ = (rnd() - 0.5) * 2 * s;
  const pitchJ = (rnd() - 0.5) * 2 * s;
  const cy = Math.cos(shooter.yaw + yawJ);
  const sy = Math.sin(shooter.yaw + yawJ);
  const cp = Math.cos(shooter.pitch + pitchJ);
  const sp = Math.sin(shooter.pitch + pitchJ);
  const d = { x: cy * cp, y: sp, z: -sy * cp };

  const eye = fighterEye(shooter);
  // nearest fighter hit — teammates are never hit (no friendly fire)
  let best = null;
  for (const t of targets) {
    if (!t.alive || t.id === shooter.id || t.team === shooter.team) continue;
    const hit = rayFighter(eye.x, eye.y, eye.z, d.x, d.y, d.z, def.range, t);
    if (!hit) continue;
    const dist = hit.t * def.range;
    const point = { x: eye.x + d.x * dist, y: eye.y + d.y * dist, z: eye.z + d.z * dist };
    if (blockedByWorld(eye, point)) continue;
    if (best === null || hit.t < best.hit.t) best = { target: t, hit, point, dist };
  }
  if (best) {
    const dmg = Math.round(def.damage * zoneMult(best.hit.zone));
    onHit({ target: best.target, zone: best.hit.zone, damage: dmg, point: best.point, dist: best.dist });
    return true;
  }
  // miss: march to the first wall or the range limit
  let end = { x: eye.x + d.x * def.range, y: eye.y + d.y * def.range, z: eye.z + d.z * def.range };
  if (end.y < 0) {
    const t = eye.y / (eye.y - end.y);
    end = { x: eye.x + d.x * def.range * t, y: 0.02, z: eye.z + d.z * def.range * t };
  } else {
    // binary-search the wall crossing for a decent impact point
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const p = { x: eye.x + d.x * def.range * mid, y: eye.y + d.y * def.range * mid, z: eye.z + d.z * def.range * mid };
      if (blockedByWorld(eye, p)) hi = mid;
      else lo = mid;
    }
    if (hi < 1) {
      end = { x: eye.x + d.x * def.range * hi, y: eye.y + d.y * def.range * hi, z: eye.z + d.z * def.range * hi };
    }
  }
  onMiss({ point: end, dist: Math.hypot(end.x - eye.x, end.y - eye.y, end.z - eye.z) });
  return true;
}

/** Apply damage; returns true if the target died. Handles the kill feed. */
export function damage(state, target, dmg, attacker, zone) {
  if (!target.alive) return false;
  target.hp -= dmg;
  target.lastHurtAt = state.time;
  if (attacker) {
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    target.lastHurtDir = Math.atan2(dz, dx);
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths += 1;
    if (attacker) {
      attacker.kills += 1;
      attacker.money += 300;
      state.kills[attacker.team] += 1;
    }
    const zoneText = zone === 'head' ? ' (headshot)' : '';
    state.feed.unshift({ text: `${attacker ? attacker.name : 'World'} ▸ ${target.name}${zoneText}`, t: state.time });
    if (state.feed.length > 5) state.feed.pop();
    return true;
  }
  return false;
}

// ------------------------------------------------------------ tracers
const MAX_TRACERS = 24;

export function createTracers(scene) {
  const pool = [];
  for (let i = 0; i < MAX_TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    pool.push({ line, life: 0 });
  }
  return pool;
}

export function spawnTracer(pool, from, to, color = 0xffe08a, life = 0.09) {
  let slot = pool.find((t) => t.life <= 0) ?? pool[0];
  const pos = slot.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  slot.line.material.color.setHex(color);
  slot.line.material.opacity = 0.9;
  slot.life = life;
  slot.maxLife = life;
}

export function stepTracers(pool, dt) {
  for (const t of pool) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / (t.maxLife ?? 0.09)) * 0.9;
    }
  }
}

/** A short-lived impact spark: three tiny lines that fade fast. */
export function createSparks(scene) {
  const pool = [];
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0 });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    pool.push({ line, life: 0 });
  }
  return pool;
}

export function spawnSparks(pool, p, rnd) {
  let slot = pool.find((s) => s.life <= 0) ?? pool[0];
  const pos = slot.line.geometry.attributes.position;
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    const b = rnd() * Math.PI - Math.PI / 2;
    const r = 0.25 + rnd() * 0.45;
    pos.setXYZ(i * 2, p.x, p.y, p.z);
    pos.setXYZ(i * 2 + 1, p.x + Math.cos(a) * Math.cos(b) * r, p.y + Math.sin(b) * r, p.z + Math.sin(a) * Math.cos(b) * r);
  }
  pos.needsUpdate = true;
  slot.line.material.opacity = 0.95;
  slot.life = 0.16;
}

export function stepSparks(pool, dt) {
  for (const s of pool) {
    if (s.life > 0) {
      s.life -= dt;
      s.line.material.opacity = Math.max(0, s.life / 0.16) * 0.95;
    }
  }
}
