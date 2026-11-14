/**
 * hud.js — the DOM overlay: crosshair with a spread-driven gap, health,
 * ammo, money, timer, scores, kill feed, hitmarker, damage vignette,
 * bomb status, round banner and the buy menu. All elements live in
 * index.html; this module only writes to them, once per frame at most.
 */
import { PHASE } from './state.js';
import { BUY_ORDER, WEAPONS } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  return {
    root: $('hud'),
    cross: $('crosshair'),
    crossDot: $('cross-dot'),
    health: $('health-fill'),
    healthNum: $('health-num'),
    ammoMag: $('ammo-mag'),
    ammoRes: $('ammo-res'),
    weaponName: $('weapon-name'),
    money: $('money'),
    timer: $('timer'),
    scoreVan: $('score-van'),
    scoreSen: $('score-sen'),
    aliveVan: $('alive-van'),
    aliveSen: $('alive-sen'),
    feed: $('feed'),
    hitmarker: $('hitmarker'),
    vignette: $('vignette'),
    bombStatus: $('bomb-status'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    menu: $('menu'),
    prompt: $('prompt'),
    plantBar: $('plant-bar'),
    plantFill: $('plant-fill'),
    hint: $('hint'),
    frag: $('frag-slot'),
  };
}

let lastFeedLen = 0;
let bannerT = 0;

export function showBanner(hud, title, sub = '', secs = 3) {
  hud.bannerTitle.textContent = title;
  hud.bannerSub.textContent = sub;
  hud.banner.classList.remove('hidden');
  bannerT = secs;
}

export function hideBanner(hud) {
  hud.banner.classList.add('hidden');
  bannerT = 0;
}

export function flashHitmarker(hud, headshot) {
  hud.hitmarker.classList.remove('hs');
  void hud.hitmarker.offsetWidth; // restart the animation
  if (headshot) hud.hitmarker.classList.add('hs');
  hud.hitmarker.classList.add('show');
  setTimeout(() => hud.hitmarker.classList.remove('show'), 140);
}

export function flashDamage(hud) {
  hud.vignette.classList.remove('show');
  void hud.vignette.offsetWidth;
  hud.vignette.classList.add('show');
  setTimeout(() => hud.vignette.classList.remove('show'), 320);
}

export function updateHud(hud, state, player, dt, freezeBanner = false) {
  const f = player;
  // crosshair gap grows with spread + movement
  const spread = f.weapon ? (f.weapon.bloom * 1.6 + (f.moving ? 4 : 0)) : 0;
  const gap = 7 + spread;
  hud.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);

  // health
  const hp = Math.max(0, Math.ceil(f.hp));
  hud.health.style.width = `${hp}%`;
  hud.healthNum.textContent = String(hp);
  hud.health.className = hp > 50 ? 'ok' : hp > 25 ? 'warn' : 'crit';

  // ammo + weapon
  const w = WEAPONS[f.weaponId];
  hud.weaponName.textContent = w.name;
  hud.ammoMag.textContent = f.weapon ? String(f.weapon.mag) : '–';
  hud.ammoRes.textContent = f.weapon ? String(f.weapon.reserve) : '–';
  hud.ammoMag.classList.toggle('low', !!f.weapon && f.weapon.mag <= 4);
  hud.frag.textContent = f.hasFrag ? 'FRAG [4]' : '';

  // money, timer, score
  hud.money.textContent = `$${f.money}`;
  const t = Math.max(0, Math.ceil(state.phase === PHASE.LIVE ? state.timer : state.phaseT));
  const mm = Math.floor(t / 60);
  const ss = String(t % 60).padStart(2, '0');
  hud.timer.textContent = state.phase === PHASE.LIVE ? `${mm}:${ss}` : state.phase === PHASE.FREEZE ? `BUY ${ss}` : '—';
  hud.timer.classList.toggle('danger', state.phase === PHASE.LIVE && state.timer < 15);
  hud.scoreVan.textContent = String(state.score.VAN);
  hud.scoreSen.textContent = String(state.score.SEN);
  hud.aliveVan.textContent = String(state.fighters.filter((x) => x.team === 'VAN' && x.alive).length);
  hud.aliveSen.textContent = String(state.fighters.filter((x) => x.team === 'SEN' && x.alive).length);

  // bomb status
  const b = state.bomb;
  if (b.state === 'planted') {
    hud.bombStatus.textContent = `BOMB PLANTED — ${b.site} — ${Math.max(0, b.fuseT).toFixed(0)}s`;
    hud.bombStatus.className = 'planted';
  } else if (b.state === 'carried') {
    hud.bombStatus.textContent = b.carrierId === f.id ? 'YOU CARRY THE BOMB — plant at A or B [E]' : 'BOMB WITH YOUR TEAM';
    hud.bombStatus.className = 'carried';
  } else {
    hud.bombStatus.textContent = '';
    hud.bombStatus.className = '';
  }

  // plant / defuse progress bar
  const prog = f.planting ? b.plantT / 3 : f.defusing ? b.defuseT / 5 : 0;
  if (prog > 0) {
    hud.plantBar.classList.remove('hidden');
    hud.plantFill.style.width = `${Math.round(prog * 100)}%`;
    hud.plantFill.textContent = f.planting ? 'PLANTING…' : 'DEFUSING…';
  } else {
    hud.plantBar.classList.add('hidden');
  }

  // kill feed (only re-render when it changed)
  if (state.feed.length !== lastFeedLen) {
    lastFeedLen = state.feed.length;
    hud.feed.innerHTML = state.feed.slice(0, 5).map((e) => `<div>${e.text}</div>`).join('');
  }

  // banner countdown (frozen in screenshot presets so the scene holds)
  if (bannerT > 0 && !freezeBanner) {
    bannerT -= dt;
    if (bannerT <= 0) hideBanner(hud);
  }

  // prompts
  if (state.phase === PHASE.MENU) {
    hud.prompt.textContent = 'CLICK TO PLAY';
    hud.prompt.classList.remove('hidden');
  } else if (state.phase === PHASE.LIVE && !f.alive) {
    hud.prompt.textContent = 'YOU ARE DOWN — spectating your team';
    hud.prompt.classList.remove('hidden');
  } else {
    hud.prompt.classList.add('hidden');
  }
  hud.menu.classList.toggle('hidden', state.phase !== PHASE.MENU);
}

export function renderBuyMenu(hud, state, player) {
  const items = BUY_ORDER.map((id, i) => {
    const w = WEAPONS[id];
    const afford = player.money >= w.price;
    const owned = id === 'FRAG' ? !!player.hasFrag : player.weaponId === id;
    return `<div class="buy-item ${afford ? '' : 'cant'} ${owned ? 'owned' : ''}">
      <span class="buy-key">[${i + 1}]</span> ${w.name}
      <span class="buy-price">${owned ? 'OWNED' : '$' + w.price}</span>
      <span class="buy-desc">${w.kind === 'grenade' ? 'blast 85 dmg, 6 m radius' : w.kind === 'rifle' ? '40 dmg · 25 rnd · accurate' : '26 dmg · 28 rnd · fast'}</span>
    </div>`;
  }).join('');
  hud.buyItems.innerHTML = items + `<div class="buy-foot">Money $${player.money} — press 1–3 to buy, B to close</div>`;
}

export function setBuyVisible(hud, show) {
  hud.buyMenu.classList.toggle('hidden', !show);
}
