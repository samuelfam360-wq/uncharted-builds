// All of the game's sound, made in the browser as it plays (no sound files):
// short effects for what happens, and a looping tune for where you are.
// Nothing here does anything on the server or in tests (there is no window).

export type Sfx =
  | "swing"
  | "shoot"
  | "cast"
  | "hit"
  | "crit"
  | "miss"
  | "parry"
  | "block"
  | "hurt"
  | "defeat"
  | "die"
  | "levelup"
  | "unlock"
  | "pickup"
  | "eat"
  | "heal"
  | "jump"
  | "step"
  | "click"
  | "portal"
  | "tame"
  | "roar";

export type Track = "town" | "field" | "cave" | null;

export interface SoundSettings {
  music: number; // 0..1
  sfx: number; // 0..1
  muted: boolean;
}

const KEY = "ub-sound";
const DEFAULTS: SoundSettings = { music: 0.5, sfx: 0.7, muted: false };

let settings: SoundSettings = { ...DEFAULTS };
let loaded = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let echo: DelayNode | null = null;
let noise: AudioBuffer | null = null;
let track: Track = null;
let playing: Track = null;
let timer: ReturnType<typeof setInterval> | null = null;
let step = 0;
let nextAt = 0;
const lastPlayed = new Map<Sfx, number>();
const listeners = new Set<() => void>();

const hasWindow = () => typeof window !== "undefined";

function load() {
  if (loaded || !hasWindow()) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<SoundSettings>;
      const clamp = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
      settings = { music: clamp(s.music, DEFAULTS.music), sfx: clamp(s.sfx, DEFAULTS.sfx), muted: s.muted === true };
    }
  } catch {
    // no saved settings: keep the defaults
  }
}

export function getSound(): SoundSettings {
  load();
  return settings;
}

export function setSound(next: Partial<SoundSettings>) {
  load();
  settings = { ...settings, ...next };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // can't save here: the setting still holds until the page closes
  }
  applyVolumes();
  for (const fn of listeners) fn();
}

export function onSoundChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyVolumes() {
  if (!ctx || !sfxBus || !musicBus) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(settings.muted ? 0 : settings.sfx, t, 0.03);
  musicBus.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 0.55, t, 0.15);
}

/** The audio engine. Browsers only allow it after a click or a key press. */
function audio(): AudioContext | null {
  if (!hasWindow()) return null;
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  load();
  master = ctx.createGain();
  master.gain.value = 0.9;
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -14;
  squash.ratio.value = 6;
  master.connect(squash).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.connect(master);
  // a soft echo for the music
  echo = ctx.createDelay(1);
  echo.delayTime.value = 0.33;
  const back = ctx.createGain();
  back.gain.value = 0.32;
  const dull = ctx.createBiquadFilter();
  dull.type = "lowpass";
  dull.frequency.value = 2200;
  echo.connect(dull).connect(back).connect(echo);
  back.connect(musicBus);
  sfxBus.gain.value = settings.muted ? 0 : settings.sfx;
  musicBus.gain.value = settings.muted ? 0 : settings.music * 0.55;
  // one second of hiss, reused for every whoosh and thump
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function wake() {
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  startMusic();
}

if (hasWindow()) {
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, wake, { passive: true });
  // every button in the game clicks
  document.addEventListener(
    "click",
    (e) => {
      if ((e.target as Element | null)?.closest?.("button, [role=button], summary")) sfx("click");
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
}

// ---------- building blocks ----------

interface Tone {
  type?: OscillatorType;
  f: number; // start pitch (Hz)
  to?: number; // end pitch
  dur: number; // seconds
  vol?: number;
  at?: number; // delay from now
  attack?: number;
  out?: AudioNode;
}

function tone(c: AudioContext, o: Tone) {
  const t = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  const v = o.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(o.out ?? sfxBus!);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

interface Hiss {
  dur: number;
  vol?: number;
  at?: number;
  type?: BiquadFilterType;
  f: number; // filter pitch
  to?: number;
  q?: number;
  attack?: number;
  out?: AudioNode;
}

function hiss(c: AudioContext, o: Hiss) {
  if (!noise) return;
  const t = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = o.type ?? "bandpass";
  flt.Q.value = o.q ?? 1;
  flt.frequency.setValueAtTime(o.f, t);
  if (o.to) flt.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + o.dur);
  const g = c.createGain();
  const v = o.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(flt).connect(g).connect(o.out ?? sfxBus!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + o.dur + 0.02);
}

const note = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// ---------- effects ----------

/** The shortest gap between two of the same sound, so a crowd of hits doesn't turn into a roar. */
const GAP: Partial<Record<Sfx, number>> = { hit: 45, step: 120, hurt: 120, swing: 60, miss: 80, heal: 200, block: 80, defeat: 60, pickup: 60 };

const RECIPES: Record<Sfx, (c: AudioContext) => void> = {
  swing: (c) => hiss(c, { dur: 0.16, f: 900, to: 2600, q: 1.4, vol: 0.22, attack: 0.03 }),
  shoot: (c) => {
    tone(c, { type: "square", f: 880, to: 220, dur: 0.11, vol: 0.12 });
    hiss(c, { dur: 0.08, f: 3000, vol: 0.12, type: "highpass" });
  },
  cast: (c) => {
    tone(c, { type: "triangle", f: 420, to: 1260, dur: 0.28, vol: 0.16, attack: 0.03 });
    tone(c, { type: "sine", f: 840, to: 1680, dur: 0.3, vol: 0.08, at: 0.04 });
    hiss(c, { dur: 0.3, f: 2500, to: 6000, vol: 0.06, attack: 0.08 });
  },
  hit: (c) => {
    tone(c, { type: "triangle", f: 190, to: 70, dur: 0.1, vol: 0.38 });
    hiss(c, { dur: 0.06, f: 1700, q: 0.8, vol: 0.26 });
  },
  crit: (c) => {
    tone(c, { type: "triangle", f: 240, to: 55, dur: 0.18, vol: 0.45 });
    hiss(c, { dur: 0.1, f: 2400, q: 0.7, vol: 0.32 });
    tone(c, { type: "square", f: 1320, to: 1980, dur: 0.12, vol: 0.09, at: 0.02 });
  },
  miss: (c) => hiss(c, { dur: 0.12, f: 2200, to: 700, q: 2, vol: 0.1, attack: 0.02 }),
  parry: (c) => {
    tone(c, { type: "triangle", f: 1568, dur: 0.35, vol: 0.2 });
    tone(c, { type: "sine", f: 2349, dur: 0.45, vol: 0.14 });
    tone(c, { type: "sine", f: 3136, dur: 0.3, vol: 0.07, at: 0.02 });
    hiss(c, { dur: 0.05, f: 5000, type: "highpass", vol: 0.2 });
  },
  block: (c) => {
    tone(c, { type: "square", f: 150, to: 90, dur: 0.09, vol: 0.2 });
    hiss(c, { dur: 0.07, f: 800, q: 0.7, vol: 0.28 });
  },
  hurt: (c) => {
    tone(c, { type: "sawtooth", f: 300, to: 110, dur: 0.2, vol: 0.2 });
    hiss(c, { dur: 0.09, f: 500, q: 0.6, vol: 0.25 });
  },
  defeat: (c) => {
    tone(c, { type: "square", f: 520, to: 130, dur: 0.22, vol: 0.14 });
    hiss(c, { dur: 0.22, f: 1400, to: 300, q: 0.8, vol: 0.18, attack: 0.01 });
    tone(c, { type: "sine", f: 1046, dur: 0.12, vol: 0.1, at: 0.16 });
  },
  die: (c) => {
    [392, 330, 262, 196].forEach((f, i) => tone(c, { type: "triangle", f, dur: 0.34, vol: 0.22, at: i * 0.2, attack: 0.02 }));
    tone(c, { type: "sine", f: 98, dur: 1.1, vol: 0.2, at: 0.6, attack: 0.05 });
  },
  levelup: (c) => {
    [60, 64, 67, 72, 76].forEach((m, i) => {
      tone(c, { type: "square", f: note(m), dur: 0.2, vol: 0.11, at: i * 0.09 });
      tone(c, { type: "triangle", f: note(m + 12), dur: 0.24, vol: 0.1, at: i * 0.09 });
    });
    tone(c, { type: "triangle", f: note(84), dur: 0.7, vol: 0.14, at: 0.45, attack: 0.02 });
  },
  unlock: (c) => {
    tone(c, { type: "sine", f: note(45), dur: 1.6, vol: 0.2, attack: 0.2 });
    [57, 64, 69, 73, 76, 81].forEach((m, i) => tone(c, { type: "triangle", f: note(m), dur: 1.2 - i * 0.1, vol: 0.13, at: 0.15 + i * 0.13, attack: 0.02 }));
    hiss(c, { dur: 1.4, f: 3000, to: 9000, vol: 0.05, attack: 0.5, type: "highpass" });
  },
  pickup: (c) => {
    tone(c, { type: "square", f: note(79), dur: 0.07, vol: 0.1 });
    tone(c, { type: "square", f: note(84), dur: 0.14, vol: 0.1, at: 0.06 });
  },
  eat: (c) => {
    hiss(c, { dur: 0.07, f: 1200, q: 2, vol: 0.2 });
    hiss(c, { dur: 0.07, f: 900, q: 2, vol: 0.2, at: 0.13 });
    tone(c, { type: "sine", f: 520, to: 780, dur: 0.16, vol: 0.1, at: 0.24 });
  },
  heal: (c) => [72, 76, 79].forEach((m, i) => tone(c, { type: "sine", f: note(m), dur: 0.35, vol: 0.12, at: i * 0.07, attack: 0.03 })),
  jump: (c) => tone(c, { type: "sine", f: 260, to: 620, dur: 0.14, vol: 0.12 }),
  step: (c) => hiss(c, { dur: 0.05, f: 320 + Math.random() * 160, q: 1.2, vol: 0.09, type: "lowpass" }),
  click: (c) => tone(c, { type: "square", f: 660, to: 880, dur: 0.05, vol: 0.07 }),
  portal: (c) => {
    tone(c, { type: "sine", f: 220, to: 880, dur: 0.6, vol: 0.14, attack: 0.1 });
    hiss(c, { dur: 0.7, f: 500, to: 5000, q: 2, vol: 0.12, attack: 0.3 });
  },
  tame: (c) => [67, 72, 76, 79, 84].forEach((m, i) => tone(c, { type: "triangle", f: note(m), dur: 0.3, vol: 0.13, at: i * 0.08 })),
  roar: (c) => {
    tone(c, { type: "sawtooth", f: 140, to: 60, dur: 0.5, vol: 0.2, attack: 0.05 });
    hiss(c, { dur: 0.5, f: 400, to: 150, q: 0.8, vol: 0.2, attack: 0.05 });
  },
};

/** Play one effect. Safe to call anywhere, any number of times. */
export function sfx(name: Sfx) {
  if (!ctx || ctx.state !== "running" || settings.muted || settings.sfx <= 0) return;
  const now = ctx.currentTime * 1000;
  const gap = GAP[name] ?? 30;
  if (now - (lastPlayed.get(name) ?? -1e9) < gap) return;
  lastPlayed.set(name, now);
  try {
    RECIPES[name](ctx);
  } catch {
    // a sound that fails must never stop the game
  }
}

// ---------- music ----------

interface Song {
  bpm: number;
  /** Each chord lasts one bar: the notes of the pad, lowest first. */
  chords: number[][];
  /** The tune, 16 steps a bar: a note number, or 0 for a rest. One row per bar. */
  lead: number[][];
  leadType: OscillatorType;
  leadVol: number;
  arp: boolean;
  beat: "soft" | "walk" | "tense";
  bright: number; // pad filter (Hz)
}

const _ = 0;
const SONGS: Record<Exclude<Track, null>, Song> = {
  // calm and warm: home
  town: {
    bpm: 84,
    chords: [
      [48, 55, 60, 64],
      [45, 52, 57, 60],
      [41, 53, 57, 60],
      [43, 50, 59, 62],
    ],
    lead: [
      [76, _, _, _, 72, _, _, _, 79, _, _, _, 76, _, 74, _],
      [72, _, _, _, 69, _, _, _, 76, _, _, _, 72, _, _, _],
      [69, _, _, _, 72, _, _, _, 77, _, _, _, 76, _, 72, _],
      [74, _, _, _, 71, _, _, _, 67, _, _, _, _, _, _, _],
    ],
    leadType: "sine",
    leadVol: 0.1,
    arp: true,
    beat: "soft",
    bright: 1100,
  },
  // bright and bouncy: out exploring
  field: {
    bpm: 112,
    chords: [
      [50, 57, 62, 66],
      [47, 54, 59, 62],
      [43, 55, 59, 62],
      [45, 52, 57, 61],
    ],
    lead: [
      [78, _, 74, _, 69, _, 74, _, 78, _, 81, _, 78, _, 74, _],
      [74, _, 71, _, 66, _, 71, _, 74, _, 78, _, 74, _, _, _],
      [71, _, 74, _, 79, _, 74, _, 71, _, 74, _, 79, _, 83, _],
      [81, _, 76, _, 73, _, 76, _, 81, _, _, _, 76, _, _, _],
    ],
    leadType: "square",
    leadVol: 0.05,
    arp: true,
    beat: "walk",
    bright: 1600,
  },
  // low and uneasy: the cave and its boss
  cave: {
    bpm: 96,
    chords: [
      [38, 50, 53, 57],
      [38, 50, 53, 58],
      [34, 46, 50, 53],
      [33, 45, 49, 52],
    ],
    lead: [
      [62, _, _, _, _, _, 65, _, _, _, 64, _, _, _, _, _],
      [62, _, _, _, _, _, 70, _, _, _, 69, _, _, _, _, _],
      [65, _, _, _, _, _, 62, _, _, _, 58, _, _, _, _, _],
      [61, _, _, _, _, _, 64, _, _, _, 57, _, _, _, _, _],
    ],
    leadType: "triangle",
    leadVol: 0.09,
    arp: false,
    beat: "tense",
    bright: 700,
  },
};

function musicNote(c: AudioContext, t: number, midi: number, dur: number, vol: number, type: OscillatorType, cutoff: number, wet: number, attack = 0.01) {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = note(midi);
  const flt = c.createBiquadFilter();
  flt.type = "lowpass";
  flt.frequency.value = cutoff;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(flt).connect(g);
  g.connect(musicBus!);
  if (wet > 0 && echo) {
    const send = c.createGain();
    send.gain.value = wet;
    g.connect(send).connect(echo);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function drum(c: AudioContext, t: number, kind: "kick" | "hat" | "snare", vol: number) {
  const at = t - c.currentTime;
  if (kind === "kick") tone(c, { type: "sine", f: 130, to: 42, dur: 0.22, vol, at, out: musicBus! });
  else if (kind === "hat") hiss(c, { dur: 0.04, f: 7000, type: "highpass", vol, at, out: musicBus! });
  else hiss(c, { dur: 0.12, f: 1800, q: 0.7, vol, at, out: musicBus! });
}

function schedule(c: AudioContext, song: Song, s: number, t: number) {
  const stepLen = 60 / song.bpm / 4;
  const bar = Math.floor(s / 16) % song.chords.length;
  const i = s % 16;
  const chord = song.chords[bar];
  if (i === 0) {
    // the pad holds the whole bar; the bass sits under it
    const len = stepLen * 16;
    for (const m of chord.slice(1)) {
      musicNote(c, t, m, len * 1.02, 0.045, "sawtooth", song.bright, 0.15, 0.25);
      musicNote(c, t, m + 0.08, len * 1.02, 0.03, "triangle", song.bright, 0, 0.25);
    }
  }
  const bassOn = song.beat === "tense" ? i === 0 || i === 6 || i === 10 : song.beat === "walk" ? i % 4 === 0 || i === 10 : i === 0 || i === 8;
  if (bassOn) musicNote(c, t, chord[0] + (song.beat === "walk" && i === 10 ? 7 : 0), stepLen * 3, 0.16, "triangle", 500, 0);
  if (song.arp && i % 2 === 0) {
    const up = chord.slice(1);
    const m = up[(i / 2) % up.length] + 12;
    musicNote(c, t, m, stepLen * 1.6, 0.035, "triangle", 2400, 0.5);
  }
  const m = song.lead[bar][i];
  if (m) musicNote(c, t, m, stepLen * (song.beat === "tense" ? 5 : 2.6), song.leadVol, song.leadType, 2600, 0.6, 0.015);
  if (song.beat === "walk") {
    if (i % 8 === 0) drum(c, t, "kick", 0.3);
    if (i % 8 === 4) drum(c, t, "snare", 0.07);
    if (i % 2 === 0) drum(c, t, "hat", i % 4 === 2 ? 0.05 : 0.025);
  } else if (song.beat === "tense") {
    if (i === 0 || i === 6 || i === 10) drum(c, t, "kick", 0.32);
    if (i % 4 === 2) drum(c, t, "hat", 0.03);
  } else if (i % 4 === 2) drum(c, t, "hat", 0.018);
}

function startMusic() {
  if (!ctx || ctx.state !== "running") return;
  if (playing === track) return;
  playing = track;
  step = 0;
  nextAt = ctx.currentTime + 0.25;
  if (timer) clearInterval(timer);
  timer = null;
  if (!track) return;
  // a slow fallback: the game's own frames keep the tune fed (browsers slow timers down at times)
  timer = setInterval(pump, 100);
}

/** Queue the next few notes of the tune. */
function pump() {
  if (!ctx || !playing || ctx.state !== "running") return;
  const song = SONGS[playing];
  const stepLen = 60 / song.bpm / 4;
  // after a pause (a hidden tab), start again from now instead of catching up
  if (nextAt < ctx.currentTime - 0.3) nextAt = ctx.currentTime + 0.1;
  const quiet = settings.muted || settings.music <= 0;
  while (nextAt < ctx.currentTime + 0.4) {
    if (!quiet) {
      try {
        schedule(ctx, song, step, nextAt);
      } catch {
        // skip a beat rather than stop
      }
    }
    step++;
    nextAt += stepLen;
  }
}

/** Choose the tune for where the player is. It starts once the player has clicked or pressed a key. */
export function setMusic(next: Track) {
  if (next === track) return pump();
  track = next;
  startMusic();
}

/** For tests: whether the engine is running and which tune is on. */
export function soundState() {
  return { running: ctx?.state === "running", track, playing, step, time: ctx?.currentTime ?? 0 };
}
