import { TOTAL_LEVELS } from "./levels";

const KEY = "neon-maze-campaign-v1";

export interface Campaign {
  unlocked: number;
  best: number[];
  cleared: boolean[];
}

export function emptyCampaign(): Campaign {
  return {
    unlocked: 1,
    best: Array.from({ length: TOTAL_LEVELS }, () => 0),
    cleared: Array.from({ length: TOTAL_LEVELS }, () => false),
  };
}

export function normalizeCampaign(raw: unknown): Campaign {
  const base = emptyCampaign();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<Campaign>;
  const unlocked = Math.max(
    1,
    Math.min(TOTAL_LEVELS, Math.floor(Number(o.unlocked) || 1))
  );
  const best = Array.from({ length: TOTAL_LEVELS }, (_, i) => {
    const n = Array.isArray(o.best) ? Number(o.best[i]) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  });
  const cleared = Array.from({ length: TOTAL_LEVELS }, (_, i) =>
    Array.isArray(o.cleared) ? Boolean(o.cleared[i]) : false
  );
  return { unlocked, best, cleared };
}

export function loadCampaign(): Campaign {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyCampaign();
    return normalizeCampaign(JSON.parse(raw));
  } catch {
    return emptyCampaign();
  }
}

export function saveCampaign(c: Campaign): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function applyClear(c: Campaign, level: number, score: number): Campaign {
  const next: Campaign = {
    unlocked: c.unlocked,
    best: [...c.best],
    cleared: [...c.cleared],
  };
  const i = level - 1;
  if (i < 0 || i >= TOTAL_LEVELS) return next;
  next.cleared[i] = true;
  next.best[i] = Math.max(next.best[i] ?? 0, Math.floor(score));
  if (level === next.unlocked && level < TOTAL_LEVELS) {
    next.unlocked = level + 1;
  }
  return next;
}

export function recommendedLevel(c: Campaign): number {
  for (let i = 0; i < c.unlocked; i++) {
    if (!c.cleared[i]) return i + 1;
  }
  return c.unlocked;
}

export function clearedCount(c: Campaign): number {
  return c.cleared.filter(Boolean).length;
}
