// Tiny WebAudio synth for juicy blips. No assets required.
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

type Wave = "sine" | "square" | "triangle" | "sawtooth";

function tone(
  freq: number,
  dur: number,
  type: Wave = "sine",
  vol = 0.2,
  slideTo?: number
) {
  const a = ac();
  if (!a || muted) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, slideTo),
      a.currentTime + dur
    );
  }
  gain.gain.setValueAtTime(0.0001, a.currentTime);
  gain.gain.exponentialRampToValueAtTime(vol, a.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  osc.connect(gain);
  gain.connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + dur + 0.02);
}

export const sfx = {
  boost() {
    tone(520, 0.12, "triangle", 0.22, 880);
    setTimeout(() => tone(880, 0.1, "sine", 0.16), 60);
  },
  points() {
    tone(660, 0.09, "square", 0.16);
    setTimeout(() => tone(990, 0.12, "square", 0.16), 70);
  },
  debuff() {
    tone(220, 0.25, "sawtooth", 0.2, 90);
  },
  hit() {
    tone(160, 0.3, "square", 0.25, 60);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => tone(f, 0.15, "triangle", 0.2), i * 90)
    );
  },
  gameover() {
    [400, 300, 200, 120].forEach((f, i) =>
      setTimeout(() => tone(f, 0.25, "sawtooth", 0.2), i * 130)
    );
  },
  step() {
    tone(300, 0.03, "sine", 0.04);
  },
  ui() {
    tone(700, 0.06, "square", 0.12);
  },
};
