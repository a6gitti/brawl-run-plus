// ============================================================================
// world.js — environment, recycled track segments, and object-pooled spawning
// for lanes, hazards, destructible crates and power cubes.
//
// Movement model: the player stays anchored near z = 0; everything on the
// track (segments, hazards, crates, cubes) moves toward +z at `gameSpeed`.
// ============================================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const LANE_X = [-2.5, 0, 2.5];
export const SPAWN_Z = -165;    // where new rows appear (hidden by fog)
export const KILL_Z = 14;       // recycled once past the camera

const SEG_LEN = 20;
const SEG_COUNT = 15;           // 300 units of track coverage

// ---------------------------------------------------------------------------
// Toon shading helpers
// ---------------------------------------------------------------------------

let _gradientMap = null;
export function toonGradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([70, 145, 215, 255]); // 4-step cel shading
  _gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  _gradientMap.minFilter = THREE.NearestFilter;
  _gradientMap.magFilter = THREE.NearestFilter;
  _gradientMap.needsUpdate = true;
  return _gradientMap;
}

export function toonMaterial(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradientMap(), ...opts });
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// Lightning-bolt silhouette for the Power Cube faces (2D shape, extruded)
const boltShape = new THREE.Shape();
boltShape.moveTo(0.1, 0.5);
boltShape.lineTo(-0.2, 0.02);
boltShape.lineTo(-0.04, 0.02);
boltShape.lineTo(-0.1, -0.5);
boltShape.lineTo(0.2, -0.02);
boltShape.lineTo(0.04, -0.02);
boltShape.closePath();

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export class World {
  constructor(scene) {
    this.scene = scene;
    this.crates = [];
    this.hazards = [];
    this.cubes = [];
    this.pools = {
      wall: [], hurdle: [], duckbar: [], crateWood: [], crateGold: [], cube: [],
    };
    this.distSinceSpawn = 0;
    this.nextGap = 8;

    this.buildEnvironment();
    this.buildTrack();
  }

  // -------------------------------------------------------------------------
  // Environment & lighting
  // -------------------------------------------------------------------------
  buildEnvironment() {
    const scene = this.scene;
    scene.background = new THREE.Color(0x7ad7ff);
    scene.fog = new THREE.Fog(0x8fdcff, 55, 160);

    const hemi = new THREE.HemisphereLight(0xcdeeff, 0x63c556, 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3d0, 2.4);
    sun.position.set(14, 26, 8);
    sun.castShadow = true;
    const shadowRes = (globalThis.innerWidth ?? 1920) < 720 ? 1024 : 2048; // lighter shadows on mobile
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 130;
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -80;
    sun.target.position.set(0, 0, -30);
    scene.add(sun, sun.target);
    this.sun = sun;
  }

  // -------------------------------------------------------------------------
  // Track: recycled segments with lane markings, curbs and roadside decor
  // -------------------------------------------------------------------------
  buildTrack() {
    this.segments = [];
    const buildingColors = [0xff8a5c, 0x5cc9ff, 0xffd23e, 0x9b59d0, 0xff5a8c, 0x4cd964];

    for (let i = 0; i < SEG_COUNT; i++) {
      const seg = new THREE.Group();
      seg.position.z = 20 - i * SEG_LEN - SEG_LEN / 2;

      // grass base
      const grass = new THREE.Mesh(
        new THREE.BoxGeometry(90, 0.3, SEG_LEN),
        toonMaterial(0x62d958)
      );
      grass.position.y = -0.35;
      grass.receiveShadow = true;
      seg.add(grass);

      // running track slab (alternating shade for a scrolling stripe effect)
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(8.4, 0.4, SEG_LEN),
        toonMaterial(i % 2 === 0 ? 0xb9c1d9 : 0xa9b2cc)
      );
      slab.position.y = -0.15;
      slab.receiveShadow = true;
      seg.add(slab);

      // lane divider dashes
      for (const lx of [-1.25, 1.25]) {
        for (let d = 0; d < 5; d++) {
          const dash = new THREE.Mesh(
            new THREE.BoxGeometry(0.16, 0.02, 1.6),
            toonMaterial(0xf4f7ff)
          );
          dash.position.set(lx, 0.06, -SEG_LEN / 2 + 2 + d * 4);
          seg.add(dash);
        }
      }

      // curbs
      for (const cx of [-4.35, 4.35]) {
        const curb = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.55, SEG_LEN),
          toonMaterial(i % 2 === 0 ? 0xff5a5f : 0xf4f7ff)
        );
        curb.position.set(cx, 0.05, 0);
        curb.castShadow = true;
        curb.receiveShadow = true;
        seg.add(curb);
      }

      // roadside decor
      for (const side of [-1, 1]) {
        if (Math.random() < 0.6) {
          // chunky low-poly building
          const h = rand(4, 11);
          const b = new THREE.Mesh(
            new THREE.BoxGeometry(rand(2.5, 4.5), h, rand(3, 6)),
            toonMaterial(pick(buildingColors))
          );
          b.position.set(side * rand(11, 18), h / 2 - 0.2, rand(-8, 8));
          b.castShadow = true;
          seg.add(b);
          // roof cap
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(b.geometry.parameters.width + 0.6, 0.7, b.geometry.parameters.depth + 0.6),
            toonMaterial(0xf4f7ff)
          );
          roof.position.copy(b.position);
          roof.position.y = h + 0.1;
          seg.add(roof);
        } else {
          // tree: cylinder trunk + cone foliage
          const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.18, 0.24, 1.1, 6),
            toonMaterial(0x8a5c3b)
          );
          trunk.position.set(side * rand(6.5, 9.5), 0.55, rand(-8, 8));
          seg.add(trunk);
          const top = new THREE.Mesh(
            new THREE.ConeGeometry(1.1, 2.2, 7),
            toonMaterial(pick([0x3fae4a, 0x57c95f, 0x2f9e44]))
          );
          top.position.set(trunk.position.x, 2.2, trunk.position.z);
          top.castShadow = true;
          seg.add(top);
        }
        if (Math.random() < 0.5) {
          // bush
          const bush = new THREE.Mesh(
            new THREE.SphereGeometry(rand(0.4, 0.8), 6, 5),
            toonMaterial(0x57c95f)
          );
          bush.position.set(side * rand(5.5, 10), 0.3, rand(-9, 9));
          seg.add(bush);
        }
      }

      this.scene.add(seg);
      this.segments.push(seg);
    }
  }

  // -------------------------------------------------------------------------
  // Pool helpers
  // -------------------------------------------------------------------------
  take(poolName, builder) {
    const pool = this.pools[poolName];
    const ent = pool.pop() ?? builder();
    ent.mesh.visible = true;
    return ent;
  }

  release(listName, ent, poolName) {
    ent.mesh.visible = false;
    this.pools[poolName].push(ent);
    const list = this[listName];
    const i = list.indexOf(ent);
    if (i !== -1) list.splice(i, 1);
  }

  // -------------------------------------------------------------------------
  // Builders (meshes are pooled and reused)
  // -------------------------------------------------------------------------
  buildWall() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.6, 0.8), toonMaterial(0xff6b4a));
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(1.94, 0.32, 0.84),
        toonMaterial(0xf4f7ff)
      );
      stripe.position.y = -0.7 + i * 0.75;
      g.add(stripe);
    }
    this.scene.add(g);
    return { mesh: g, kind: 'wall', halfW: 0.95, halfD: 0.5, top: 2.6 };
  }

  buildHurdle() {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.32, 0.3), toonMaterial(0xffe14d));
    bar.position.y = 0.64;
    bar.castShadow = true;
    g.add(bar);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.1, 0.34), toonMaterial(0x3a3f52));
    stripe.position.y = 0.64;
    g.add(stripe);
    for (const px of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.64, 0.14), toonMaterial(0x3a3f52));
      leg.position.set(px, 0.32, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    this.scene.add(g);
    return { mesh: g, kind: 'hurdle', halfW: 1.0, halfD: 0.3, top: 0.8 };
  }

  buildDuckBar() {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.35, 0.5), toonMaterial(0x35c7d8));
    bar.position.y = 1.52;
    bar.castShadow = true;
    g.add(bar);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.2), toonMaterial(0xf4f7ff));
    sign.position.set(0, 1.95, 0);
    g.add(sign);
    for (const px of [-4.0, 4.0]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.22), toonMaterial(0x3a3f52));
      post.position.set(px, 0.85, 0);
      post.castShadow = true;
      g.add(post);
    }
    this.scene.add(g);
    // duckbar spans the whole track; deadly unless the player ducks under 1.35
    return { mesh: g, kind: 'duckbar', halfW: 4.1, halfD: 0.35, bottom: 1.35 };
  }

  buildCrate(gold) {
    const size = 1.1;
    const color = gold ? 0xffc93e : 0xb5793a;
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), toonMaterial(color));
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    // frame edges for a chunky wooden look
    const frameColor = gold ? 0xa8741a : 0x7c4f22;
    for (const rot of [0, Math.PI / 2]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(size + 0.04, 0.12, size + 0.04), toonMaterial(frameColor));
      band.position.y = 0;
      band.rotation.z = rot;
      band.rotation.x = rot === 0 ? 0 : 0; // horizontal bands
      if (rot === Math.PI / 2) band.rotation.x = Math.PI / 2;
      g.add(band);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(size + 0.04, size + 0.04, 0.14), toonMaterial(frameColor));
    cross.rotation.y = Math.PI / 4;
    cross.scale.set(1, 1, 0.1);
    g.add(cross);
    if (gold) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), toonMaterial(0xfff3b0, { emissive: 0x7a5b00 }));
      gem.position.y = 0.62;
      g.add(gem);
    }
    this.scene.add(g);
    return {
      mesh: g, kind: gold ? 'crateGold' : 'crateWood', gold,
      hp: gold ? 6 : 3, halfW: 0.6, halfD: 0.6, top: 1.1,
    };
  }

  buildCube() {
    // chunky green rounded slab with a yellow voltage bolt + white shine,
    // matching the Power Cube icon
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(0.72, 0.72, 0.3, 3, 0.09),
      toonMaterial(0x2fd55c, { emissive: 0x0d8a36, emissiveIntensity: 0.55 })
    );
    body.castShadow = true;
    g.add(body);

    const boltGeo = new THREE.ExtrudeGeometry(boltShape, { depth: 0.05, bevelEnabled: false });
    boltGeo.translate(0, 0, -0.025); // center the extrusion
    for (const side of [1, -1]) { // bolt + shine on both big faces
      const bolt = new THREE.Mesh(boltGeo, toonMaterial(0xffe14d, { emissive: 0x9a7a00, emissiveIntensity: 0.6 }));
      bolt.scale.setScalar(0.62);
      bolt.position.set(0.015, -0.01, side * 0.16);
      if (side < 0) bolt.rotation.y = Math.PI;
      g.add(bolt);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), toonMaterial(0xffffff, { emissive: 0x555555 }));
      shine.scale.set(1, 1, 0.35);
      shine.position.set(-0.19, 0.16, side * 0.185);
      g.add(shine);
    }

    this.scene.add(g);
    return { mesh: g, phase: Math.random() * Math.PI * 2, baseY: 0.9 };
  }

  // -------------------------------------------------------------------------
  // Spawning API
  // -------------------------------------------------------------------------
  addWall(lane, z) {
    const e = this.take('wall', () => this.buildWall());
    e.mesh.position.set(LANE_X[lane], 1.3, z);
    this.hazards.push(e);
  }

  addHurdle(lane, z) {
    const e = this.take('hurdle', () => this.buildHurdle());
    e.mesh.position.set(LANE_X[lane], 0, z);
    this.hazards.push(e);
  }

  addDuckBar(z) {
    const e = this.take('duckbar', () => this.buildDuckBar());
    e.mesh.position.set(0, 0, z);
    this.hazards.push(e);
  }

  addCrate(lane, z, gold = false) {
    const e = this.take(gold ? 'crateGold' : 'crateWood', () => this.buildCrate(gold));
    e.mesh.position.set(LANE_X[lane] + rand(-0.35, 0.35), 0.55, z);
    e.mesh.rotation.y = rand(-0.3, 0.3);
    e.hp = gold ? 6 : 3;
    this.crates.push(e);
  }

  addCube(x, y, z) {
    const e = this.take('cube', () => this.buildCube());
    e.baseY = y;
    e.mesh.position.set(x, y, z);
    this.cubes.push(e);
  }

  dropCube(x, z) {
    this.addCube(x, 0.9, z + rand(-0.4, 0.4));
  }

  // One row of content at depth z. Patterns always leave at least one lane
  // survivable (via switching, jumping or ducking).
  spawnRow(z = SPAWN_Z + rand(-2, 2)) {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const roll = Math.random();

    if (roll < 0.14) {
      // wall(s) — must switch lanes
      this.addWall(lanes[0], z);
      if (Math.random() < 0.45) this.addWall(lanes[1], z + rand(-0.5, 0.5));
    } else if (roll < 0.28) {
      // hurdles across all lanes — jump!
      for (const l of lanes) this.addHurdle(l, z + rand(-0.4, 0.4));
      if (Math.random() < 0.5) this.addCube(LANE_X[lanes[0]], 1.7, z - 1.6);
    } else if (roll < 0.40) {
      // full-width duck bar — duck!
      this.addDuckBar(z);
    } else if (roll < 0.50) {
      // hurdle + wall mix
      this.addHurdle(lanes[0], z);
      this.addWall(lanes[1], z + rand(-0.5, 0.5));
    } else if (roll < 0.68) {
      // crate cluster (+ occasional reward cube on top)
      const gold = Math.random() < 0.25;
      this.addCrate(lanes[0], z, gold);
      if (Math.random() < 0.45) this.addCrate(lanes[0] === lanes[1] ? (lanes[1] + 1) % 3 : lanes[1], z + rand(-1.5, 1.5));
      if (Math.random() < 0.35) this.addCube(LANE_X[lanes[2]], 0.9, z);
    } else if (roll < 0.78) {
      // golden crate guarded by walls
      this.addCrate(lanes[0], z, true);
      this.addWall(lanes[1], z);
      this.addWall(lanes[2], z + rand(-0.6, 0.6));
    } else if (roll < 0.90) {
      // cube line
      for (let i = 0; i < 5; i++) this.addCube(LANE_X[lanes[0]], 0.9, z - i * 1.8);
      if (Math.random() < 0.4) this.addCrate(lanes[1], z + 2);
    } else {
      // cube arc over a hurdle — jump to collect
      this.addHurdle(lanes[0], z);
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        this.addCube(LANE_X[lanes[0]], 0.9 + Math.sin(t * Math.PI) * 1.1, z + 2.4 - i * 1.2);
      }
    }
  }

  prefill() {
    for (const z of [-40, -70, -100, -132]) this.spawnRow(z);
  }

  reset() {
    while (this.hazards.length) {
      const h = this.hazards[0];
      this.release('hazards', h, h.kind === 'duckbar' ? 'duckbar' : h.kind);
    }
    while (this.crates.length) {
      const c = this.crates[0];
      this.release('crates', c, c.gold ? 'crateGold' : 'crateWood');
    }
    while (this.cubes.length) this.release('cubes', this.cubes[0], 'cube');
    this.distSinceSpawn = 0;
    this.nextGap = 8;
    this.prefill();
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------
  update(dt, speed) {
    const dz = speed * dt;

    for (const seg of this.segments) {
      seg.position.z += dz;
      if (seg.position.z > 40) seg.position.z -= SEG_COUNT * SEG_LEN;
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.mesh.position.z += dz;
      if (h.mesh.position.z > KILL_Z) {
        this.release('hazards', h, h.kind === 'duckbar' ? 'duckbar' : h.kind);
      }
    }

    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.mesh.position.z += dz;
      if (c.mesh.position.z > KILL_Z) this.release('crates', c, c.gold ? 'crateGold' : 'crateWood');
    }

    const t = performance.now() / 1000;
    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const c = this.cubes[i];
      c.mesh.position.z += dz;
      c.mesh.position.y = c.baseY + Math.sin(t * 3.2 + c.phase) * 0.14;
      c.mesh.rotation.y += dt * 2.4;
      if (c.mesh.position.z > KILL_Z) this.release('cubes', c, 'cube');
    }

    // distance-based row spawning
    this.distSinceSpawn += dz;
    if (this.distSinceSpawn >= this.nextGap) {
      this.distSinceSpawn = 0;
      this.nextGap = rand(10, 16);
      this.spawnRow();
    }
  }
}
