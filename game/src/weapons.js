/**
 * weapons.js — weapon definitions and the firing model. Hits are hitscan:
 * spread grows while moving and while firing, recoil kicks the aim up and
 * recovers, headshots multiply damage. All numbers are per weapon so the
 * buy menu can price them and the judge can read the trade-offs.
 */
import { clamp } from './rng.js';

export const WEAPONS = {
  P9: {
    id: 'P9', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 34, headMult: 3, rof: 420, // rounds per minute
    mag: 12, reserve: 36, reload: 1.4,
    spread: 0.011, moveSpread: 0.02, recoil: 0.011, range: 60,
    auto: false, tracer: 0xffe08a,
  },
  HORNET: {
    id: 'HORNET', name: 'Hornet SMG', kind: 'smg', price: 1500,
    damage: 26, headMult: 3, rof: 750,
    mag: 28, reserve: 84, reload: 1.9,
    spread: 0.016, moveSpread: 0.026, recoil: 0.008, range: 55,
    auto: true, tracer: 0xffd34d,
  },
  KESTREL: {
    id: 'KESTREL', name: 'Kestrel AR', kind: 'rifle', price: 2700,
    damage: 40, headMult: 3, rof: 600,
    mag: 25, reserve: 75, reload: 2.3,
    spread: 0.008, moveSpread: 0.02, recoil: 0.014, range: 80,
    auto: true, tracer: 0xfff2b0,
  },
  FRAG: {
    id: 'FRAG', name: 'Frag Grenade', kind: 'grenade', price: 300,
    damage: 85, headMult: 1, rof: 60,
    mag: 1, reserve: 0, reload: 0,
    spread: 0, moveSpread: 0, recoil: 0, range: 0,
    auto: false, tracer: 0xffffff, blast: 6, // metres, falls off with distance
  },
};

export const BUY_ORDER = ['KESTREL', 'HORNET', 'FRAG'];

/** Fresh weapon state for a fighter holding `weaponId`. */
export function arm(weaponId) {
  const w = WEAPONS[weaponId];
  return {
    id: w.id,
    mag: w.mag,
    reserve: w.reserve,
    cooldown: 0, // seconds until the next shot may fire
    reloading: 0, // seconds left reloading, 0 when not
    bloom: 0, // accumulated spread from firing
    recoilP: 0, // pitch kick waiting to recover (radians)
  };
}

/** Current spread (radians) for a shot: base + movement + bloom.
 * `def` is the weapon definition (spread/moveSpread); `w` is the live
 * weapon state, which is where bloom lives — the def has no bloom. */
export function currentSpread(def, w, moving, crouched) {
  let s = def.spread + (moving ? def.moveSpread : 0) + def.spread * 2.5 * (w?.bloom ?? 0);
  if (crouched) s *= 0.65;
  return s;
}

/** Apply one shot's recoil + bloom to the weapon state. */
export function applyShot(w, def) {
  w.mag -= 1;
  w.cooldown = 60 / def.rof;
  w.bloom = clamp((w.bloom ?? 0) + 1, 0, 6);
  w.recoilP = (w.recoilP ?? 0) + def.recoil;
}

/** Step a weapon's timers; returns true when a reload just finished. */
export function stepWeapon(w, def, dt) {
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.bloom > 0) w.bloom = Math.max(0, w.bloom - dt * 2.2);
  if (w.recoilP > 0) w.recoilP = Math.max(0, w.recoilP - dt * 0.09);
  if (w.reloading > 0) {
    w.reloading -= dt;
    if (w.reloading <= 0) {
      const need = def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloading = 0;
      return true;
    }
  }
  return false;
}

export function startReload(w, def) {
  if (w.reloading > 0 || w.mag >= def.mag || w.reserve <= 0) return false;
  w.reloading = def.reload;
  return true;
}
