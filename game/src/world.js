/**
 * world.js — the map "Yard 7": an industrial yard, 64 x 48 m, two lanes
 * (north to site A, south to site B) joined by a mid connector. Builds
 * the three.js meshes, the collision boxes, the spawns, the sites and the
 * waypoint graph the bots walk. All art is procedural geometry and canvas
 * textures; nothing is loaded from the network.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------- palette
const PAL = {
  ground: 0x3a3d42,
  groundLine: 0x8a8f96,
  wall: 0x9a8d76,
  wallTop: 0x6e6553,
  crate: 0x8a6a3f,
  crateDark: 0x6b4f2c,
  containerA: 0xb5501f, // rust orange
  containerB: 0x1f6b6b, // teal
  barrier: 0x5c6066,
  pipe: 0x4a4f55,
  siteA: 0xd8a020,
  siteB: 0x20a0d8,
  spawn: 0x3f6b3a,
};

export const MAP = { w: 64, d: 48, wallH: 4 };

export const SITES = {
  A: { x: -22, z: -14, r: 5 },
  B: { x: 22, z: 14, r: 5 },
};

export const SPAWNS = {
  VAN: [
    { x: -28, z: -4, yaw: 0 },
    { x: -28, z: 0, yaw: 0 },
    { x: -28, z: 4, yaw: 0 },
    { x: -26, z: -2, yaw: 0 },
  ],
  SEN: [
    { x: 28, z: -4, yaw: Math.PI },
    { x: 28, z: 0, yaw: Math.PI },
    { x: 28, z: 4, yaw: Math.PI },
    { x: 26, z: 2, yaw: Math.PI },
  ],
};

// Waypoint graph: nodes the bots walk, edges they may use. ids are indexes.
export const WAYPOINTS = [
  { x: -28, z: 0 }, // 0 VAN spawn
  { x: -20, z: 0 }, // 1 VAN yard
  { x: -12, z: -8 }, // 2 north fork
  { x: -12, z: 8 }, // 3 south fork
  { x: 0, z: -16 }, // 4 A long (east of the low wall's end, clear of it)
  { x: -13, z: -14 }, // 5 A long west (clear of the A crates)
  { x: -22, z: -14 }, // 6 site A
  { x: -22, z: -6 }, // 7 A entrance
  { x: -4, z: 16 }, // 8 B long
  { x: -14, z: 16 }, // 9 B long west
  { x: 22, z: 14 }, // 10 site B
  { x: 22, z: 6 }, // 11 B entrance
  { x: 0, z: 0 }, // 12 mid
  { x: 8, z: -8 }, // 13 mid north
  { x: 8, z: 8 }, // 14 mid south
  { x: 16, z: -12 }, // 15 SEN north
  { x: 16, z: 10 }, // 16 SEN south (south of the B low wall, not inside it)
  { x: 28, z: 0 }, // 17 SEN spawn
  { x: -6, z: -2 }, // 18 mid west pocket
  { x: 6, z: 2 }, // 19 mid east pocket
  { x: -24, z: -20 }, // 20 A corner
  { x: 24, z: 20 }, // 21 B corner
  { x: 0, z: -20 }, // 22 north mid
  { x: 0, z: 20 }, // 23 south mid
];

export const EDGES = [
  [0, 1], [1, 2], [1, 3], [2, 4], [4, 5], [5, 6], [6, 7], [7, 2],
  [3, 8], [8, 9], [9, 21], [9, 10], [10, 11],
  [12, 18], [12, 19], [12, 13], [12, 14],
  [13, 22], [22, 15], [14, 23], [14, 16],
  [13, 15], [18, 2], [19, 14], [13, 17], [14, 17], [3, 12],
  [7, 6], [11, 10], [20, 6], [21, 10], [22, 4], [23, 8],
];

function letterTexture(letter, color) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeRect(8, 8, 240, 240);
  g.fillStyle = color;
  g.font = 'bold 150px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 138);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

function asphaltTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#3a3d42';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // expansion joints
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 6);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Build the map into `scene`. Returns the collision boxes and the
 * waypoint graph. A collider is {minX, maxX, minZ, maxZ, top}.
 */
export function buildWorld(scene) {
  const colliders = [];
  const addBox = (x, z, w, d, h, mat, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = false;
    m.receiveShadow = false;
    scene.add(m);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h });
    return m;
  };

  const mat = (c, rough = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.05 });
  const mGround = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95, metalness: 0 });
  const mWall = mat(PAL.wall);
  const mWallTop = mat(PAL.wallTop);
  const mCrate = mat(PAL.crate, 0.85);
  const mCrateDark = mat(PAL.crateDark, 0.85);
  const mContA = mat(PAL.containerA, 0.6);
  const mContB = mat(PAL.containerB, 0.6);
  const mBarrier = mat(PAL.barrier, 0.7);
  const mPipe = mat(PAL.pipe, 0.4);

  // ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.w, MAP.d), mGround);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // sky + lights (dusk industrial yard)
  scene.background = new THREE.Color(0x232f3d);
  scene.fog = new THREE.Fog(0x232f3d, 45, 110);
  const hemi = new THREE.HemisphereLight(0xffc98a, 0x2a2620, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc184, 1.35);
  sun.position.set(-30, 26, -12);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x4a6a8a, 0.35);
  fill.position.set(25, 18, 20);
  scene.add(fill);

  // distant skyline: dark silhouettes beyond the walls so the sky is not a void
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x141c26 });
  const skyline = [
    [-52, -38, 10, 18], [-38, -44, 8, 26], [-22, -46, 12, 14], [-6, -48, 9, 30],
    [12, -46, 11, 20], [28, -44, 8, 15], [44, -38, 10, 24],
    [-52, 40, 9, 16], [-34, 46, 12, 22], [-14, 48, 8, 13], [6, 46, 10, 26],
    [26, 44, 9, 18], [44, 40, 11, 21],
    [-48, 0, 8, 20], [-50, 16, 10, 14], [50, -12, 9, 22], [48, 8, 12, 17],
  ];
  for (const [x, z, w, h] of skyline) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyMat);
    b.position.set(x, h / 2 - 0.5, z);
    scene.add(b);
  }
  // two tower cranes (mast + jib) on the skyline
  const craneMat = new THREE.MeshBasicMaterial({ color: 0x1a222e });
  for (const [x, z, ry] of [[-40, -34, 0.5], [36, 36, -0.7]]) {
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 34, 1.2), craneMat);
    mast.position.y = 17;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(16, 1, 1), craneMat);
    jib.position.set(6, 33, 0);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 1.4), craneMat);
    counter.position.set(-4, 32.4, 0);
    crane.add(mast, jib, counter);
    crane.position.set(x, 0, z);
    crane.rotation.y = ry;
    scene.add(crane);
  }

  // perimeter walls (hollow boxes so the inside faces read)
  addBox(0, -MAP.d / 2, MAP.w + 2, 1, MAP.wallH, mWall);
  addBox(0, MAP.d / 2, MAP.w + 2, 1, MAP.wallH, mWall);
  addBox(-MAP.w / 2, 0, 1, MAP.d, MAP.wallH, mWall);
  addBox(MAP.w / 2, 0, 1, MAP.d, MAP.wallH, mWall);
  // wall caps (visual trim, no extra colliders)
  for (const [x, z, w, d] of [[0, -24, 66, 1.4], [0, 24, 66, 1.4], [-32, 0, 1.4, 48], [32, 0, 1.4, 48]]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, d), mWallTop);
    cap.position.set(x, MAP.wallH + 0.12, z);
    scene.add(cap);
  }

  // --- mid connector walls (leave a 6 m double-door gap at x = 0)
  // mid connector wall, with a 6 m door gap at x -3..3 (posts frame it)
  addBox(-7.5, 0, 9, 1, 3.4, mWall);
  addBox(7.5, 0, 9, 1, 3.4, mWall);
  // door frame posts
  addBox(-3.2, 0, 0.8, 1.2, 3.8, mBarrier);
  addBox(3.2, 0, 0.8, 1.2, 3.8, mBarrier);

  // --- north lane (A long): low wall + crates
  addBox(-14, -12, 14, 1, 2.2, mWall);
  addBox(-24, -8, 1, 10, 2.2, mWall);
  addBox(-18, -17, 2, 2, 1.1, mCrate);
  addBox(-15.5, -17, 2, 2, 2.2, mCrateDark);
  addBox(-8, -19, 3, 2, 1.1, mCrate);
  // --- south lane (B long)
  addBox(14, 12, 14, 1, 2.2, mWall);
  addBox(24, 8, 1, 10, 2.2, mWall);
  addBox(18, 17, 2, 2, 1.1, mCrate);
  addBox(15.5, 17, 2, 2, 2.2, mCrateDark);
  addBox(8, 19, 3, 2, 1.1, mCrate);

  // --- containers (big cover)
  addBox(-20, 6, 6, 2.6, 2.6, mContA); // west container
  addBox(20, -6, 6, 2.6, 2.6, mContB); // east container
  addBox(2, -8, 2.6, 6, 2.6, mContB); // mid north container
  addBox(-2, 8, 2.6, 6, 2.6, mContA); // mid south container

  // --- site cover: crates + barriers at A and B
  addBox(-25, -10, 2, 2, 1.1, mCrate);
  addBox(-19, -18, 2, 2, 2.2, mCrateDark);
  addBox(-26, -17, 3, 1, 1.2, mBarrier);
  addBox(25, 10, 2, 2, 1.1, mCrate);
  addBox(19, 18, 2, 2, 2.2, mCrateDark);
  addBox(26, 17, 3, 1, 1.2, mBarrier);

  // --- pipes along the south wall + a barrel cluster
  for (const x of [-10, -6, -2, 2, 6, 10]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 10, 10), mPipe);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(x, 0.35, 22.5);
    scene.add(pipe);
  }
  const barrelMat = mat(0x7a3a1a, 0.6);
  for (const [x, z] of [[-10, 20], [-9, 20.6], [-10.6, 20.4], [12, -20], [12.8, -19.4]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12), barrelMat);
    b.position.set(x, 0.55, z);
    scene.add(b);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45, top: 1.1 });
  }

  // --- site floor decals (painted A / B)
  const decal = (site, letter, color) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: letterTexture(letter, color), transparent: true, opacity: 0.85 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(site.x, 0.02, site.z);
    scene.add(m);
  };
  decal(SITES.A, 'A', '#d8a020');
  decal(SITES.B, 'B', '#20a0d8');

  // --- spawn pads
  for (const [team, list] of Object.entries(SPAWNS)) {
    const col = team === 'VAN' ? '#3f6b3a' : '#3a5a6b';
    for (const s of list) {
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.6),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(s.x, 0.015, s.z);
      scene.add(pad);
    }
  }

  return { colliders, waypoints: WAYPOINTS, edges: EDGES };
}

/** Circle (x, z, r) vs AABB push-out. Returns corrected {x, z}. */
export function collideCircle(colliders, x, z, r) {
  let nx = x;
  let nz = z;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(nx, c.maxX));
    const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
    const dx = nx - cx;
    const dz = nz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r;
        nz = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration
        const pl = nx - c.minX + r;
        const pr = c.maxX - nx + r;
        const pt = nz - c.minZ + r;
        const pb = c.maxZ - nz + r;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) nx = c.minX - r;
        else if (m === pr) nx = c.maxX + r;
        else if (m === pt) nz = c.minZ - r;
        else nz = c.maxZ + r;
      }
    }
  }
  return { x: nx, z: nz };
}

/**
 * 3D segment (a -> b) blocked by any collider? Used for line of sight:
 * the segment is tested in 2D against each box, then the height at the
 * crossing must be below the box top to count as blocked.
 */
export function segmentBlocked(colliders, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const c of colliders) {
    if (c.top < 0.5) continue;
    // slab test in XZ
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, d, lo, hi] of [[a.x, dx, c.minX, c.maxX], [a.z, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) { ok = false; break; }
      } else {
        let ta = (lo - p) / d;
        let tb = (hi - p) / d;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (!ok) continue;
    const t = Math.max(0, t0);
    const y = a.y + (b.y - a.y) * t;
    if (y < c.top) return true;
  }
  return false;
}
