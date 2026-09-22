export interface ScoreEntry {
  score: number;
  level: number;
  date: number;
}

const KEY = "neon-maze-highscores-v1";

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ScoreEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveScoreList(list: ScoreEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

export function applyScore(list: ScoreEntry[], entry: ScoreEntry): ScoreEntry[] {
  const next = [...list, entry];
  next.sort((a, b) => b.score - a.score);
  return next.slice(0, 8);
}

export function isHighScore(list: ScoreEntry[], score: number): boolean {
  if (score <= 0) return false;
  if (list.length < 8) return true;
  return score > list[list.length - 1].score;
}
