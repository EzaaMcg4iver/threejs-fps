/**
 * bots.js — bot AI. Each bot walks a waypoint graph, holds positions,
 * reacts to what it sees and hears, shoots in bursts, and plays the
 * objective: Vanguard bots push a site and plant, Sentinel bots hold and
 * rotate to the planted bomb. Vision is a cone + line of sight; hearing
 * is a radius around recent gunshots.
 */
import { fighterEye } from './combat.js';
import { collideCircle, segmentBlocked } from './world.js';
import { clamp, pick, range } from './rng.js';
import { startReload, WEAPONS } from './weapons.js';

const BOT_SPEED = 3.6;
const SEE_DIST = 46;
const HEAR_DIST = 26;
const FOV_COS = 0.2; // cos(78 deg): bots see a wide cone, not behind them

/** Create the brain for a fighter. `role` is 'carrier' | 'rifle' | 'holder'. */
export function createBot(fighter, role, rnd) {
  return {
    role,
    state: 'advance', // advance | hold | engage | plant | defuse | rotate
    path: [],
    pathI: 0,
    goalWp: -1,
    site: pick(rnd, ['A', 'B']),
    holdWp: -1,
    holdT: 0,
    thinkT: range(rnd, 0, 0.15), // staggered thinking
    target: null,
    reactT: 0, // seconds until the bot may open fire on its target
    burstLeft: 0,
    burstT: 0,
    burstWait: 0, // pause between bursts (lets bloom recover)
    aimErr: 0.015, // radians of aim error; 0.03 never lands a hit past ~20 m
    plantT: 0,
    defuseT: 0,
    stuckT: 0, // seconds the bot has barely moved while trying to walk
    lastX: 0,
    lastZ: 0,
    lastSeen: null, // {x, z, t} last known enemy position
  };
}

/** Change the destination only when it actually changes: resetting the
 * path on every think tick (8x a second) restarts the walk from the
 * nearest waypoint, which is usually the one the bot just left, so the
 * bot walks back and forth forever instead of advancing. */
function setGoal(b, wpIndex) {
  if (b.goalWp !== wpIndex) {
    b.goalWp = wpIndex;
    b.path = [];
    b.pathI = 0;
  }
}

function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** BFS path over the waypoint graph. Returns waypoint ids, goal last. */
export function findPath(edges, n, from, to) {
  if (from === to) return [to];
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const prev = new Array(n).fill(-1);
  const q = [from];
  prev[from] = from;
  while (q.length) {
    const cur = q.shift();
    for (const nb of adj[cur]) {
      if (prev[nb] === -1) {
        prev[nb] = cur;
        if (nb === to) {
          const path = [to];
          let c = to;
          while (c !== from) { c = prev[c]; path.unshift(c); }
          return path;
        }
        q.push(nb);
      }
    }
  }
  return [to];
}

function canSee(ctx, a, b) {
  const ea = fighterEye(a);
  const eb = fighterEye(b);
  const dx = eb.x - ea.x;
  const dz = eb.z - ea.z;
  const dist = Math.hypot(dx, dz);
  if (dist > SEE_DIST) return false;
  // field of view: bots face their yaw
  const fx = Math.cos(a.yaw);
  const fz = -Math.sin(a.yaw);
  if ((dx * fx + dz * fz) / Math.max(dist, 0.001) < FOV_COS && dist > 3) return false;
  return !segmentBlocked(ctx.colliders, ea, eb);
}

/** Nearest visible enemy of `f`, or null. */
function visibleEnemy(ctx, state, f) {
  let best = null;
  let bd = Infinity;
  for (const t of state.fighters) {
    if (!t.alive || t.team === f.team) continue;
    const d = Math.hypot(t.x - f.x, t.z - f.z);
    if (d < bd && canSee(ctx, f, t)) { bd = d; best = t; }
  }
  return best;
}

function stepMove(ctx, f, tx, tz, dt, speed) {
  const dx = tx - f.x;
  const dz = tz - f.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) return true;
  const sp = Math.min(speed, d / dt);
  const nx = f.x + (dx / d) * sp * dt;
  const nz = f.z + (dz / d) * sp * dt;
  const c = collideCircle(ctx.colliders, nx, nz, 0.42);
  f.x = c.x;
  f.z = c.z;
  f.moving = true;
  f.speed = sp;
  // face the direction of travel
  const want = Math.atan2(-(dz / d), dx / d);
  let diff = want - f.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  f.yaw += clamp(diff, -dt * 6, dt * 6);
  return false;
}

function aimAt(f, tx, ty, tz, err, rnd) {
  const dx = tx - f.x;
  const dz = tz - f.z;
  const dy = ty - (f.crouched ? 1.12 : 1.62);
  const wantYaw = Math.atan2(-dz, dx);
  const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
  const e = err * (0.5 + rnd());
  f.yaw = wantYaw + (rnd() - 0.5) * e;
  f.pitch = clamp(wantPitch + (rnd() - 0.5) * e, -1.2, 1.2);
}

/** One fixed step of one bot. `ctx` carries the world + callbacks. */
export function stepBot(state, f, ctx, dt, rnd) {
  const b = f.bot;
  if (!f.alive || !b) return;
  b.thinkT -= dt;

  // reload when the magazine is empty (bots never press R)
  if (f.weapon && f.weapon.mag === 0 && f.weapon.reloading === 0) {
    startReload(f.weapon, WEAPONS[f.weaponId]);
  }

  // --- periodic thinking: pick a target, a goal, a state
  if (b.thinkT <= 0) {
    b.thinkT = 0.12;
    const enemy = visibleEnemy(ctx, state, f);
    if (enemy) {
      if (b.target !== enemy) {
        b.target = enemy;
        b.reactT = range(rnd, 0.35, 0.7); // reaction time before firing
        b.burstLeft = 0;
      }
      b.state = 'engage';
      b.lastSeen = { x: enemy.x, z: enemy.z, t: state.time };
    } else if (b.target && state.time - (b.lastSeen?.t ?? -99) < 1.2 && b.lastSeen) {
      // lost sight recently: keep engaging the last known spot briefly
      b.state = 'engage';
    } else {
      b.target = null;
      b.state = decideGoal(state, f, b, ctx, rnd);
    }
  }

  // --- act on the state
  if (b.state === 'engage' && b.target && b.target.alive) {
    const t = b.target;
    // aim at the chest, not the eye: aiming at eye level turns every
    // hit into a one-shot headshot (bots would be headshot machines)
    const aimY = t.y + (t.crouched ? 0.72 : 1.05);
    aimAt(f, t.x, aimY, t.z, b.aimErr, rnd);
    const dist = Math.hypot(t.x - f.x, t.z - f.z);
    if (dist > 20) {
      // close the distance: walk the waypoint path toward the target.
      // Standing still and plinking at 45 m never kills anyone — spread
      // and bloom make long-range pistol fire a lottery.
      setGoal(b, nearestWaypoint(ctx.waypoints, t.x, t.z));
      const wp = ctx.waypoints;
      if (b.path.length === 0 || b.pathI >= b.path.length) {
        b.path = findPath(ctx.edges, wp.length, nearestWaypoint(wp, f.x, f.z), b.goalWp);
        b.pathI = 0;
      }
      const next = wp[b.path[b.pathI]];
      if (next && stepMove(ctx, f, next.x, next.z, dt, BOT_SPEED)) b.pathI += 1;
    } else {
      f.moving = false;
      f.speed = 0;
    }
    b.reactT -= dt;
    if (b.reactT <= 0) {
      b.burstWait -= dt;
      if (b.burstWait <= 0) {
        if (b.burstLeft <= 0) {
          b.burstLeft = 3 + Math.floor(rnd() * 3);
          b.burstT = 0;
        }
        b.burstT -= dt;
        if (b.burstLeft > 0 && b.burstT <= 0) {
          b.burstLeft -= 1;
          b.burstT = 0.12;
          ctx.shoot(f);
          if (b.burstLeft === 0) b.burstWait = 0.5 + rnd() * 0.7;
        }
      }
    }
    return;
  }

  // movement states: every state walks the waypoint path to b.goalWp.
  // Holders walk the path too (a straight line would run them into a
  // wall and stick them there); plant/defuse act when standing in the
  // site, holders scan the lane once they arrive.
  const wp = ctx.waypoints;
  if (b.state === 'plant') {
    const site = ctx.sites[f.bot.site];
    if (Math.hypot(site.x - f.x, site.z - f.z) < 2.2) {
      f.moving = false;
      f.speed = 0;
      f.planting = true;
      ctx.plant(f, dt);
      return;
    }
  } else if (b.state === 'defuse') {
    const site = state.bomb.site ? ctx.sites[state.bomb.site] : null;
    if (site && Math.hypot(site.x - f.x, site.z - f.z) < 2.2) {
      f.moving = false;
      f.speed = 0;
      f.defusing = true;
      ctx.defuse(f, dt);
      return;
    }
    if (!site) { f.moving = false; f.speed = 0; return; }
  }
  const dest = wp[b.goalWp];
  if (!dest) { f.moving = false; f.speed = 0; return; }
  if (Math.hypot(dest.x - f.x, dest.z - f.z) < 0.6) {
    // arrived: watch the lane instead of standing still facing a wall
    f.moving = false;
    f.speed = 0;
    f.yaw += dt * 0.5;
    return;
  }
  // stuck detection: if the bot has barely moved for a while while trying
  // to walk, its path is stale (an engagement moved it off the graph) —
  // drop it so it is recomputed from the nearest waypoint. (A distance
  // check on the next node does NOT work here: waypoint legs are up to
  // 12 m, so it would recompute every frame and the bot would never
  // leave the waypoint it stands on.)
  const moved = Math.hypot(f.x - b.lastX, f.z - b.lastZ);
  b.lastX = f.x;
  b.lastZ = f.z;
  if (moved < 0.02) b.stuckT += dt; else b.stuckT = 0;
  if (b.stuckT > 0.75) { b.path = []; b.pathI = 0; b.stuckT = 0; }
  if (b.path.length === 0 || b.pathI >= b.path.length) {
    b.path = findPath(ctx.edges, wp.length, nearestWaypoint(wp, f.x, f.z), b.goalWp);
    b.pathI = 0;
  }
  const next = wp[b.path[b.pathI]];
  if (next && stepMove(ctx, f, next.x, next.z, dt, BOT_SPEED)) b.pathI += 1;
}

function decideGoal(state, f, b, ctx, rnd) {
  const wp = ctx.waypoints;
  // bomb planted: Sentinels rotate to the site, Vanguard holds it
  if (state.bomb.state === 'planted') {
    if (f.team === 'SEN') {
      setGoal(b, nearestWaypoint(wp, ctx.sites[state.bomb.site].x, ctx.sites[state.bomb.site].z));
      return 'defuse';
    }
    setGoal(b, nearestWaypoint(wp, ctx.sites[state.bomb.site].x, ctx.sites[state.bomb.site].z));
    return 'hold';
  }
  if (f.team === 'VAN') {
    // carrier plants; the others push the same site
    if (state.bomb.carrierId === f.id) {
      setGoal(b, nearestWaypoint(wp, ctx.sites[b.site].x, ctx.sites[b.site].z));
      return 'plant';
    }
    setGoal(b, nearestWaypoint(wp, ctx.sites[b.site].x, ctx.sites[b.site].z));
    return 'advance';
  }
  // Sentinel: hold near a site or mid, unless shots were heard nearby
  const heard = ctx.lastShot;
  if (heard && heard.team !== f.team && state.time - heard.t < 6) {
    const d = Math.hypot(heard.x - f.x, heard.z - f.z);
    if (d < HEAR_DIST) {
      setGoal(b, nearestWaypoint(wp, heard.x, heard.z));
      return 'rotate';
    }
  }
  if (b.holdWp < 0) {
    const siteWp = b.site === 'A' ? [6, 7, 15, 22] : [10, 11, 16, 23];
    b.holdWp = pick(rnd, siteWp);
  }
  setGoal(b, b.holdWp);
  return 'hold';
}
