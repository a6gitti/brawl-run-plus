// ============================================================================
// combat.js — projectile pools & fire modes, swept-AABB collisions,
// explosions / split bursts, particles, and player-impact checks.
// ============================================================================

import * as THREE from 'three';
import { toonMaterial } from './world.js';

const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Projectile mesh builders (pooled per kind)
// ---------------------------------------------------------------------------
function buildProjectile(kind) {
  let mesh;
  switch (kind) {
    case 'pellet': {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), toonMaterial(0xb388ff));
      break;
    }
    case 'bullet': {
      mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 3, 6), toonMaterial(0xffd23e));
      mesh.rotation.x = Math.PI / 2; // capsule aligned along z
      break;
    }
    case 'rocket': {
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.55, 3, 8), toonMaterial(0xff5a3c));
      body.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 8), toonMaterial(0xffd23e));
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -0.55;
      mesh.add(body, nose);
      break;
    }
    case 'wave': {
      // ground shockwave: flat expanding ring + soft translucent core
      mesh = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.2, 8, 22),
        toonMaterial(0xffa53c, { transparent: true, opacity: 0.7 })
      );
      ring.rotation.x = Math.PI / 2; // ring lies flat in the XZ plane
      mesh.add(ring);
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 10, 8),
        toonMaterial(0xffd23e, { transparent: true, opacity: 0.3 })
      );
      core.scale.set(1, 0.3, 1.4);
      mesh.add(core);
      break;
    }
    case 'orb': {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), toonMaterial(0x6ff05a, { emissive: 0x1d8f2a }));
      break;
    }
    case 'spike': {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), toonMaterial(0xd6ff4d, { emissive: 0x4a6b00 }));
      break;
    }
  }
  mesh.visible = false;
  return mesh;
}

function buildParticle() {
  const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.14), toonMaterial(0xffffff));
  mesh.visible = false;
  return mesh;
}

// trail tint per projectile kind
const TRAIL_COLORS = {
  pellet: 0xb388ff,
  bullet: 0xffd23e,
  rocket: 0xffa53c,
  wave: 0xffa53c,
  orb: 0x6ff05a,
  spike: 0xd6ff4d,
};

// ---------------------------------------------------------------------------
// Combat system
// ---------------------------------------------------------------------------
export class Combat {
  constructor(scene, world, hooks) {
    this.scene = scene;
    this.world = world;
    this.hooks = hooks; // { addScore(points), shake(amp) }
    this.projectiles = [];
    this.particles = [];
    this.pools = { pellet: [], bullet: [], rocket: [], wave: [], orb: [], spike: [], particle: [] };
    this.cooldown = 0;
    this.cooldownMax = 1;
    // reusable muzzle-flash light (intensity decays to 0 each frame)
    this.flashLight = new THREE.PointLight(0xffe08a, 0, 9, 2);
    scene.add(this.flashLight);
  }

  // -------------------------------------------------------------------------
  // Fire modes
  // -------------------------------------------------------------------------
  tryFire(brawler, playerX, damageMult) {
    if (this.cooldown > 0) return false;
    const f = brawler.fire;
    this.cooldown = f.cooldown;
    this.cooldownMax = f.cooldown;
    this.spawnByType(f, brawler.colors.accent, playerX, damageMult);
    return true;
  }

  spawnProjectile(kind, opts) {
    const pool = this.pools[kind];
    const mesh = pool.pop() ?? buildProjectile(kind);
    mesh.visible = true;
    mesh.position.set(opts.x, opts.y, opts.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, kind,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      vz: opts.vz,
      damage: opts.damage,
      radius: opts.radius,
      range: opts.range,
      travelled: 0,
      pierce: opts.pierce ?? 0,
      hitSet: new Set(),
    });
  }

  spawnByType(f, accent, playerX, dmgMult) {
    const z0 = 0.6, y0 = 1.1;
    switch (f.type) {
      case 'spread': {
        const n = f.pellets;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5 .. +0.5
          this.spawnProjectile('pellet', {
            x: playerX + t * 0.4, y: y0, z: z0,
            vx: t * f.spreadX, vz: -f.speed,
            damage: f.damage * dmgMult, radius: f.radius, range: f.range,
          });
        }
        break;
      }
      case 'stream': {
        for (let i = 0; i < f.bullets; i++) {
          this.spawnProjectile('bullet', {
            x: playerX, y: y0, z: z0 - i * f.spacing,
            vz: -f.speed,
            damage: f.damage * dmgMult, radius: f.radius, range: f.range,
          });
        }
        break;
      }
      case 'rocket': {
        this.spawnProjectile('rocket', {
          x: playerX, y: y0, z: z0,
          vz: -f.speed,
          damage: f.damage * dmgMult, radius: f.radius, range: f.range,
        });
        break;
      }
      case 'wave': {
        this.spawnProjectile('wave', {
          x: playerX, y: 0.45, z: z0,
          vz: -f.speed,
          damage: f.damage * dmgMult, radius: f.radius, range: f.range,
          pierce: f.pierce,
        });
        break;
      }
      case 'orb': {
        this.spawnProjectile('orb', {
          x: playerX, y: y0, z: z0,
          vz: -f.speed,
          damage: f.damage * dmgMult, radius: f.radius, range: f.range,
        });
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Particles / effects
  // -------------------------------------------------------------------------
  spawnParticle(x, y, z, color, vx, vy, vz, life = 0.5) {
    const mesh = this.pools.particle.pop() ?? buildParticle();
    mesh.visible = true;
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.particles.push({ mesh, color, vx, vy, vz, life, maxLife: life });
  }

  flash(x, y, z, color = 0xffe08a, strength = 16) {
    this.flashLight.position.set(x, y, z);
    this.flashLight.color.setHex(color);
    this.flashLight.intensity = strength;
  }

  burst(x, y, z, color, count = 10, spread = 5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(spread * 0.4, spread);
      this.spawnParticle(
        x, y, z, color,
        Math.cos(a) * s * rand(0.3, 1),
        rand(2, spread),
        Math.sin(a) * s * rand(0.3, 1),
        rand(0.35, 0.7)
      );
    }
  }

  explode(x, y, z, radius, damage, color = 0xffa53c) {
    this.burst(x, y, z, color, 16, 7);
    this.hooks.shake(0.5);
    for (const crate of [...this.world.crates]) {
      if (
        Math.abs(crate.mesh.position.x - x) <= radius &&
        Math.abs(crate.mesh.position.z - z) <= radius
      ) {
        this.damageCrate(crate, damage, crate.mesh.position);
      }
    }
  }

  splitOrb(x, y, z, f, dmgMult) {
    const b = f.burst;
    for (let i = 0; i < b.spikes; i++) {
      const a = (i / b.spikes) * Math.PI * 2;
      this.spawnProjectile('spike', {
        x, y, z,
        vx: Math.sin(a) * b.speed,
        vz: -Math.cos(a) * b.speed,
        damage: b.damage * dmgMult, radius: b.radius, range: b.range,
      });
    }
    this.burst(x, y, z, 0x6ff05a, 8, 4);
  }

  // -------------------------------------------------------------------------
  // Damage application
  // -------------------------------------------------------------------------
  damageCrate(crate, dmg, at) {
    crate.hp -= dmg;
    // hit pulse
    crate.mesh.scale.setScalar(1.18);
    if (crate.hp <= 0) {
      const p = crate.mesh.position;
      this.burst(p.x, p.y, p.z, crate.gold ? 0xffc93e : 0xb5793a, crate.gold ? 14 : 9, 5);
      this.hooks.addScore(crate.gold ? 100 : 25);
      const drops = crate.gold ? 2 : 1;
      for (let i = 0; i < drops; i++) this.world.dropCube(p.x + rand(-0.3, 0.3), p.z);
      this.world.release('crates', crate, crate.gold ? 'crateGold' : 'crateWood');
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame update: movement, swept collisions, particles
  // -------------------------------------------------------------------------
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flashLight.intensity *= Math.exp(-dt * 14); // muzzle flash decay

    const world = this.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const mesh = p.mesh;
      const prevZ = mesh.position.z;
      mesh.position.x += p.vx * dt;
      mesh.position.z += p.vz * dt;
      p.travelled += Math.abs(p.vz) * dt;

      // spin / wobble for flair
      if (p.kind === 'wave') {
        // grow as it travels so it reads as an expanding shockwave
        const t = Math.min(p.travelled / p.range, 1);
        mesh.scale.setScalar(0.8 + t * 1.0);
      } else if (p.kind === 'orb') mesh.scale.setScalar(1 + Math.sin(p.travelled * 8) * 0.15);
      else if (p.kind === 'spike') mesh.rotation.y += dt * 10;

      // glowing trail
      p.trailT = (p.trailT ?? 0) + dt;
      if (p.trailT > 0.045) {
        p.trailT = 0;
        this.spawnParticle(
          mesh.position.x, mesh.position.y, mesh.position.z, TRAIL_COLORS[p.kind] ?? 0xffffff,
          rand(-0.4, 0.4), rand(0.2, 0.8), rand(0.5, 1.5),
          0.22
        );
      }

      let dead = p.travelled > p.range || mesh.position.z < -175;

      if (!dead) {
        // --- vs destructible crates ---
        for (let ci = world.crates.length - 1; ci >= 0; ci--) {
          const crate = world.crates[ci];
          if (p.hitSet.has(crate)) continue;
          const cp = crate.mesh.position;
          const zOverlap =
            Math.min(prevZ, mesh.position.z) - p.radius <= cp.z + crate.halfD &&
            Math.max(prevZ, mesh.position.z) + p.radius >= cp.z - crate.halfD;
          const xOverlap = Math.abs(mesh.position.x - cp.x) <= crate.halfW + p.radius;
          if (!zOverlap || !xOverlap) continue;
          if (mesh.position.y - p.radius > crate.top) continue; // flew over it

          if (p.kind === 'orb') {
            this.damageCrate(crate, p.damage, cp);
            this.splitOrb(mesh.position.x, mesh.position.y, cp.z, ORB_REF, ORB_MULT);
            dead = true;
            break;
          }
          this.damageCrate(crate, p.damage, cp);
          this.burst(mesh.position.x, mesh.position.y, cp.z, 0xffe14d, 3, 3);
          if (p.pierce > 0) {
            p.pierce--;
            p.hitSet.add(crate);
          } else {
            dead = true;
            break;
          }
        }
      }

      if (!dead) {
        // --- unbreakable walls absorb projectiles ---
        for (const h of world.hazards) {
          if (h.kind !== 'wall') continue;
          const hp = h.mesh.position;
          const zOverlap =
            Math.min(prevZ, mesh.position.z) - p.radius <= hp.z + h.halfD &&
            Math.max(prevZ, mesh.position.z) + p.radius >= hp.z - h.halfD;
          const xOverlap = Math.abs(mesh.position.x - hp.x) <= h.halfW + p.radius;
          if (!zOverlap || !xOverlap) continue;
          if (mesh.position.y - p.radius > h.top) continue;

          if (p.kind === 'orb') {
            this.splitOrb(mesh.position.x, mesh.position.y, hp.z, ORB_REF, ORB_MULT);
          }
          this.burst(mesh.position.x, mesh.position.y, hp.z + h.halfD, 0xffb4a2, 4, 3);
          dead = true;
          break;
        }
      }

      if (dead) {
        this.killProjectile(i, p);
      }
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.mesh.visible = false;
        this.pools.particle.push(pt.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      pt.vy -= 12 * dt;
      const s = Math.max(0.05, pt.life / pt.maxLife);
      pt.mesh.scale.setScalar(s);
      pt.mesh.material.color.setHex(pt.color);
    }
  }

  killProjectile(index, p) {
    p.mesh.visible = false;
    this.pools[p.kind].push(p.mesh);
    this.projectiles.splice(index, 1);
  }

  clear() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this.killProjectile(i, this.projectiles[i]);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.mesh.visible = false;
      this.pools.particle.push(pt.mesh);
    }
    this.particles.length = 0;
    this.cooldown = 0;
  }
}

// The orb's split parameters are carried on the projectile spec; we stash the
// most recent orb fire config here so splitOrb() can read it on impact.
let ORB_REF = null;
let ORB_MULT = 1;

// Wrap spawnByType so orb fires record their config for later bursting.
const _origSpawnByType = Combat.prototype.spawnByType;
Combat.prototype.spawnByType = function (f, accent, playerX, dmgMult) {
  if (f.type === 'orb') {
    ORB_REF = f;
    ORB_MULT = dmgMult;
  }
  return _origSpawnByType.call(this, f, accent, playerX, dmgMult);
};

// ---------------------------------------------------------------------------
// Player-impact checks (runner side of the collisions)
// ---------------------------------------------------------------------------

/**
 * Checks the runner against hazards & crates using swept z tests.
 * @returns {'wall'|'hurdle'|'duckbar'|'crate'|null}
 */
export function checkPlayerHit(world, player) {
  const px = player.x;
  const py = player.y;          // feet height
  const ph = player.height;     // 1.8 standing / 1.0 ducking
  const pw = 0.35;              // half width
  const pz = 0;                 // player z anchor
  const sweep = 0.45;           // covers obstacle approach per frame

  for (const h of world.hazards) {
    const hp = h.mesh.position;
    if (hp.z - h.halfD > pz + sweep || hp.z + h.halfD < pz - sweep) continue;
    if (h.kind === 'wall') {
      if (Math.abs(px - hp.x) < h.halfW + pw) return 'wall';
    } else if (h.kind === 'hurdle') {
      if (Math.abs(px - hp.x) < h.halfW + pw && py < h.top) return 'hurdle';
    } else if (h.kind === 'duckbar') {
      if (py + ph > h.bottom) return 'duckbar';
    }
  }

  for (const c of world.crates) {
    const cp = c.mesh.position;
    if (cp.z - c.halfD > pz + sweep || cp.z + c.halfD < pz - sweep) continue;
    if (Math.abs(px - cp.x) < c.halfW + pw && py < c.top) return 'crate';
  }

  return null;
}

/**
 * Collects any power cubes the runner touches.
 * @returns {number} cubes collected this frame
 */
export function collectCubes(world, player) {
  let collected = 0;
  for (let i = world.cubes.length - 1; i >= 0; i--) {
    const c = world.cubes[i];
    const cp = c.mesh.position;
    if (cp.z < -1.2 || cp.z > 1.2) continue;
    if (Math.abs(player.x - cp.x) > 0.9) continue;
    const feet = player.y;
    if (cp.y < feet - 0.3 || cp.y > feet + player.height + 0.4) continue;
    world.release('cubes', c, 'cube');
    collected++;
  }
  return collected;
}
