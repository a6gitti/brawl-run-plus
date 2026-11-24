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
  bust: 'sfx/bust-sfx.mp3',           // drop your boom file here: public/sfx/bust-sfx.mp3
};

// Per-sound relative loudness on top of normalization (fine tuning by role)
const SFX_MIX = {
  cube: 0.85,
  jump: 0.8,
  shellby: 1.0,
  colton: 0.9,
  rocko: 1.0,
  shared: 0.9,
  bust: 1.0,
};

const TARGET_PEAK = 0.42;  // every sound is scaled so its peak lands here
const MAX_BOOST = 2.2;     // never amplify quiet files more than this
const MASTER_LEVEL = 0.85; // headroom below the limiter
const MAX_VOICES = 16;     // soft cap on overlapping sounds
const HARD_CAP = 24;       // absolute ceiling, even for priority sounds

// Sounds that must always play, even at the voice cap (bust boom etc.)
const PRIORITIZED = new Set(['bust']);

class Sfx {
  constructor() {
    this.ctx = null;
    this.sounds = {};   // name -> { buffer, gain }
    this.voices = 0;
    this.loading = null;
    this.streaks = {};      // name -> consecutive plays within the streak window
    this.lastStreak = {};   // name -> timestamp of last streak play
    this.music = new Music(this);
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

  /**
   * Play a sound by name. Safe to call before init or for missing sounds.
   * Sounds are independent buffer sources, so different sounds (and even
   * several copies of one sound) always mix simultaneously — the voice cap
   * only exists to avoid an absurd pile-up, and priority sounds bypass it.
   */
  play(name, rate) {
    try {
      const ctx = this.ctx;
      const snd = this.sounds[name];
      if (!ctx || ctx.state !== 'running' || !snd) return;
      const isPriority = PRIORITIZED.has(name);
      if (this.voices >= (isPriority ? HARD_CAP : MAX_VOICES)) return;

      const r = rate ?? 0.94 + Math.random() * 0.12; // subtle pitch variance
      const src = ctx.createBufferSource();
      src.buffer = snd.buffer;
      src.playbackRate.value = r;
      const g = ctx.createGain();
      g.gain.value = snd.gain * (SFX_MIX[name] ?? 1);
      src.connect(g).connect(this.master);

      // free the voice slot when the sound ends — with a duration-based
      // fallback too, because `onended` can be delayed/throttled on mobile,
      // which used to leak slots and starve later sounds (e.g. the bust boom
      // going silent right after a cube pickup)
      this.voices++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.voices--;
      };
      src.onended = release;
      setTimeout(release, (snd.buffer.duration / r) * 1000 + 250);

      src.start();
    } catch (err) {
      console.warn(`[sfx] failed to play "${name}":`, err.message);
    }
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

  musicStart() { this.music.start(); }
  musicStop() { this.music.stop(); }
  musicBpm(b) { this.music.setBpm(b); }
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

// ---------------------------------------------------------------------------
// Procedural music: a 4-bar chiptune loop (bass / hats / kick / sparse lead)
// scheduled with look-ahead. Tempo follows game speed. Routed through the
// same limiter chain at a quiet level so it never fights the SFX.
// ---------------------------------------------------------------------------
const midiF = (m) => 440 * 2 ** ((m - 69) / 12);
const BASS = [
  45, -1, 45, 45, 48, -1, 45, -1, 52, -1, 52, 52, 48, -1, 48, -1,
  43, -1, 43, 43, 48, -1, 43, -1, 50, -1, 50, 50, 48, -1, 48, -1,
]; // A-minor groove, 32 eighth-notes
const LEAD = { 6: 69, 14: 72, 22: 76, 30: 72 }; // sparse sparkle notes

class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.playing = false;
    this.step = 0;
    this.nextT = 0;
    this.bpm = 130;
    this.timer = null;
  }

  start() {
    const ctx = this.sfx.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextT = ctx.currentTime + 0.15;
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = 0.16; // quiet bed under the SFX
      this.out.connect(this.sfx.master);
    }
    if (!this.noise) { // shared hi-hat noise buffer
      const n = Math.floor(0.08 * ctx.sampleRate);
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
  }

  setBpm(b) {
    this.bpm = Math.min(200, Math.max(90, b));
  }

  schedule() {
    const ctx = this.sfx.ctx;
    if (!ctx || !this.playing) return;
    const stepDur = 60 / this.bpm / 2; // eighth notes
    while (this.nextT < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextT);
      this.nextT += stepDur;
      this.step = (this.step + 1) % 32;
    }
  }

  playStep(s, t) {
    this.hat(t, s % 4 === 0 ? 0.4 : 0.18);
    if (s % 8 === 0) this.kick(t);
    const bass = BASS[s];
    if (bass >= 0) this.note(midiF(bass), t, 0.16, 'square', 0.42);
    const lead = LEAD[s];
    if (lead) this.note(midiF(lead), t, 0.22, 'triangle', 0.3);
  }

  note(freq, t, dur, type, vol) {
    const ctx = this.sfx.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  hat(t, vol) {
    const ctx = this.sfx.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
  }

  kick(t) {
    const ctx = this.sfx.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}

export const sfx = new Sfx();
