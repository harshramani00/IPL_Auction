// Auction sounds, generated in the browser (Web Audio) so there are no audio
// files to license, plus the auctioneer's voice (Web Speech). If you drop your
// own static/sounds/theme.mp3 in (it's git-ignored), it plays at the start
// instead of the built-in fanfare.

const STORAGE_KEY = "ar-sound";
const THEME_URL = "/sounds/theme.mp3";

type Effect = "fanfare" | "sting" | "tock" | "tick" | "gavel" | "cheer" | "thud" | "ping";

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private theme: HTMLAudioElement | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  enabled = readEnabled();
  /** Recent effects and lines, for debugging in the console (sound.log). */
  readonly log: string[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window === "undefined") return;
    // Browsers only allow audio after a user gesture: unlock on the first one.
    const unlock = () => this.audio()?.resume();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    this.loadTheme();
    if ("speechSynthesis" in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        this.voice = voices.find((v) => v.lang === "en-IN")
          ?? voices.find((v) => v.lang.startsWith("en-GB"))
          ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
      };
      pick();
      speechSynthesis.addEventListener?.("voiceschanged", pick);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try { localStorage.setItem(STORAGE_KEY, on ? "on" : "off"); } catch { /* private mode */ }
    if (!on) this.hush();
    else this.audio()?.resume();
    this.listeners.forEach((l) => l());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Stop the theme and any speech (e.g. when the hammer falls mid-sentence). */
  hush(): void {
    this.theme?.pause();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  play(effect: Effect): void {
    this.record(effect);
    if (!this.enabled) return;
    if (effect === "fanfare" && this.theme) {
      this.theme.currentTime = 0;
      void this.theme.play().catch(() => this.synth("fanfare"));
      return;
    }
    this.synth(effect);
  }

  /** Auctioneer's line. `interrupt` drops whatever he was still saying. */
  say(text: string, interrupt = true): void {
    this.record(`say: ${text}`);
    if (!this.enabled || !("speechSynthesis" in window)) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1.08;
    u.pitch = 0.95;
    speechSynthesis.speak(u);
  }

  private record(entry: string) {
    this.log.push(entry);
    if (this.log.length > 50) this.log.shift();
  }

  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  private async loadTheme() {
    try {
      // Missing files come back as the app's HTML page, so check the type.
      const res = await fetch(THEME_URL, { method: "HEAD" });
      if (res.ok && res.headers.get("content-type")?.startsWith("audio")) {
        this.theme = new Audio(THEME_URL);
        this.theme.volume = 0.7;
      }
    } catch { /* no theme: use the fanfare */ }
  }

  // ------------------------------------------------------------- synthesis

  private synth(effect: Effect): void {
    const ctx = this.audio();
    if (!ctx || !this.master || ctx.state !== "running") return;
    const t = ctx.currentTime;
    switch (effect) {
      case "fanfare": // brassy C-major arpeggio
        [523, 659, 784, 1047].forEach((f, i) => this.brass(f, t + i * 0.13, i === 3 ? 0.7 : 0.16));
        this.brass(523, t + 0.52, 0.7, 0.18);
        break;
      case "sting": // next player up
        this.brass(784, t, 0.12, 0.2);
        this.brass(1047, t + 0.1, 0.35, 0.2);
        break;
      case "tock": // paddle up
        this.tone(320, t, 0.09, 0.5, "triangle", 180);
        this.noise(t, 0.04, 0.25, 1800);
        break;
      case "tick": // clock warning
        this.tone(1900, t, 0.03, 0.25, "square");
        break;
      case "gavel": // two strikes on the block
        for (const at of [t, t + 0.18]) {
          this.tone(150, at, 0.22, 0.9, "sine", 55);
          this.noise(at, 0.06, 0.5, 900);
        }
        break;
      case "cheer": // crowd swell
        this.noise(t + 0.25, 2.2, 0.35, 1400, 0.6);
        this.noise(t + 0.35, 1.9, 0.2, 3000, 0.5);
        break;
      case "thud":
        this.tone(95, t, 0.3, 0.6, "sine", 60);
        break;
      case "ping": // you've been outbid
        this.tone(880, t, 0.12, 0.35, "sine");
        this.tone(1320, t + 0.11, 0.18, 0.35, "sine");
        break;
    }
  }

  private tone(freq: number, at: number, dur: number, vol: number, type: OscillatorType, endFreq?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  private brass(freq: number, at: number, dur: number, vol = 0.22) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, at);
    filter.frequency.linearRampToValueAtTime(3200, at + 0.06);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.03);
    gain.gain.setValueAtTime(vol, at + Math.max(0.04, dur - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    filter.connect(gain).connect(this.master!);
    for (const detune of [-6, 6]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    }
  }

  private noise(at: number, dur: number, vol: number, centre: number, attack = 0.005) {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = centre;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.05);
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export const sound = new Sound();
if (import.meta.env.DEV) (window as unknown as { sound: Sound }).sound = sound;
