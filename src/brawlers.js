// ============================================================================
// brawlers.js — data-driven character configs.
// Each brawler defines colors (used to build the 3D rig) and a `fire` block
// consumed by combat.js. All characters / names are original but inspired by
// classic brawler archetypes.
// ============================================================================

export const BRAWLERS = [  {
    id: 'shellby',
    name: 'SHELLY',
    epithet: 'Shotgun Scrapper',
    attackName: 'Spread Shot',
    attackDesc: 'Blasts a wide cone of 5 pellets — shreds crates across every lane at close range.',
    keyHint: 'KEY 1',
    colors: { primary: 0x9b59d0, secondary: 0x31184f, skin: 0xd08d5f, accent: 0xb388ff, hair: 0xf062a8 },
    css: 'radial-gradient(circle at 32% 28%, #ffb3d9, #f062a8 45%, #9b59d0)',
    stats: { power: 4, speed: 3, control: 3 },
    fire: {
      type: 'spread',
      cooldown: 0.7,
      pellets: 5,
      spreadX: 3.4,     // lateral velocity spread (units/sec)
      speed: 34,        // forward projectile speed
      range: 20,        // travel distance before despawn
      damage: 2,
      radius: 0.18,
    },
  },
  {
    id: 'colton',
    name: 'COLT',
    epithet: 'Quickdraw Ranger',
    attackName: 'Rapid Stream',
    attackDesc: 'Unloads a tight burst of 6 fast bullets straight down the current lane.',
    keyHint: 'KEY 2',
    colors: { primary: 0x3f74e0, secondary: 0x2a4c9c, skin: 0xf2c19b, accent: 0xffd23e, hair: 0xd94f30 },
    css: 'radial-gradient(circle at 32% 28%, #9fd4ff, #3f74e0 55%, #2a4c9c)',
    stats: { power: 2, speed: 5, control: 5 },
    fire: {
      type: 'stream',
      cooldown: 0.5,
      bullets: 6,
      spacing: 1.1,     // z-gap between the bullets of one burst
      speed: 55,
      range: 45,
      damage: 1,
      radius: 0.14,
    },
  },
  {
    id: 'rocko',
    name: 'ROCKO',
    hidden: true, // parked until the feel/look gets another pass
    epithet: 'Demolition Derby',
    attackName: 'Splash Rocket',
    attackDesc: 'Fires a rocket that detonates on impact, wrecking crates in adjacent lanes too.',
    keyHint: 'KEY 3',
    colors: { primary: 0x8455d6, secondary: 0x2b4fa0, skin: 0x8a5a2f, accent: 0xffd23e },
    css: 'radial-gradient(circle at 32% 28%, #c9a8ff, #8455d6 55%, #2b4fa0)',
    stats: { power: 5, speed: 2, control: 2 },
    fire: {
      type: 'rocket',
      cooldown: 0.9,
      speed: 26,
      range: 60,
      damage: 4,
      radius: 0.28,
      splashRadius: 3.2,  // hits crates within this distance of the blast
      splashDamage: 3,
    },
  },
  {
    id: 'nitara',
    name: 'NITARA',
    hidden: true, // parked until the feel/look gets another pass
    epithet: 'Spirit Caller',
    attackName: 'Piercing Wave',
    attackDesc: 'Sends a ground shockwave that barrels through every crate in its lane.',
    keyHint: 'KEY 4',
    colors: { primary: 0xe2574c, secondary: 0x8c2f28, skin: 0xf2c19b, accent: 0x35c7d8, hair: 0xe2574c },
    css: 'radial-gradient(circle at 32% 28%, #ffb0a8, #e2574c 55%, #8c2f28)',
    stats: { power: 3, speed: 4, control: 3 },
    fire: {
      type: 'wave',
      cooldown: 0.8,
      speed: 24,
      range: 34,
      damage: 2,
      radius: 0.5,      // generous x/y hitbox so the wave reliably clips crates
      pierce: 99,       // pierces essentially the whole lane
    },
  },
  {
    id: 'spino',
    name: 'SPIKE',
    epithet: 'Prickly Genius',
    attackName: 'Splitting Orb',
    attackDesc: 'Launches an orb that bursts into 6 radial spikes wherever it hits.',
    keyHint: 'KEY 5',
    colors: { primary: 0x4cd964, secondary: 0x1d5a2a, skin: 0xb8e986, accent: 0xffe14d },
    css: 'radial-gradient(circle at 32% 28%, #b0f5bd, #4cd964 55%, #1d5a2a)',
    stats: { power: 4, speed: 3, control: 2 },
    fire: {
      type: 'orb',
      cooldown: 0.85,
      speed: 30,
      range: 50,
      damage: 2,
      radius: 0.26,
      burst: { spikes: 6, damage: 2, speed: 18, range: 13, radius: 0.15 },
    },
  },
];

export function getBrawler(id) {
  return BRAWLERS.find((b) => b.id === id) ?? BRAWLERS[0];
}

/** Brawlers currently selectable in the UI (hidden ones are parked). */
export const SELECTABLE = BRAWLERS.filter((b) => !b.hidden);
