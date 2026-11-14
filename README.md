# BREACHLINE — round-based tactical FPS

A three.js tactical FPS on "Yard 7", an industrial yard with two lanes
and two bombsites. Vanguard (you + 3 bots) attacks; Sentinel (4 bots)
defends. First to 5 rounds wins the match.

## How to play

Open `game/index.html` in a browser (serve the `game/` folder over HTTP
— ES modules do not load from `file://`). Click to play: the mouse looks,
click shoots, pointer lock captures the mouse.

- **WASD** move · **Shift** sprint · **Ctrl** crouch · **R** reload
- **E** plant the bomb (Vanguard, inside site A or B) / defuse it (Sentinel)
- **B** buy menu during freeze time · **1–3** buy a weapon · **M** mute
- **Esc** releases the mouse

## The game

- **Rounds:** 6 s freeze/buy, 100 s live. A round ends by elimination,
  bomb detonation, defusal, or timeout (no plant = defenders win).
- **Money:** start $800, kill +$300, round win +$3250, loss +$1900,
  plant +$300, defuse +$300. Buy the Kestrel AR ($2700), Hornet SMG
  ($1500) or a Frag grenade ($300) between rounds.
- **Gunplay:** hitscan with spread that grows while moving and firing,
  recoil that kicks the view and recovers, headshots deal 3× damage.
  Firing on the move punishes accuracy; crouching steadies the aim.
- **Bots:** waypoint navigation, vision cone + line of sight, hearing
  (gunshots pull defenders toward the action), burst fire with reaction
  time, and objective play — Vanguard pushes a site and plants, Sentinel
  holds and rotates to a planted bomb.
- **Sound:** every effect is synthesized with WebAudio — no audio files.

## Screenshots

`?shot=start` freeze/buy phase at the Vanguard spawn, `?shot=mid`
a live firefight on the north lane, `?shot=plant` a bomb planted at A
with a defuse in progress, `?shot=end` a round won. `?seed=N` changes
the bot seed.

## Build

`main.ts` (Node 22, standard library only) copies `game/` and
`screenshots/` to the output directory and writes `dossier.json` with
`buildDossier` from `vendor/makefun-threejs.ts`:

```
MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts
```

Deterministic: the same repository writes the same bytes every run.
