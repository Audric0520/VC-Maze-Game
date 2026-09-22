export type ArtifactKind =
  | "speed"
  | "shield"
  | "freeze"
  | "points"
  | "slow"
  | "reverse"
  | "fog";

export interface ArtifactMeta {
  kind: ArtifactKind;
  boost: boolean;
  label: string;
  icon: string;
  color: string;
}

export const ARTIFACTS: Record<ArtifactKind, ArtifactMeta> = {
  speed: { kind: "speed", boost: true, label: "Speed", icon: "⚡", color: "#34d399" },
  shield: { kind: "shield", boost: true, label: "Shield", icon: "🛡️", color: "#38bdf8" },
  freeze: { kind: "freeze", boost: true, label: "Freeze", icon: "❄️", color: "#a5f3fc" },
  points: { kind: "points", boost: true, label: "Bonus", icon: "💎", color: "#fbbf24" },
  slow: { kind: "slow", boost: false, label: "Slow", icon: "🕸️", color: "#f472b6" },
  reverse: { kind: "reverse", boost: false, label: "Chaos", icon: "🌀", color: "#c084fc" },
  fog: { kind: "fog", boost: false, label: "Fog", icon: "🌫️", color: "#94a3b8" },
};

export interface ActiveEffect {
  kind: ArtifactKind;
  remaining: number;
  duration: number;
}

export interface HudState {
  score: number;
  level: number;
  levelName: string;
  lives: number;
  time: number;
  timeMax: number;
  effects: ActiveEffect[];
  combo: number;
}

export type GameStatus = "start" | "playing" | "paused" | "gameover";
