import { emptyCampaign, normalizeCampaign, type Campaign } from "./progress";
import { type ScoreEntry } from "./scores";

const IDB_NAME = "neon-maze-save-db";
const IDB_VERSION = 1;
const IDB_STORE = "saves";
const LS_MIRROR = "neon-maze-save-db-mirror-v1";
const LS_ACTIVE = "neon-maze-active-save-id-v1";

export interface SaveRecord {
  id: string;
  campaign: Campaign;
  scores: ScoreEntry[];
  createdAt: number;
  updatedAt: number;
}

type Mirror = { saves: Record<string, SaveRecord> };

const cache = new Map<string, SaveRecord>();
let ready = false;

function readMirror(): Mirror {
  try {
    const raw = localStorage.getItem(LS_MIRROR);
    if (!raw) return { saves: {} };
    const parsed = JSON.parse(raw) as Mirror;
    if (!parsed || typeof parsed !== "object" || !parsed.saves) return { saves: {} };
    return { saves: parsed.saves };
  } catch {
    return { saves: {} };
  }
}

function writeMirror() {
  const saves: Record<string, SaveRecord> = {};
  cache.forEach((rec, id) => {
    saves[id] = rec;
  });
  try {
    localStorage.setItem(LS_MIRROR, JSON.stringify({ saves }));
  } catch {
    /* ignore quota */
  }
}

function normalizeScores(raw: unknown): ScoreEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => ({
      score: Math.floor(Number((s as ScoreEntry)?.score) || 0),
      level: Math.floor(Number((s as ScoreEntry)?.level) || 1),
      date: Number((s as ScoreEntry)?.date) || Date.now(),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function normalizeSaveId(raw: string): string | null {
  const id = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9-]{2,22}$/.test(id)) return null;
  return id;
}

export function generateSaveId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chunk = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
      ""
    );
  let id = `NEON-${chunk(4)}-${chunk(4)}`;
  let guard = 0;
  while (cache.has(id) && guard < 12) {
    id = `NEON-${chunk(4)}-${chunk(4)}`;
    guard++;
  }
  return id;
}

function normalizeRecord(raw: unknown): SaveRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<SaveRecord>;
  const id = typeof o.id === "string" ? normalizeSaveId(o.id) : null;
  if (!id) return null;
  return {
    id,
    campaign: normalizeCampaign(o.campaign),
    scores: normalizeScores(o.scores),
    createdAt: Number(o.createdAt) || Date.now(),
    updatedAt: Number(o.updatedAt) || Date.now(),
  };
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(): Promise<SaveRecord[]> {
  const db = await openIdb();
  if (!db) return [];
  try {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const rows = await idbReq(store.getAll());
    db.close();
    return Array.isArray(rows)
      ? rows.map(normalizeRecord).filter((r): r is SaveRecord => !!r)
      : [];
  } catch {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    return [];
  }
}

async function idbPut(record: SaveRecord): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, "readwrite");
    await idbReq(tx.objectStore(IDB_STORE).put(record));
    db.close();
  } catch {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export async function initDb(): Promise<void> {
  if (ready) return;
  const fromLs = readMirror();
  Object.values(fromLs.saves).forEach((raw) => {
    const rec = normalizeRecord(raw);
    if (rec) cache.set(rec.id, rec);
  });
  const fromIdb = await idbGetAll();
  for (const rec of fromIdb) {
    const existing = cache.get(rec.id);
    if (!existing || rec.updatedAt >= existing.updatedAt) {
      cache.set(rec.id, rec);
    }
  }
  writeMirror();
  ready = true;
}

export function getActiveId(): string | null {
  try {
    const raw = localStorage.getItem(LS_ACTIVE);
    if (!raw) return null;
    return normalizeSaveId(raw);
  } catch {
    return null;
  }
}

export function setActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  } catch {
    /* ignore */
  }
}

export function getSave(id: string): SaveRecord | null {
  const key = normalizeSaveId(id);
  if (!key) return null;
  return cache.get(key) ?? null;
}

export function listSaves(): SaveRecord[] {
  return Array.from(cache.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function hasSave(id: string): boolean {
  const key = normalizeSaveId(id);
  return !!key && cache.has(key);
}

export async function putSave(record: SaveRecord): Promise<SaveRecord> {
  const id = normalizeSaveId(record.id);
  if (!id) throw new Error("Invalid save ID");
  const prev = cache.get(id);
  const next: SaveRecord = {
    id,
    campaign: normalizeCampaign(record.campaign),
    scores: normalizeScores(record.scores),
    createdAt: prev?.createdAt ?? record.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  cache.set(id, next);
  writeMirror();
  await idbPut(next);
  return next;
}

export async function upsertProgress(
  id: string,
  campaign: Campaign,
  scores: ScoreEntry[]
): Promise<SaveRecord> {
  const key = normalizeSaveId(id);
  if (!key) throw new Error("Invalid save ID");
  const prev = cache.get(key);
  return putSave({
    id: key,
    campaign,
    scores,
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

export function emptySave(id: string): SaveRecord {
  const key = normalizeSaveId(id) ?? id;
  const now = Date.now();
  return {
    id: key,
    campaign: emptyCampaign(),
    scores: [],
    createdAt: now,
    updatedAt: now,
  };
}
