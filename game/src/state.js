/**
 * state.js — the single game state store. Every module reads and writes
 * this one object; nothing else holds round, team or fighter state.
 * Units are metres, angles radians, time seconds. Fixed step is 1/60 s.
 */

export const PHASE = {
  MENU: 'menu',
  FREEZE: 'freeze',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export const TEAM = { VAN: 'VAN', SEN: 'SEN' };

export const ROUND_TIME = 100; // seconds of live play per round
export const FREEZE_TIME = 6; // seconds of freeze/buy before the round
export const BOMB_TIME = 35; // seconds from plant to explosion
export const PLANT_TIME = 3; // seconds holding E to plant
export const DEFUSE_TIME = 5; // seconds holding E to defuse
export const WIN_ROUNDS = 5; // first team to this many rounds wins
export const MAX_ROUNDS = 9;

export const ECONOMY = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1900,
  plant: 300,
  defuse: 300,
};

/** Create a fresh match state. `seed` drives every random choice. */
export function createState(seed = 1337) {
  return {
    seed,
    phase: PHASE.MENU,
    phaseT: 0, // seconds left in the current phase
    round: 1,
    score: { VAN: 0, SEN: 0 },
    timer: 0, // live-round clock, counts down
    money: { VAN: 0, SEN: 0 }, // per-team bank shown in the buy menu (player's own below)
    fighters: [], // fighter objects, see combat.js for the shape
    playerId: 0,
    bomb: {
      state: 'idle', // idle | carried | planted | defused | exploded
      carrierId: 0, // VAN fighter carrying it while idle/carried
      site: null, // 'A' | 'B' while planted
      plantT: 0, // progress 0..1 while planting
      defuseT: 0, // progress 0..1 while defusing
      fuseT: 0, // seconds left once planted
      pos: null, // {x, z} while planted
    },
    feed: [], // kill feed entries {text, t}
    events: [], // timed announcements {text, t} for the banner
    winner: null, // 'VAN' | 'SEN' once the match ends
    roundWinner: null,
    roundReason: '',
    kills: { VAN: 0, SEN: 0 },
    time: 0, // total match clock, advances in fixed steps
    muted: false,
  };
}

/** Reset the per-round fields of a state for round `n`. */
export function resetRound(state, n) {
  state.round = n;
  state.phase = PHASE.FREEZE;
  state.phaseT = FREEZE_TIME;
  state.timer = ROUND_TIME;
  state.roundWinner = null;
  state.roundReason = '';
  state.bomb = {
    state: 'carried',
    carrierId: state.playerId,
    site: null,
    plantT: 0,
    defuseT: 0,
    fuseT: 0,
    pos: null,
  };
  for (const f of state.fighters) {
    f.hp = 100;
    f.alive = true;
    f.kills = 0;
    f.deaths = 0;
    f.planting = false;
    f.defusing = false;
  }
}
