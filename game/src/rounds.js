/**
 * rounds.js — the round state machine and the economy. A round is:
 * freeze (buy) -> live -> round end (elimination, bomb, or timeout) ->
 * freeze again. First to WIN_ROUNDS takes the match. Money is per
 * fighter: kills pay, wins pay more than losses, planting pays.
 */
import { ECONOMY, FREEZE_TIME, MAX_ROUNDS, PHASE, ROUND_TIME, WIN_ROUNDS, resetRound } from './state.js';
import { WEAPONS, arm } from './weapons.js';

/** Start a fresh match: reset scores, money and round 1. */
export function startMatch(state) {
  state.score = { VAN: 0, SEN: 0 };
  state.kills = { VAN: 0, SEN: 0 };
  state.winner = null;
  for (const f of state.fighters) {
    f.money = ECONOMY.start;
    f.weaponId = 'P9';
    f.weapon = arm('P9');
  }
  resetRound(state, 1);
  state.events.unshift({ text: 'Match started — first to ' + WIN_ROUNDS + ' rounds', t: state.time });
}

/** Buy `weaponId` for fighter `f` during freeze. Returns true on success. */
export function buyWeapon(state, f, weaponId) {
  const def = WEAPONS[weaponId];
  if (!def || state.phase !== PHASE.FREEZE) return false;
  if (f.money < def.price) return false;
  if (weaponId === 'FRAG') {
    if (f.hasFrag) return false;
    f.money -= def.price;
    f.hasFrag = true;
    return true;
  }
  f.money -= def.price;
  f.weaponId = weaponId;
  f.weapon = arm(weaponId);
  return true;
}

/** Step the round clock. Returns an event string when the phase changes. */
export function stepRounds(state, dt) {
  if (state.phase === PHASE.FREEZE) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseT = 0;
      state.timer = ROUND_TIME;
      return 'live';
    }
    return null;
  }
  if (state.phase === PHASE.LIVE) {
    state.timer -= dt;
    if (state.bomb.state === 'planted') {
      state.bomb.fuseT -= dt;
      if (state.bomb.fuseT <= 0) return 'bombExploded';
    }
    if (state.timer <= 0) return 'timeExpired';
    const vanAlive = state.fighters.some((f) => f.team === 'VAN' && f.alive);
    const senAlive = state.fighters.some((f) => f.team === 'SEN' && f.alive);
    if (!vanAlive) return 'eliminated:SEN';
    if (!senAlive) return 'eliminated:VAN';
    return null;
  }
  if (state.phase === PHASE.ROUND_END) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      if (state.winner) return 'matchOver';
      const next = state.round + 1;
      if (next > MAX_ROUNDS) {
        state.winner = state.score.VAN > state.score.SEN ? 'VAN' : 'SEN';
        state.phase = PHASE.MATCH_END;
        return 'matchOver';
      }
      resetRound(state, next);
      return 'nextRound';
    }
    return null;
  }
  return null;
}

/** Settle a round: pay the teams, record the score, open round-end. */
export function endRound(state, winner, reason) {
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner] += 1;
  for (const f of state.fighters) {
    f.money += f.team === winner ? ECONOMY.win : ECONOMY.loss;
  }
  state.phase = PHASE.ROUND_END;
  state.phaseT = 4;
  state.events.unshift({ text: reason, t: state.time });
  if (state.score[winner] >= WIN_ROUNDS) {
    state.winner = winner;
    state.phase = PHASE.MATCH_END;
  }
}

/** Timeout with no plant: the defenders hold the yard. */
export function timeoutWinner(state) {
  return state.bomb.state === 'planted' ? 'VAN' : 'SEN';
}
