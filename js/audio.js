// AudioManager: Web Audio context with master/SFX/music buses, procedurally
// synthesized sound effects, an ambient drone, and persisted volume settings.
// No audio files required — everything is generated at runtime.

const LS_KEY = "rl_audio";

// The looping ambience track (the only audio file; SFX are synthesized).
// Exported so the build script / service worker can ship it.
export const MUSIC_FILE = "assets/dark_dungeon_ambience.mp3";

class AudioManager {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.ambient = null;
    this.settings = Object.assign(
      { master: 0.7, sfx: 0.9, music: 0.5, muted: false },
      this._load()
    );
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch { return {}; }
  }
  _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.settings)); }
    catch { /* ignore */ }
  }

  // Must be called from a user gesture (button click / keydown) to satisfy
  // browser autoplay policies. Safe to call repeatedly.
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this._applyVolumes();
    this.ready = true;
  }

  _applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;
    this.sfxGain.gain.value = this.settings.sfx;
    this.musicGain.gain.value = this.settings.music;
  }

  setMaster(v) { this.settings.master = v; this._applyVolumes(); this._save(); }
  setSfx(v) { this.settings.sfx = v; this._applyVolumes(); this._save(); }
  setMusic(v) { this.settings.music = v; this._applyVolumes(); this._save(); }
  setMuted(b) { this.settings.muted = b; this._applyVolumes(); this._save(); }
  toggleMute() { this.setMuted(!this.settings.muted); return this.settings.muted; }

  // ----------------------------------------------------------- synth helpers
  _tone({ freq = 440, type = "sine", dur = 0.15, gain = 0.3, slideTo = null, when = 0, attack = 0.005 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  _noise({ dur = 0.12, gain = 0.3, type = "bandpass", freq = 1000, q = 1, slideTo = null, when = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + when;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    filt.Q.value = q;
    if (slideTo) filt.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  // -------------------------------------------------------------- named SFX
  move()      { this._tone({ freq: 90, type: "square", dur: 0.05, gain: 0.05 }); }
  swing()     { this._noise({ dur: 0.12, gain: 0.16, type: "bandpass", freq: 1800, slideTo: 600, q: 0.7 }); }
  hit()       { this._tone({ freq: 210, type: "square", dur: 0.1, gain: 0.2, slideTo: 90 });
                this._noise({ dur: 0.05, gain: 0.1, type: "highpass", freq: 2600 }); }
  hurt()      { this._tone({ freq: 170, type: "sawtooth", dur: 0.18, gain: 0.22, slideTo: 70 }); }
  enemyDie()  { this._tone({ freq: 300, type: "sawtooth", dur: 0.28, gain: 0.18, slideTo: 70 }); }
  pickup()    { this._tone({ freq: 660, type: "sine", dur: 0.08, gain: 0.16 });
                this._tone({ freq: 990, type: "sine", dur: 0.1, gain: 0.14, when: 0.07 }); }
  potion()    { this._tone({ freq: 300, type: "sine", dur: 0.26, gain: 0.16, slideTo: 760 }); }
  levelUp()   { [523, 659, 784, 1046].forEach((f, i) =>
                  this._tone({ freq: f, type: "triangle", dur: 0.18, gain: 0.16, when: i * 0.09 })); }
  descend()   { this._tone({ freq: 420, type: "sine", dur: 0.5, gain: 0.16, slideTo: 120 });
                this._noise({ dur: 0.5, gain: 0.07, type: "lowpass", freq: 900, slideTo: 200 }); }
  playerDie() { [330, 247, 196, 131].forEach((f, i) =>
                  this._tone({ freq: f, type: "sawtooth", dur: 0.45, gain: 0.2, when: i * 0.18 })); }

  // ------------------------------------------------------------ ambient bed
  // `kind`: "dungeon" (default, the mp3 track) or "camp" (M19 — a brighter
  // procedural pad, kept file-free to avoid new licensing/build/precache
  // entries). Callers cross-fade by calling stopAmbient() then startAmbient()
  // with the new kind; stopAmbient clears `this.ambient` synchronously so the
  // new bed can start ramping in immediately while the old one fades out.
  startAmbient(kind = "dungeon") {
    if (!this.ready || this.ambient) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.musicGain);

    if (kind === "camp") {
      // Bright open-air pad: a detuned fifth + a shimmering octave through a
      // slow-sweeping lowpass — daylight to the dungeon drone's dark rumble.
      const filt = this.ctx.createBiquadFilter();
      filt.type = "lowpass";
      filt.frequency.value = 1500;
      filt.Q.value = 0.6;
      filt.connect(g);
      const o1 = this.ctx.createOscillator();
      o1.type = "triangle";
      o1.frequency.value = 220; // A3
      const o2 = this.ctx.createOscillator();
      o2.type = "triangle";
      o2.frequency.value = 220 * 1.5; // E4 — open fifth, consonant
      const o3 = this.ctx.createOscillator();
      o3.type = "sine";
      o3.frequency.value = 220 * 2.01; // gently-detuned octave shimmer
      o1.connect(filt); o2.connect(filt); o3.connect(filt);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 280;
      lfo.connect(lfoGain);
      lfoGain.connect(filt.frequency);
      o1.start(t); o2.start(t); o3.start(t); lfo.start(t);
      g.gain.linearRampToValueAtTime(0.32, t + 2.5);
      this.ambient = { o1, o2, o3, lfo, g, kind };
      return;
    }

    const el = new Audio(MUSIC_FILE);
    el.loop = true;
    const src = this.ctx.createMediaElementSource(el);
    src.connect(g);
    el.play().catch(() => {});
    g.gain.linearRampToValueAtTime(0.8, t + 2.5);
    this.ambient = { el, src, g, kind };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const { el, o1, o2, o3, lfo, g } = this.ambient;
    const t = this.ctx.currentTime;
    g.gain.linearRampToValueAtTime(0, t + 0.5);
    if (el) setTimeout(() => { try { el.pause(); } catch {} }, 600);
    [o1, o2, o3, lfo].forEach((o) => { if (o) try { o.stop(t + 0.6); } catch {} });
    this.ambient = null;
  }
}

export const audio = new AudioManager();
