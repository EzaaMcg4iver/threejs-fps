/**
 * bomb.js — the objective. The Vanguard carrier plants at A or B by
 * holding E for PLANT_TIME inside the site circle; a Sentinel defuses
 * by holding E for DEFUSE_TIME at the planted bomb. Planting pays, the
 * fuse is 35 s, and a detonation wins the round for Vanguard.
 */
import { BOMB_TIME, DEFUSE_TIME, PLANT_TIME } from './state.js';
import { ECONOMY } from './state.js';
import { SITES } from './world.js';

/** Is fighter `f` standing inside bombsite `site`? */
export function inSite(f, site) {
  const s = SITES[site];
  return Math.hypot(f.x - s.x, f.z - s.z) <= s.r;
}

/** Which site is `f` standing in, or null. */
export function siteAt(f) {
  for (const name of ['A', 'B']) if (inSite(f, name)) return name;
  return null;
}

/**
 * Step planting for one fighter holding E. Returns 'planted' when the
 * plant completes, 'planting' while in progress, null when not planting.
 */
export function stepPlant(state, f, holdingE, dt) {
  const bomb = state.bomb;
  if (bomb.state !== 'carried' || bomb.carrierId !== f.id) {
    f.planting = false;
    return null;
  }
  const site = siteAt(f);
  if (holdingE && site && state.phase === 'live') {
    f.planting = true;
    bomb.plantT += dt;
    if (bomb.plantT >= PLANT_TIME) {
      bomb.state = 'planted';
      bomb.site = site;
      bomb.fuseT = BOMB_TIME;
      bomb.pos = { x: f.x, z: f.z };
      bomb.plantT = 0;
      f.money += ECONOMY.plant;
      f.planting = false;
      return 'planted';
    }
    return 'planting';
  }
  f.planting = false;
  bomb.plantT = Math.max(0, bomb.plantT - dt * 2);
  return null;
}

/**
 * Step defusing for one fighter holding E at the planted bomb.
 * Returns 'defused' on completion, 'defusing' while in progress.
 */
export function stepDefuse(state, f, holdingE, dt) {
  const bomb = state.bomb;
  if (bomb.state !== 'planted' || !bomb.pos) {
    f.defusing = false;
    return null;
  }
  const near = Math.hypot(f.x - bomb.pos.x, f.z - bomb.pos.z) <= 2.5;
  if (holdingE && near && state.phase === 'live') {
    f.defusing = true;
    bomb.defuseT += dt;
    if (bomb.defuseT >= DEFUSE_TIME) {
      bomb.state = 'defused';
      bomb.defuseT = 0;
      f.money += ECONOMY.defuse;
      f.defusing = false;
      return 'defused';
    }
    return 'defusing';
  }
  f.defusing = false;
  bomb.defuseT = Math.max(0, bomb.defuseT - dt * 2);
  return null;
}
