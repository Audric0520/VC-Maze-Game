export const TOTAL_LEVELS = 10;

export interface LevelDef {
  id: number;
  name: string;
  blurb: string;
  cols: number;
  rows: number;
  time: number;
  lives: number;
  boosts: number;
  debuffs: number;
  hunters: number;
  hunterSpeed: number;
}

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: "Spark",
    blurb: "Learn the maze. No hunters — just you and the exit.",
    cols: 7,
    rows: 6,
    time: 50,
    lives: 3,
    boosts: 4,
    debuffs: 1,
    hunters: 0,
    hunterSpeed: 0.48,
  },
  {
    id: 2,
    name: "Ember",
    blurb: "A hunter wakes. Grab boosts, stay moving.",
    cols: 8,
    rows: 6,
    time: 48,
    lives: 3,
    boosts: 4,
    debuffs: 2,
    hunters: 1,
    hunterSpeed: 0.5,
  },
  {
    id: 3,
    name: "Pulse",
    blurb: "More relics, more risk. Watch the traps.",
    cols: 9,
    rows: 7,
    time: 50,
    lives: 3,
    boosts: 5,
    debuffs: 3,
    hunters: 1,
    hunterSpeed: 0.52,
  },
  {
    id: 4,
    name: "Fangs",
    blurb: "Two hunters close in from the dark.",
    cols: 10,
    rows: 8,
    time: 52,
    lives: 3,
    boosts: 5,
    debuffs: 3,
    hunters: 2,
    hunterSpeed: 0.54,
  },
  {
    id: 5,
    name: "Coil",
    blurb: "The corridors grow. Don't get boxed in.",
    cols: 11,
    rows: 8,
    time: 54,
    lives: 3,
    boosts: 6,
    debuffs: 4,
    hunters: 2,
    hunterSpeed: 0.56,
  },
  {
    id: 6,
    name: "Static",
    blurb: "Three hunters. Time is not on your side.",
    cols: 12,
    rows: 9,
    time: 55,
    lives: 3,
    boosts: 6,
    debuffs: 4,
    hunters: 3,
    hunterSpeed: 0.58,
  },
  {
    id: 7,
    name: "Veil",
    blurb: "Fog and chaos. Trust your memory.",
    cols: 13,
    rows: 10,
    time: 56,
    lives: 3,
    boosts: 6,
    debuffs: 5,
    hunters: 3,
    hunterSpeed: 0.6,
  },
  {
    id: 8,
    name: "Volt",
    blurb: "A big maze and faster teeth. Commit.",
    cols: 14,
    rows: 11,
    time: 58,
    lives: 3,
    boosts: 7,
    debuffs: 5,
    hunters: 4,
    hunterSpeed: 0.63,
  },
  {
    id: 9,
    name: "Eclipse",
    blurb: "Almost there. Hunters don't miss.",
    cols: 15,
    rows: 12,
    time: 60,
    lives: 3,
    boosts: 7,
    debuffs: 6,
    hunters: 4,
    hunterSpeed: 0.66,
  },
  {
    id: 10,
    name: "Apex",
    blurb: "The core. Five hunters. One exit.",
    cols: 16,
    rows: 13,
    time: 62,
    lives: 3,
    boosts: 8,
    debuffs: 6,
    hunters: 5,
    hunterSpeed: 0.7,
  },
];

export function getLevel(id: number): LevelDef {
  const i = Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(id))) - 1;
  return LEVELS[i];
}
