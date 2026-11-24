// ============================================================================
// main.js — game states, input, runner controller, camera, HUD & render loop.
// ============================================================================

import './style.css';
import * as THREE from 'three';
import { BRAWLERS, getBrawler } from './brawlers.js';
import { World, LANE_X, toonMaterial } from './world.js';
import { Combat, checkPlayerHit, collectCubes } from './combat.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hud = $('hud');
const elScore = $('score'), elMult = $('mult'), elSpeed = $('speed');
const elCubes = $('cubes'), elPower = $('power');
const elCdFill = $('cooldown-fill'), elCdText = $('cooldown-text');
const elChipColor = $('chip-color'), elChipName = $('chip-name');
const charSelect = $('char-select'), charCards = $('char-cards');
const gameOver = $('game-over');
const elFinalScore = $('final-score'), elFinalCubes = $('final-cubes'), elBestScore = $('best-score');
const announceEl = $('announce');

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
const isCompact = window.innerWidth < 720; // phones / small tablets
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCompact ? 1.75 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const world = new World(scene);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 5.4, 8.2);

const combat = new Combat(scene, world, {
  addScore: (pts) => { game.score += pts * game.mult; },
  shake: (amp) => { game.shake = Math.max(game.shake, amp); },
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const player = {
  group: new THREE.Group(),   // logical transform (x, y at feet, z = 0)
  rig: new THREE.Group(),     // visual bob/tilt layer
  parts: { arms: [], legs: [], weapons: [] }, // animatable limb refs
  brawler: null,
  lane: 1,
  targetLane: 1,
  x: 0,
  y: 0,
  vy: 0,
  ducking: false,
  height: 1.8,
  powerLevel: 0,
  onGround: true,
  prevOnGround: true,
  fireKick: 0,
  gravity: -26, // scaled up with game speed for snappier late-game jumps
};
player.group.add(player.rig);
player.group.visible = false;
scene.add(player.group);

// ---------------------------------------------------------------------------
// Runner meshes — one chunky low-poly rig per brawler, matching each
// archetype's silhouette (shotgun bruiser, gunslinger, rocket shoulder-cannon,
// bear-hood shaman, cactus critter).
// ---------------------------------------------------------------------------
const sh = (m) => { m.castShadow = true; return m; };

function addShoes(rig, color, spread = 0.2) {
  for (const sx of [-spread, spread]) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.42), toonMaterial(color));
    shoe.position.set(sx, 0.08, 0.05);
    shoe.userData.anim = 'leg';
    shoe.userData.side = Math.sign(sx) || 1;
    shoe.userData.baseZ = 0.05;
    shoe.userData.baseY = 0.08;
    rig.add(sh(shoe));
  }
}

function addArms(rig, color, { spread = 0.5, y = 1.05, tilt = 0.5, r = 0.13 } = {}) {
  for (const sx of [-spread, spread]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.35, 3, 8), toonMaterial(color));
    arm.position.set(sx, y, 0.05);
    arm.rotation.z = sx * tilt;
    arm.userData.anim = 'arm';
    arm.userData.side = Math.sign(sx) || 1;
    rig.add(sh(arm));
  }
}

function tagWeapon(mesh, baseRotX) {
  mesh.userData.anim = 'weapon';
  mesh.userData.baseRotX = baseRotX;
}

// Brawler-style face: big eyes + angled brows + mouth (smile arc or teeth grin)
function addFace(rig, { y = 1.72, z = 0.34, eyes = true, brows = true, mouth = 'smile', scale = 1 } = {}) {
  const dark = 0x2b2320;
  if (eyes) {
    for (const sx of [-0.14, 0.14]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075 * scale, 8, 6), toonMaterial(0xffffff));
      eye.position.set(sx, y + 0.04, z);
      rig.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.038 * scale, 6, 5), toonMaterial(dark));
      pupil.position.set(sx, y + 0.04, z + 0.05);
      rig.add(pupil);
    }
  }
  if (brows) {
    for (const sx of [-0.15, 0.15]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.17 * scale, 0.05, 0.05), toonMaterial(dark));
      brow.position.set(sx, y + 0.17, z + 0.02);
      brow.rotation.z = sx * -0.18; // determined angle
      rig.add(brow);
    }
  }
  if (mouth === 'smile') {
    const grin = new THREE.Mesh(new THREE.TorusGeometry(0.075 * scale, 0.022, 6, 12, Math.PI), toonMaterial(dark));
    grin.position.set(0, y - 0.1, z + 0.04);
    grin.rotation.z = Math.PI; // lower half-arc = smile
    rig.add(grin);
  } else if (mouth === 'grin') {
    const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.26 * scale, 0.09, 0.05), toonMaterial(0xffffff));
    teeth.position.set(0, y - 0.11, z + 0.05);
    rig.add(teeth);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.3 * scale, 0.03, 0.04), toonMaterial(dark));
    lip.position.set(0, y - 0.065, z + 0.04);
    rig.add(lip);
  }
}

// SHELLBY — shotgun bruiser: bob haircut, open jacket collar, big shotgun
function buildShellby(c) {
  const rig = new THREE.Group();

  const torso = sh(new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 4, 12), toonMaterial(c.primary)));
  torso.position.y = 1.0;
  rig.add(torso);

  for (const sx of [-1, 1]) { // jacket lapels
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.12), toonMaterial(c.secondary));
    lapel.position.set(sx * 0.38, 1.15, 0.16);
    lapel.rotation.z = sx * 0.35;
    rig.add(sh(lapel));
  }

  const head = sh(new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 10), toonMaterial(c.skin)));
  head.position.y = 1.72;
  rig.add(head);

  const hairTop = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), toonMaterial(c.hair));
  hairTop.position.y = 1.76;
  rig.add(hairTop);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), toonMaterial(c.hair));
  hairBack.position.set(0, 1.6, -0.22);
  hairBack.scale.set(1.15, 1.25, 0.8);
  rig.add(hairBack);
  const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.14), toonMaterial(c.hair));
  bangs.position.set(0, 1.84, 0.26);
  bangs.rotation.x = 0.35;
  rig.add(bangs);

  const gun = new THREE.Group(); // shotgun across the chest
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 1.0), toonMaterial(0x3a3f52));
  gun.add(sh(barrel));
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.34), toonMaterial(c.accent));
  pump.position.set(0, -0.13, 0.22);
  gun.add(sh(pump));
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.34), toonMaterial(c.primary));
  stock.position.set(0, -0.07, -0.58);
  gun.add(sh(stock));
  gun.position.set(0.08, 1.12, 0.5);
  gun.rotation.x = 0.22;
  tagWeapon(gun, 0.22);
  rig.add(gun);

  addArms(rig, c.primary);
  addShoes(rig, c.secondary);
  addFace(rig, { y: 1.72, z: 0.36, mouth: 'smile' });
  const bandage = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.04), toonMaterial(0xfff4e0)); // cheek bandage
  bandage.position.set(-0.19, 1.68, 0.38);
  rig.add(bandage);
  return rig;
}

// COLTON — gunslinger: swept quiff, thick brows, belt, twin revolvers
function buildColton(c) {
  const rig = new THREE.Group();

  const torso = sh(new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.5, 4, 12), toonMaterial(c.primary)));
  torso.position.y = 1.02;
  rig.add(torso);

  for (const sx of [-1, 1]) { // vest panels
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.42), toonMaterial(c.secondary));
    vest.position.set(sx * 0.26, 1.05, 0.02);
    rig.add(sh(vest));
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.5), toonMaterial(0x3a3f52));
  belt.position.y = 0.72;
  rig.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.1), toonMaterial(c.accent));
  buckle.position.set(0, 0.72, 0.27);
  rig.add(sh(buckle));

  const head = sh(new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), toonMaterial(c.skin)));
  head.position.y = 1.72;
  rig.add(head);

  const quiff = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), toonMaterial(c.hair)); // swept-back hair
  quiff.position.set(0, 1.92, -0.08);
  quiff.scale.set(1.0, 0.7, 1.35);
  rig.add(sh(quiff));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 7), toonMaterial(c.hair));
  tip.position.set(0, 2.0, -0.42);
  tip.rotation.x = -1.1;
  rig.add(sh(tip));
  for (const sx of [-0.14, 0.14]) { // brows
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.06), toonMaterial(0x3a3f52));
    brow.position.set(sx, 1.82, 0.3);
    rig.add(brow);
  }

  for (const sx of [-0.55, 0.55]) { // twin revolvers
    const revolver = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.36, 8), toonMaterial(0x3a3f52));
    barrel.rotation.x = Math.PI / 2;
    revolver.add(sh(barrel));
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), toonMaterial(c.accent));
    cylinder.rotation.x = Math.PI / 2;
    cylinder.position.z = -0.14;
    revolver.add(sh(cylinder));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), toonMaterial(c.secondary));
    grip.position.set(0, -0.14, -0.2);
    grip.rotation.x = 0.4;
    revolver.add(sh(grip));
    revolver.position.set(sx, 1.0, 0.35);
    revolver.rotation.x = 0.5;
    tagWeapon(revolver, 0.5);
    rig.add(revolver);
  }

  addArms(rig, c.primary, { spread: 0.52, tilt: 0.65 });
  addShoes(rig, c.secondary);
  addFace(rig, { y: 1.72, z: 0.34, mouth: 'grin', scale: 1.05 });
  for (const sx of [-0.2, 0.24]) { // cheek cross marks
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), toonMaterial(0xe8a075));
    cross.position.set(sx, 1.63, 0.35);
    cross.rotation.z = Math.PI / 4;
    rig.add(cross);
  }
  return rig;
}

// ROCKO — demolition derby: stocky build, shades, backwards cap,
// huge rocket launcher resting on the shoulder
function buildRocko(c) {
  const rig = new THREE.Group();

  const torso = sh(new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.5, 4, 12), toonMaterial(c.primary)));
  torso.position.y = 0.92;
  rig.add(torso);
  for (const sx of [-0.56, 0.56]) { // rolled sleeves
    const sleeve = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), toonMaterial(c.accent));
    sleeve.position.set(sx, 1.18, 0);
    rig.add(sh(sleeve));
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.62), toonMaterial(0x3a3f52));
  belt.position.y = 0.6;
  rig.add(belt);

  const head = sh(new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), toonMaterial(c.skin)));
  head.position.y = 1.64;
  rig.add(head);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.37, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), toonMaterial(c.secondary));
  cap.position.y = 1.68;
  cap.rotation.x = Math.PI; // backwards cap
  rig.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.3), toonMaterial(c.secondary));
  brim.position.set(0, 1.72, -0.4);
  rig.add(brim);
  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.1), toonMaterial(0x23283c));
  shades.position.set(0, 1.66, 0.3);
  rig.add(shades);

  const launcher = new THREE.Group(); // shoulder cannon
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 10), toonMaterial(0x4a5160));
  tube.rotation.x = Math.PI / 2;
  launcher.add(sh(tube));
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 10), toonMaterial(c.accent));
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = 0.72;
  launcher.add(sh(muzzle));
  for (let i = 0; i < 3; i++) { // loaded rockets poking out the back
    const rocket = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 8), toonMaterial(c.accent));
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    rocket.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, -0.85);
    rocket.rotation.x = -Math.PI / 2;
    launcher.add(sh(rocket));
  }
  launcher.position.set(0.5, 1.85, -0.25);
  launcher.rotation.set(0.12, 0, -0.08);
  tagWeapon(launcher, 0.12);
  rig.add(launcher);

  addArms(rig, c.primary, { spread: 0.62, tilt: 0.45, r: 0.15 });
  addShoes(rig, c.secondary, 0.26);
  addFace(rig, { y: 1.64, z: 0.3, eyes: false, brows: false, mouth: 'grin' }); // grin under the shades
  return rig;
}

// NITARA — spirit caller: bear hood with ears + snout, poncho skirt, clawed paws
function buildNitara(c) {
  const rig = new THREE.Group();

  const torso = sh(new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.45, 4, 12), toonMaterial(c.primary)));
  torso.position.y = 1.0;
  rig.add(torso);
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.6, 10, 1, true), toonMaterial(c.accent));
  skirt.position.y = 0.78;
  skirt.rotation.x = Math.PI; // open cone facing down
  rig.add(sh(skirt));

  const hood = sh(new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), toonMaterial(c.primary)));
  hood.position.y = 1.66;
  rig.add(hood);
  for (const sx of [-0.28, 0.28]) { // bear ears
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), toonMaterial(c.primary));
    ear.position.set(sx, 2.02, 0);
    rig.add(sh(ear));
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), toonMaterial(c.accent));
    inner.position.set(sx, 2.03, 0.09);
    rig.add(inner);
  }
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), toonMaterial(c.secondary));
  snout.position.set(0, 1.56, 0.36);
  snout.scale.set(1.1, 0.8, 1);
  rig.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), toonMaterial(0x23283c));
  nose.position.set(0, 1.62, 0.5);
  rig.add(nose);
  for (const sx of [-0.15, 0.15]) { // eyes peeking from the hood
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), toonMaterial(0xffffff));
    eye.position.set(sx, 1.74, 0.36);
    rig.add(eye);
  }
  for (const sx of [-0.08, 0.08]) { // fangs
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), toonMaterial(0xffffff));
    fang.position.set(sx, 1.46, 0.42);
    fang.rotation.x = Math.PI;
    rig.add(fang);
  }

  for (const sx of [-0.5, 0.5]) { // paws with claws
    const paw = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.3, 3, 8), toonMaterial(c.primary));
    paw.position.set(sx, 1.05, 0.08);
    paw.rotation.z = sx * 0.5;
    paw.userData.anim = 'arm';
    paw.userData.side = Math.sign(sx) || 1;
    rig.add(sh(paw));
    for (let i = -1; i <= 1; i++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), toonMaterial(0xf4f7ff));
      claw.position.set(sx * 0.62, 0.95, 0.12 + i * 0.07);
      claw.rotation.x = 1.4;
      rig.add(claw);
    }
  }

  addShoes(rig, c.secondary);
  addFace(rig, { y: 1.7, z: 0.42, mouth: 'grin', scale: 0.9 }); // scowl + gritted teeth
  return rig;
}

// SPINO — prickly critter: egg-shaped cactus body, flower crown,
// deep-set eyes + open mouth, spikes, stubby limbs
function buildSpino(c) {
  const rig = new THREE.Group();

  const body = sh(new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 12), toonMaterial(c.primary)));
  body.position.y = 0.98;
  body.scale.set(0.85, 1.05, 0.85);
  rig.add(body);

  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.12, 12), toonMaterial(c.secondary));
  waist.position.y = 0.66;
  rig.add(waist);

  // flower crown: 3 petals + center bud
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), toonMaterial(c.accent));
    petal.position.set(Math.cos(a) * 0.17, 1.72, Math.sin(a) * 0.17);
    rig.add(sh(petal));
  }
  const bud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), toonMaterial(0xfff3b0));
  bud.position.y = 1.76;
  rig.add(sh(bud));

  const dark = 0x1d5a2a;
  for (const sx of [-0.17, 0.17]) { // deep oval eyes
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), toonMaterial(dark));
    eye.position.set(sx, 1.06, 0.5);
    eye.scale.set(1, 1.35, 0.55);
    rig.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), toonMaterial(dark)); // open mouth
  mouth.position.set(0, 0.78, 0.52);
  mouth.scale.set(1.15, 0.85, 0.5);
  rig.add(mouth);

  const spikeAngles = [ // spikes sticking out of the body
    { p: [0.5, 1.25, 0.1], r: [0, 0, -1.35] },
    { p: [-0.5, 1.25, 0.1], r: [0, 0, 1.35] },
    { p: [0.42, 0.85, -0.32], r: [1.0, 0, 1.1] },
    { p: [-0.42, 0.85, -0.32], r: [1.0, 0, -1.1] },
    { p: [0, 1.45, -0.42], r: [2.2, 0, 0] },
  ];
  for (const s of spikeAngles) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 6), toonMaterial(c.skin));
    spike.position.set(...s.p);
    spike.rotation.set(...s.r);
    rig.add(sh(spike));
  }

  for (const sx of [-0.5, 0.5]) { // stubby arms
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.2, 3, 7), toonMaterial(c.primary));
    arm.position.set(sx, 0.95, 0.12);
    arm.rotation.z = sx * 0.9;
    arm.userData.anim = 'arm';
    arm.userData.side = Math.sign(sx) || 1;
    rig.add(sh(arm));
  }
  for (const sx of [-0.18, 0.18]) { // chunky feet
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), toonMaterial(c.skin));
    foot.position.set(sx, 0.12, 0.06);
    foot.scale.set(1, 0.7, 1.3);
    foot.userData.anim = 'leg';
    foot.userData.side = Math.sign(sx) || 1;
    foot.userData.baseZ = 0.06;
    foot.userData.baseY = 0.12;
    rig.add(sh(foot));
  }
  return rig;
}

const RUNNER_BUILDERS = {
  shellby: buildShellby,
  colton: buildColton,
  rocko: buildRocko,
  nitara: buildNitara,
  spino: buildSpino,
};

function buildRunnerMesh(brawler) {
  // NOTE: no yaw here — updateRunner owns rig.rotation.y (facing away, -z).
  return RUNNER_BUILDERS[brawler.id](brawler.colors);
}

// ---------------------------------------------------------------------------
// Gold skin toggle (Brawl Stars gold variants)
// ---------------------------------------------------------------------------
let goldMaterial = null;
let goldSkin = localStorage.getItem('brawlrunner.gold') === '1';

function applyGold(rig) {
  if (!goldSkin) return;
  if (!goldMaterial) {
    goldMaterial = toonMaterial(0xf7c948, { emissive: 0x6b4a00, emissiveIntensity: 0.35 });
  }
  rig.traverse((o) => { if (o.isMesh) o.material = goldMaterial; });
}

function disposeRig(rig) {
  rig.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (o.material !== goldMaterial) o.material.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// Character-select 3D preview (rotating model above the track)
// ---------------------------------------------------------------------------
let previewRig = null;
let previewBrawler = null;

function showPreview(brawler) {
  clearPreview();
  previewBrawler = brawler;
  previewRig = buildRunnerMesh(brawler);
  applyGold(previewRig);
  previewRig.position.set(0, 0, -5.5);
  previewRig.rotation.y = Math.PI; // start facing away, then spin
  scene.add(previewRig);
}

function clearPreview() {
  if (!previewRig) return;
  scene.remove(previewRig);
  disposeRig(previewRig);
  previewRig = null;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const BASE_SPEED = 12;
const MAX_SPEED = 28;
const SPEED_ACCEL = 0.35;

const game = {
  state: 'select',        // 'select' | 'playing' | 'over'
  speed: 0,
  score: 0,
  mult: 1,
  shake: 0,
  best: Number(localStorage.getItem('brawlrunner.best') ?? 0),
  elapsed: 0,
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = { left: false, right: false, up: false, down: false, jumpQueued: false };

function moveLane(dir) {
  if (game.state !== 'playing') return;
  player.targetLane = THREE.MathUtils.clamp(player.targetLane + dir, 0, 2);
}

function tryJump() {
  if (game.state !== 'playing') return;
  if (player.onGround) {
    // scale jump power & gravity together with speed: same arc height,
    // shorter airtime — lets you chain jumps quickly in the late game
    const k = jumpScale();
    player.vy = 10.5 * k;
    player.gravity = GRAVITY * k;
    player.onGround = false;
    player.ducking = false;
    player.height = 1.8;
    sfx.play('jump');
  }
}

// jump quickness scales from 1.0 at base speed to ~1.35 at max speed
function jumpScale() {
  return 1 + ((game.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)) * 0.35;
}

window.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': moveLane(-1); e.preventDefault(); break;
    case 'ArrowRight': case 'KeyD': moveLane(1); e.preventDefault(); break;
    case 'ArrowUp': case 'KeyW': case 'Space':
      input.jumpQueued = true; e.preventDefault(); break;
    case 'ArrowDown': case 'KeyS': input.down = true; e.preventDefault(); break;
    case 'KeyF': case 'Enter':
      if (game.state === 'playing') fire();
      else if (game.state === 'over') restartRun();
      e.preventDefault();
      break;
    case 'KeyR':
      if (game.state === 'over') restartRun();
      break;
    case 'Escape':
      if (game.state === 'over' || game.state === 'playing') showCharSelect();
      break;
    default:
      if (game.state === 'select' && /^Digit[1-5]$/.test(e.code)) {
        startRun(BRAWLERS[Number(e.code.slice(5)) - 1]);
      }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowDown' || e.code === 'KeyS') input.down = false;
});

// ---------------------------------------------------------------------------
// Pointer / touch gestures — works identically for mouse and touch:
//   drag/swipe left·right = switch lane   (repeatable within one drag)
//   swipe up   = jump
//   swipe down = duck (holds while the pointer stays down)
//   quick tap / click = attack
// ---------------------------------------------------------------------------
const SWIPE_PX = 34;      // threshold for a lane switch / duck / jump swipe
const TAP_MS = 280;       // max duration for a tap-to-attack
const TAP_PX = 14;        // max movement for a tap-to-attack

const gesture = { active: false, id: null, x: 0, y: 0, t: 0, moved: false, duckHold: false };

function onPointerDown(e) {
  if (game.state !== 'playing') return;
  gesture.active = true;
  gesture.id = e.pointerId;
  gesture.x = e.clientX;
  gesture.y = e.clientY;
  gesture.t = performance.now();
  gesture.moved = false;
  gesture.duckHold = false;
}

function onPointerMove(e) {
  if (!gesture.active || e.pointerId !== gesture.id) return;
  const dx = e.clientX - gesture.x;
  const dy = e.clientY - gesture.y;

  if (Math.abs(dx) >= SWIPE_PX) {
    moveLane(dx > 0 ? 1 : -1);
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    gesture.moved = true;
  } else if (dy >= SWIPE_PX) {
    input.down = true;
    gesture.duckHold = true;
    gesture.y = e.clientY;
    gesture.moved = true;
  } else if (dy <= -SWIPE_PX) {
    input.jumpQueued = true;
    gesture.y = e.clientY;
    gesture.moved = true;
  }
}

function onPointerUp(e) {
  if (!gesture.active || e.pointerId !== gesture.id) return;
  gesture.active = false;
  if (gesture.duckHold) input.down = false;
  const duration = performance.now() - gesture.t;
  const travel = Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y);
  if (!gesture.moved && duration < TAP_MS && travel < TAP_PX) fire();
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// unlock the audio context on the very first interaction (autoplay policy)
window.addEventListener('pointerdown', () => sfx.init(), { once: true });
window.addEventListener('keydown', () => sfx.init(), { once: true });

// ---------------------------------------------------------------------------
// Character-select portraits — hand-drawn SVG faces (no image assets needed),
// colored from each brawler's palette.
// ---------------------------------------------------------------------------
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const INK = '#1a1420';

function faceSVG(b) {
  switch (b.id) {
    case 'shellby': return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="50" fill="#b995e8"/>
        <ellipse cx="50" cy="44" rx="35" ry="31" fill="${hex(b.colors.hair)}" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="27" cy="58" rx="9" ry="15" fill="${hex(b.colors.hair)}" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="73" cy="58" rx="9" ry="15" fill="${hex(b.colors.hair)}" stroke="${INK}" stroke-width="3"/>
        <circle cx="50" cy="60" r="24" fill="${hex(b.colors.skin)}"/>
        <path d="M26 46 Q50 30 74 46 L74 40 Q50 22 26 40 Z" fill="${hex(b.colors.hair)}"/>
        <ellipse cx="42" cy="57" rx="5.5" ry="7.5" fill="#fff"/>
        <ellipse cx="60" cy="57" rx="5.5" ry="7.5" fill="#fff"/>
        <ellipse cx="42.5" cy="58" rx="2.4" ry="4" fill="${INK}"/>
        <ellipse cx="60.5" cy="58" rx="2.4" ry="4" fill="${INK}"/>
        <path d="M33 47 L47 50" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M67 47 L53 50" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M42 72 Q52 78 62 69" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <rect x="64" y="63" width="13" height="10" rx="3" fill="#fff4e0" stroke="${INK}" stroke-width="2" transform="rotate(12 70 68)"/>
        <rect x="16" y="86" width="68" height="16" rx="7" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
      </svg>`;
    case 'colton': return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="50" fill="#a9d6ff"/>
        <circle cx="50" cy="59" r="25" fill="${hex(b.colors.skin)}"/>
        <path d="M22 44 Q26 14 58 14 Q86 16 80 40 Q72 28 54 30 Q34 30 24 46 Z"
              fill="${hex(b.colors.hair)}" stroke="${INK}" stroke-width="3"/>
        <path d="M74 24 Q88 30 82 44 L74 36 Z" fill="${hex(b.colors.hair)}" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="42" cy="56" rx="5.5" ry="7" fill="#fff"/>
        <ellipse cx="61" cy="56" rx="5.5" ry="7" fill="#fff"/>
        <ellipse cx="43" cy="57" rx="2.4" ry="3.8" fill="${INK}"/>
        <ellipse cx="62" cy="57" rx="2.4" ry="3.8" fill="${INK}"/>
        <path d="M33 46 L46 43" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>
        <path d="M56 43 L69 46" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>
        <rect x="39" y="67" width="24" height="10" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
        <path d="M49 67 L49 77 M55 67 L55 77" stroke="${INK}" stroke-width="1.6"/>
        <path d="M28 63 L33 68 M33 63 L28 68" stroke="#e8a075" stroke-width="2.4" stroke-linecap="round"/>
        <rect x="16" y="86" width="68" height="16" rx="7" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
      </svg>`;
    case 'rocko': return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="50" fill="#c9a8ff"/>
        <circle cx="50" cy="60" r="25" fill="${hex(b.colors.skin)}"/>
        <path d="M23 42 Q50 15 77 42 L77 36 Q50 12 23 36 Z" fill="#232a44" stroke="${INK}" stroke-width="3"/>
        <path d="M30 45 L70 45 L70 50 Q50 55 30 50 Z" fill="#232a44"/>
        <rect x="28" y="48" width="44" height="15" rx="7" fill="#12325e" stroke="${INK}" stroke-width="3"/>
        <circle cx="40" cy="55.5" r="5" fill="#0b1f3d"/>
        <circle cx="60" cy="55.5" r="5" fill="#0b1f3d"/>
        <path d="M36 52 L44 59 M58 52 L64 58" stroke="#9fd4ff" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
        <path d="M34 43 L45 40" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M66 43 L55 40" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M38 70 Q50 80 62 70 Z" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
        <path d="M44 70.5 L44 76 M50 71.5 L50 77 M56 70.5 L56 76" stroke="${INK}" stroke-width="1.4"/>
        <rect x="16" y="86" width="68" height="16" rx="7" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
      </svg>`;
    case 'nitara': return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="50" fill="#ffb3ab"/>
        <circle cx="24" cy="24" r="11" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
        <circle cx="24" cy="24" r="4.5" fill="${hex(b.colors.accent)}"/>
        <circle cx="76" cy="24" r="11" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
        <circle cx="76" cy="24" r="4.5" fill="${hex(b.colors.accent)}"/>
        <circle cx="50" cy="52" r="34" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
        <ellipse cx="50" cy="60" rx="21" ry="19" fill="#e8a878"/>
        <path d="M30 50 Q50 42 70 50 L70 58 Q60 54 50 54 Q40 54 30 58 Z" fill="${hex(b.colors.secondary)}" opacity="0.85"/>
        <ellipse cx="41" cy="55" rx="5" ry="6" fill="#fff"/>
        <ellipse cx="59" cy="55" rx="5" ry="6" fill="#fff"/>
        <ellipse cx="41.5" cy="56" rx="2.2" ry="3.4" fill="${INK}"/>
        <ellipse cx="58.5" cy="56" rx="2.2" ry="3.4" fill="${INK}"/>
        <path d="M33 45 L47 51" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M67 45 L53 51" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <ellipse cx="50" cy="64" rx="6" ry="4.5" fill="#d9946b"/>
        <rect x="39" y="70" width="22" height="8" rx="3" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
        <path d="M45 70 L45 78 M51 70 L51 78" stroke="${INK}" stroke-width="1.4"/>
        <rect x="16" y="86" width="68" height="16" rx="7" fill="${hex(b.colors.accent)}" stroke="${INK}" stroke-width="3"/>
      </svg>`;
    case 'spino': return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="50" fill="#b0f5bd"/>
        <ellipse cx="50" cy="57" rx="33" ry="34" fill="${hex(b.colors.primary)}" stroke="${INK}" stroke-width="3"/>
        <circle cx="33" cy="20" r="8.5" fill="#f472b6" stroke="${INK}" stroke-width="3"/>
        <circle cx="50" cy="14" r="8.5" fill="#f472b6" stroke="${INK}" stroke-width="3"/>
        <circle cx="67" cy="20" r="8.5" fill="#f472b6" stroke="${INK}" stroke-width="3"/>
        <circle cx="50" cy="24" r="6" fill="#ffe14d" stroke="${INK}" stroke-width="2.5"/>
        <ellipse cx="39" cy="53" rx="6" ry="9.5" fill="${hex(b.colors.secondary)}"/>
        <ellipse cx="62" cy="53" rx="6" ry="9.5" fill="${hex(b.colors.secondary)}"/>
        <ellipse cx="51" cy="75" rx="14" ry="9" fill="${hex(b.colors.secondary)}"/>
        <ellipse cx="51" cy="73" rx="9" ry="5" fill="#123d1c"/>
        <path d="M14 62 L20 58 L20 66 Z" fill="${hex(b.colors.skin)}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M86 62 L80 58 L80 66 Z" fill="${hex(b.colors.skin)}" stroke="${INK}" stroke-width="2.5"/>
        <path d="M30 34 L36 32 M64 32 L70 34" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
      </svg>`;
    default:
      return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${hex(b.colors.primary)}"/></svg>`;
  }
}
// ---------------------------------------------------------------------------
// UI: character select
// ---------------------------------------------------------------------------
function buildCharSelect() {
  charCards.innerHTML = '';
  BRAWLERS.forEach((b, i) => {
    const card = document.createElement('button');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="char-avatar">${faceSVG(b)}</div>
      <div class="char-name">${b.name}</div>
      <div class="char-epithet">${b.epithet}</div>
      <div class="char-attack"><b>${b.attackName}</b> — ${b.attackDesc}</div>
      <div class="char-key">${b.keyHint} · ${'★'.repeat(b.stats.power)}${'☆'.repeat(5 - b.stats.power)}</div>
    `;
    card.addEventListener('click', () => startRun(b));
    card.addEventListener('mouseenter', () => showPreview(b));
    card.addEventListener('focus', () => showPreview(b));
    charCards.appendChild(card);
  });
}

// Gold skin toggle button
const goldBtn = document.createElement('button');
goldBtn.id = 'gold-toggle';
goldBtn.className = 'btn btn-ghost';
goldBtn.addEventListener('click', () => {
  goldSkin = !goldSkin;
  localStorage.setItem('brawlrunner.gold', goldSkin ? '1' : '0');
  updateGoldBtn();
  if (previewBrawler) showPreview(previewBrawler); // rebuild with/without gold
});
function updateGoldBtn() {
  goldBtn.textContent = `✨ GOLD SKINS: ${goldSkin ? 'ON' : 'OFF'}`;
  goldBtn.classList.toggle('btn-primary', goldSkin);
  goldBtn.classList.toggle('btn-ghost', !goldSkin);
}
document.querySelector('.select-inner').insertBefore(goldBtn, document.querySelector('.controls-hint'));
updateGoldBtn();

function announce(text) {
  announceEl.textContent = text;
  announceEl.classList.remove('pop');
  void announceEl.offsetWidth; // restart animation
  announceEl.classList.add('pop');
}

function showCharSelect() {
  game.state = 'select';
  hud.classList.add('hidden');
  gameOver.classList.add('hidden');
  charSelect.classList.remove('hidden');
  player.group.visible = false;
  combat.clear();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------
let currentBrawler = null;

function startRun(brawler) {
  currentBrawler = brawler;
  sfx.init(); // user just clicked/pressed a key — safe to unlock audio
  game.state = 'playing';
  game.speed = BASE_SPEED;
  game.score = 0;
  game.mult = 1;
  game.shake = 0;
  game.elapsed = 0;

  player.brawler = brawler;
  player.lane = player.targetLane = 1;
  player.x = 0;
  player.y = 0;
  player.vy = 0;
  player.ducking = false;
  player.height = 1.8;
  player.onGround = true;
  player.powerLevel = 0;
  player.group.visible = true;
  player.group.scale.setScalar(1);
  player.group.position.set(0, 0, 0);

  // rebuild the rig with this brawler's colors, collect animatable limbs
  for (const child of [...player.rig.children]) disposeRig(child);
  player.rig.clear();
  player.rig.add(buildRunnerMesh(brawler));
  applyGold(player.rig);
  player.parts = { arms: [], legs: [], weapons: [] };
  player.rig.traverse((o) => {
    if (o.userData.anim === 'arm') player.parts.arms.push(o);
    else if (o.userData.anim === 'leg') player.parts.legs.push(o);
    else if (o.userData.anim === 'weapon') player.parts.weapons.push(o);
  });
  player.fireKick = 0;
  player.prevOnGround = true;

  world.reset();
  combat.clear();
  clearPreview();

  charSelect.classList.add('hidden');
  gameOver.classList.add('hidden');
  hud.classList.remove('hidden');

  elChipColor.style.background = brawler.css;
  elChipName.textContent = `${brawler.name} — ${brawler.attackName}`;
  elPower.textContent = 'POWER 0';
  elMult.textContent = 'x1.0';
  announce('GO!');
}

function restartRun() {
  if (currentBrawler) startRun(currentBrawler);
}

$('btn-restart').addEventListener('click', restartRun);
$('btn-select').addEventListener('click', showCharSelect);

function endRun() {
  game.state = 'over';
  combat.burst(player.x, 1, 0, 0xff5a5f, 18, 8);
  game.shake = 0.8;

  const finalScore = Math.floor(game.score);
  if (finalScore > game.best) {
    game.best = finalScore;
    localStorage.setItem('brawlrunner.best', String(finalScore));
  }
  elFinalScore.textContent = finalScore.toLocaleString();
  elFinalCubes.textContent = player.powerLevel;
  elBestScore.textContent = game.best.toLocaleString();

  setTimeout(() => {
    hud.classList.add('hidden');
    gameOver.classList.remove('hidden');
  }, 450);
}

// ---------------------------------------------------------------------------
// Combat trigger
// ---------------------------------------------------------------------------
// Fire SFX mapping per brawler (Nitara & Spino share the zap)
const FIRE_SFX = { shellby: 'shellby', colton: 'colton', rocko: 'rocko', nitara: 'shared', spino: 'shared' };

function fire() {
  const dmgMult = 1 + player.powerLevel * 0.25;
  // Snap the muzzle to the nearest lane center — firing mid-lane-change used to
  // spawn projectiles between lanes, missing crates (most visible on Nitara's
  // narrow wave). Shots now always fly dead-center down a lane.
  const laneIdx = THREE.MathUtils.clamp(Math.round((player.x + 2.5) / 2.5), 0, 2);
  const muzzleX = LANE_X[laneIdx];
  if (combat.tryFire(player.brawler, muzzleX, dmgMult)) {
    player.fireKick = 1; // arms punch / weapons recoil
    combat.flash(muzzleX, 1.2, -0.7, 0xffe08a);
    combat.burst(muzzleX, 1.1, -0.6, 0xffe08a, 3, 2.5);
    sfx.play(FIRE_SFX[player.brawler.id] ?? 'shared');
  }
}

// ---------------------------------------------------------------------------
// Runner update
// ---------------------------------------------------------------------------
const GRAVITY = -26;

function updateRunner(dt) {
  // lane lerp
  const targetX = [-2.5, 0, 2.5][player.targetLane];
  player.x += (targetX - player.x) * Math.min(1, 14 * dt);
  if (Math.abs(targetX - player.x) < 0.01) player.x = targetX;

  // duck
  const wantDuck = input.down && player.onGround;
  if (wantDuck !== player.ducking) {
    player.ducking = wantDuck;
    player.height = wantDuck ? 1.0 : 1.8;
  }

  // jump / gravity
  if (input.jumpQueued) {
    input.jumpQueued = false;
    tryJump();
  }
  if (!player.onGround) {
    player.vy += player.gravity * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.onGround = true;
    }
  }

  // transforms + run animation (rig faces -z, so lean/pitch are negated
  // to keep their on-screen direction intuitive)
  player.group.position.x = player.x;
  player.group.position.y = player.y;
  const duckScale = player.ducking ? 0.55 : 1;
  const lean = THREE.MathUtils.clamp((targetX - player.x) * -0.18, -0.25, 0.25);
  player.rig.rotation.z = -lean;
  player.rig.rotation.x = player.onGround ? 0 : THREE.MathUtils.clamp(player.vy * 0.02, -0.3, 0.25);
  player.rig.scale.y = THREE.MathUtils.lerp(player.rig.scale.y, duckScale, Math.min(1, 18 * dt));
  player.rig.position.y = player.onGround
    ? Math.abs(Math.sin(game.elapsed * (8 + game.speed * 0.35))) * 0.09
    : 0.05;
  player.rig.rotation.y = Math.PI + Math.sin(game.elapsed * 9) * 0.06; // arm-swing sway

  // fire-kick decay (arms punch forward, weapons recoil)
  player.fireKick = Math.max(0, player.fireKick - dt * 6);

  // limb run cycle
  const runPhase = game.elapsed * (9 + game.speed * 0.45);
  if (player.onGround && !player.ducking) {
    for (const arm of player.parts.arms) {
      arm.rotation.x = Math.sin(runPhase + (arm.userData.side > 0 ? 0 : Math.PI)) * 0.75
        - player.fireKick * 0.9;
    }
    for (const leg of player.parts.legs) {
      const s = Math.sin(runPhase + (leg.userData.side > 0 ? Math.PI : 0));
      leg.position.z = leg.userData.baseZ + s * 0.3;
      leg.position.y = leg.userData.baseY + Math.max(0, Math.cos(runPhase + (leg.userData.side > 0 ? Math.PI : 0))) * 0.12;
    }
  } else if (!player.onGround) {
    // airborne: arms pumped, legs tucked
    for (const arm of player.parts.arms) arm.rotation.x = -1.1;
    for (const leg of player.parts.legs) {
      leg.position.z = leg.userData.baseZ - 0.12;
      leg.position.y = leg.userData.baseY + 0.06;
    }
  }
  for (const w of player.parts.weapons) {
    w.rotation.x = w.userData.baseRotX + player.fireKick * 0.35; // recoil kick
  }

  // landing dust puff
  if (player.onGround && !player.prevOnGround) {
    combat.burst(player.x, 0.14, 0.15, 0xd8d2c4, 7, 2.5);
  }
  player.prevOnGround = player.onGround;

  // grow with power level
  const targetScale = 1 + Math.min(player.powerLevel, 10) * 0.035;
  player.group.scale.setScalar(THREE.MathUtils.lerp(player.group.scale.x, targetScale, Math.min(1, 4 * dt)));
}

// ---------------------------------------------------------------------------
// Collisions & pickups
// ---------------------------------------------------------------------------
function updateCollisions() {
  const hit = checkPlayerHit(world, player);
  if (hit) {
    endRun();
    return;
  }
  const got = collectCubes(world, player);
  if (got > 0) {
    player.powerLevel += got;
    game.mult = Math.min(3, 1 + player.powerLevel * 0.1);
    combat.burst(player.x, 1.2, 0, 0x39ff6e, 6 * got, 4);
    sfx.playStreak('cube'); // pitch climbs one semitone per chained pickup
    elPower.textContent = `POWER ${player.powerLevel}`;
    elMult.textContent = `x${game.mult.toFixed(1)}`;
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let lastCdReady = true;
function updateHUD() {
  elScore.textContent = Math.floor(game.score).toLocaleString();
  elSpeed.textContent = `${Math.round(game.speed * 3.6)} km/h`;
  elCubes.textContent = player.powerLevel;

  const cd = combat.cooldown;
  const pct = cd <= 0 ? 100 : (1 - cd / combat.cooldownMax) * 100;
  elCdFill.style.width = `${pct}%`;
  const ready = cd <= 0;
  if (ready !== lastCdReady) {
    lastCdReady = ready;
    elCdText.textContent = ready ? 'READY — FIRE!' : 'RELOADING';
    elCdFill.style.background = ready
      ? 'linear-gradient(90deg, #39ff6e, #0d9c3e)'
      : 'linear-gradient(90deg, #ffe14d, #ff9f1c)';
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let selectT = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  game.elapsed += dt;

  if (game.state === 'playing') {
    // speed ramp
    game.speed = Math.min(MAX_SPEED, game.speed + SPEED_ACCEL * dt);
    game.score += game.speed * dt * game.mult;

    updateRunner(dt);
    world.update(dt, game.speed);
    combat.update(dt);
    updateCollisions();
    updateHUD();
  } else if (game.state === 'select') {
    // slow ambient scroll behind the menu + rotating character preview
    world.update(dt, 2);
    selectT += dt;
    camera.position.set(Math.sin(selectT * 0.25) * 5, 4.5, 9);
    camera.lookAt(0, 1.2, -6);
    if (previewRig) {
      previewRig.rotation.y += dt * 0.9;
      previewRig.position.y = Math.sin(selectT * 2) * 0.06; // idle bob
    }
  }

  // decay screen shake
  game.shake = Math.max(0, game.shake - dt * 1.6);

  // follow camera (playing / game-over)
  if (game.state !== 'select') {
    const targetPos = new THREE.Vector3(player.x * 0.45, 5.4, 8.2);
    camera.position.lerp(targetPos, Math.min(1, 8 * dt));
    if (game.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * game.shake * 0.5;
      camera.position.y += (Math.random() - 0.5) * game.shake * 0.5;
    }
    camera.lookAt(player.x * 0.55, 1.4, -8);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// boot
buildCharSelect();
showCharSelect();
animate();
