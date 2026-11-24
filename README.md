# BrawlRun+ 🎮⚡

A 3D endless runner with **Brawl Stars**-style chunky toon visuals — built with Three.js + Vite (vanilla JS).

**▶ Play:** https://a6gitti.github.io/brawl-run-plus/

## The Brawlers

| Brawler | Attack | What it does |
|---|---|---|
| **SHELLBY** | Spread Shot | Wide cone of 5 pellets — shreds crates across every lane up close |
| **COLTON** | Rapid Stream | Tight burst of 6 fast bullets straight down the lane |
| **ROCKO** | Splash Rocket | Rocket explodes on impact, wrecking crates in adjacent lanes too |
| **NITARA** | Piercing Wave | Ground shockwave that barrels through every crate in its lane |
| **SPINO** | Splitting Orb | Orb bursts into 6 radial spikes on impact |

Destroy crates to drop green **Power Cubes** → more damage, bigger brawler, higher score multiplier.

## Controls

| Action | Keyboard | Mouse / Touch |
|---|---|---|
| Switch lanes | `A` / `D` or `←` / `→` | Drag / swipe left·right |
| Jump | `W` / `↑` / `Space` | Swipe up |
| Duck | `S` / `↓` | Swipe down (hold) |
| Attack | `F` / `Enter` | Tap / click |
| Pick brawler | `1`–`5` | Click a card |

## Run locally

```bash
npm install
npm run dev      # requires Node >= 20.12 (Vite 8 / rolldown)
```

## Tech

- Three.js `MeshToonMaterial` with a 4-step cel-shading gradient map
- Everything is object-pooled (track segments, hazards, crates, cubes, projectiles, particles)
- Simple swept-AABB collisions — no physics engine
- Data-driven brawler configs in `src/brawlers.js`

## Project layout

```
src/
  main.js      — game states, input, runner controller, camera, HUD, loop
  brawlers.js  — data-driven character configs
  world.js     — environment, recycled track, pooled spawning
  combat.js    — projectiles, fire modes, collisions, particles
```
