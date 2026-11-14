/**
 * player.js — the first-person controller: WASD relative to yaw, sprint
 * and crouch, mouse look with recoil kick and recovery, view bob, and
 * firing input (semi-auto pistols fire on click, autos while held).
 * Movement is acceleration-based: sprinting and firing on the move both
 * cost accuracy, so positioning matters.
 */
import { collideCircle } from './world.js';
import { fireShot } from './combat.js';
import { startReload, stepWeapon, WEAPONS } from './weapons.js';
import { clamp } from './rng.js';

const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.7;
const CROUCH_SPEED = 2.3;
const ACCEL = 34;
const MOUSE_SENS = 0.0023;

export function stepPlayer(state, player, input, ctx, dt) {
  const f = player;
  if (!f.alive) return;

  // --- look
  const { dx, dy } = input.consumeMouse();
  f.yaw -= dx * MOUSE_SENS;
  f.pitch = clamp(f.pitch - dy * MOUSE_SENS, -1.45, 1.45);
  // recoil is a transient camera offset (recoilP), decayed in stepWeapon
  // and applied to the camera in main.js — the aim itself never drifts.

  // --- move
  const fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
  const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  f.crouched = input.isDown('ControlLeft') || input.isDown('KeyC');
  const sprinting = input.isDown('ShiftLeft') && fwd > 0 && !f.crouched;
  const targetSpeed = f.crouched ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
  const sin = Math.sin(f.yaw);
  const cos = Math.cos(f.yaw);
  // forward is (cos, -sin) in XZ; right is (sin, cos)
  let mx = (cos * fwd + sin * strafe);
  let mz = (-sin * fwd + cos * strafe);
  const mlen = Math.hypot(mx, mz);
  if (mlen > 1) { mx /= mlen; mz /= mlen; }
  f.vx += (mx * targetSpeed - f.vx) * Math.min(1, ACCEL * dt / targetSpeed * 8);
  f.vz += (mz * targetSpeed - f.vz) * Math.min(1, ACCEL * dt / targetSpeed * 8);
  const nx = f.x + f.vx * dt;
  const nz = f.z + f.vz * dt;
  const c = collideCircle(ctx.colliders, nx, nz, 0.42);
  // stop the axis that hit a wall (slide along it)
  if (Math.abs(c.x - nx) > 0.001) f.vx = 0;
  if (Math.abs(c.z - nz) > 0.001) f.vz = 0;
  f.x = c.x;
  f.z = c.z;
  f.speed = Math.hypot(f.vx, f.vz);
  f.moving = f.speed > 0.4;

  // --- weapon timers + reload
  const def = WEAPONS[f.weaponId];
  if (stepWeapon(f.weapon, def, dt)) ctx.audio.reloadDone?.();
  if (input.isDown('KeyR')) {
    if (startReload(f.weapon, def)) ctx.audio.reload();
  }

  // --- fire
  const wantFire = def.auto ? input.mouseDown : input.mouseDown && !f._fired;
  if (wantFire && state.phase === 'live') {
    const fired = ctx.shoot(f);
    if (!fired && f.weapon.mag === 0) ctx.audio.dryFire();
  }
  f._fired = input.mouseDown;

  // --- view bob (visual only, driven by speed)
  f.bobPhase = (f.bobPhase ?? 0) + dt * f.speed * 1.6;
  f.bobAmp = clamp(f.speed / WALK_SPEED, 0, 1) * (f.crouched ? 0.4 : 1);
}

/** Where the player's view is, with bob applied. */
export function playerEyePos(f, time) {
  const bobY = Math.sin((f.bobPhase ?? 0) * 2) * 0.025 * (f.bobAmp ?? 0);
  const bobX = Math.cos(f.bobPhase ?? 0) * 0.015 * (f.bobAmp ?? 0);
  const eyeY = f.crouched ? 1.12 : 1.62;
  return {
    x: f.x + Math.sin(f.yaw) * bobX,
    y: eyeY + bobY,
    z: f.z + Math.cos(f.yaw) * bobX,
  };
}
