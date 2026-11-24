// ============================================================================
// audio.js — tiny Web Audio SFX manager.
//
// Loudness leveling: each file is decoded once and its true peak is measured,
// then the sound gets a per-sound gain so it plays back at a consistent target
// level (no "flash bang" if a source file was mastered hot). A master
// DynamicsCompressor limiter catches stacked/overlapping sounds so the mix
// can never clip, regardless of the user's volume setting.
// ============================================================================

const SFX_FILES = {
  cube: 'sfx/powercube-sfx.mp3',
  shellby: 'sfx/gun-shellby-sfx.mp3',
  colton: 'sfx/gun-colton-sfx.mp3',
  rocko: 'sfx/gun-rocko-sfx.mp3',
  shared: 'sfx/gun-nitara-spino.mp3', // Nitara & Spino share the wave/orb zap
  jump: 'sfx/jump-sfx.mp3',
};

// Per-sound relative loudness on top of normalization (fine tuning by role)
const SFX_MIX = {
  cube: 0.85,
  jump: 0.8,
  shellby: 1.0,
  colton: 0.9,
  rocko: 1.0,
  shared: 0.9,
};

const TARGET_PEAK = 0.42;  // every sound is scaled so its peak lands here
const MAX_BOOST = 2.2;     // never amplify quiet files more than this
const MASTER_LEVEL = 0.85; // headroom below the limiter
const MAX_VOICES = 10;     // hard cap on overlapping sounds

class Sfx {
  constructor() {
    this.ctx = null;
    this.sounds = {};   // name -> { buffer, gain }
    this.voices = 0;
    this.loading = null;
    this.streaks = {};      // name -> consecutive plays within the streak window
    this.lastStreak = {};   // name -> timestamp of last streak play
  }

  /** Must be called from a user gesture (browser autoplay policy). Idempotent. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.loading;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;

    const ctx = new AC();
    this.ctx = ctx;

    // master chain: gain -> limiter -> speakers
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_LEVEL;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(ctx.destination);

    this.loading = Promise.all(
      Object.entries(SFX_FILES).map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.sounds[name] = { buffer: buf, gain: levelGain(buf) };
        } catch (err) {
          console.warn(`[sfx] could not load "${name}" (${url}):`, err.message);
        }
      })
    );
    return this.loading;
  }

  /** Play a sound by name. Safe to call before init or for missing sounds. */
  play(name, rate) {
    const ctx = this.ctx;
    const snd = this.sounds[name];
    if (!ctx || ctx.state !== 'running' || !snd || this.voices >= MAX_VOICES) return;

    const src = ctx.createBufferSource();
    src.buffer = snd.buffer;
    src.playbackRate.value = rate ?? 0.94 + Math.random() * 0.12; // subtle pitch variance
    const g = ctx.createGain();
    g.gain.value = snd.gain * (SFX_MIX[name] ?? 1);
    src.connect(g).connect(this.master);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start();
  }

  /**
   * Play with a rising pitch on consecutive plays (combo feel).
   * Each hit within `window` seconds raises the pitch one semitone, up to `max`.
   */
  playStreak(name, { step = 1 / 12, max = 1.6, window = 1.4 } = {}) {
    const now = performance.now();
    const chained = now - (this.lastStreak[name] ?? -Infinity) < window * 1000;
    this.streaks[name] = chained ? (this.streaks[name] ?? 0) + 1 : 0;
    this.lastStreak[name] = now;
    const rate = Math.min(2 ** (this.streaks[name] * step), max);
    this.play(name, rate);
  }
}

/** True-peak measurement across all channels of a decoded buffer. */
function levelGain(buffer) {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak < 0.001) return 1; // silent file, don't blow it up
  return Math.min(MAX_BOOST, TARGET_PEAK / peak);
}

export const sfx = new Sfx();
