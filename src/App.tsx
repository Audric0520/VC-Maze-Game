import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine } from "./game/engine";
import { LEVELS, TOTAL_LEVELS, getLevel } from "./game/levels";
import {
  applyClear,
  clearedCount,
  emptyCampaign,
  loadCampaign,
  recommendedLevel,
  saveCampaign,
  type Campaign,
} from "./game/progress";
import { ARTIFACTS, type ArtifactKind, type HudState } from "./game/types";
import {
  applyScore,
  isHighScore,
  loadScores,
  saveScoreList,
  type ScoreEntry,
} from "./game/scores";
import {
  generateSaveId,
  getActiveId,
  getSave,
  hasSave,
  initDb,
  listSaves,
  normalizeSaveId,
  setActiveId,
  upsertProgress,
  type SaveRecord,
} from "./game/db";
import { isMuted, setMuted, sfx } from "./game/sound";

type Screen =
  | "start"
  | "saves"
  | "levels"
  | "playing"
  | "paused"
  | "gameover"
  | "levelclear"
  | "victory";

const emptyHud: HudState = {
  score: 0,
  level: 1,
  levelName: "Spark",
  lives: 3,
  time: 0,
  timeMax: 50,
  effects: [],
  combo: 0,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [screen, setScreen] = useState<Screen>("start");
  const [hud, setHud] = useState<HudState>(emptyHud);
  const [scores, setScores] = useState<ScoreEntry[]>([]);
  const [campaign, setCampaign] = useState<Campaign>(emptyCampaign);
  const [currentLevel, setCurrentLevel] = useState(1);
  const [lastRun, setLastRun] = useState({
    score: 0,
    level: 1,
    unlockedNext: false,
    levelBest: false,
  });
  const [newHigh, setNewHigh] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [saveId, setSaveId] = useState<string | null>(null);
  const [saveInput, setSaveInput] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [knownSaves, setKnownSaves] = useState<SaveRecord[]>([]);
  const [toasts, setToasts] = useState<
    { id: number; kind: ArtifactKind; duration: number }[]
  >([]);
  const toastSeq = useRef(0);
  const pickupRef = useRef<(kind: ArtifactKind, duration: number) => void>(
    () => {}
  );

  const screenRef = useRef<Screen>("start");
  screenRef.current = screen;
  const currentLevelRef = useRef(1);
  currentLevelRef.current = currentLevel;
  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;
  const scoresRef = useRef(scores);
  scoresRef.current = scores;
  const saveIdRef = useRef<string | null>(null);
  saveIdRef.current = saveId;

  pickupRef.current = (kind, duration) => {
    const id = ++toastSeq.current;
    setToasts((prev) => {
      const rest = prev.filter((t) => t.kind !== kind);
      return [...rest, { id, kind, duration }];
    });
    if (duration <= 0) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2400);
    }
  };

  const persist = useCallback((c: Campaign, sc: ScoreEntry[]) => {
    const id = saveIdRef.current;
    if (id) {
      void upsertProgress(id, c, sc).then(() => setKnownSaves(listSaves()));
    } else {
      saveCampaign(c);
      saveScoreList(sc);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initDb();
      if (cancelled) return;
      const active = getActiveId();
      if (active) {
        const rec = getSave(active);
        if (rec) {
          setSaveId(rec.id);
          saveIdRef.current = rec.id;
          setCampaign(rec.campaign);
          setScores(rec.scores);
        } else {
          setCampaign(loadCampaign());
          setScores(loadScores());
        }
      } else {
        setCampaign(loadCampaign());
        setScores(loadScores());
      }
      setKnownSaves(listSaves());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new GameEngine(canvasRef.current, {
      onHud: (h) => setHud(h),
      onLevelComplete: (level, score) => {
        const prev = campaignRef.current;
        const prevBest = prev.best[level - 1] ?? 0;
        const prevUnlocked = prev.unlocked;
        const next = applyClear(prev, level, score);
        const nextScores = applyScore(scoresRef.current, {
          score,
          level,
          date: Date.now(),
        });
        setCampaign(next);
        setScores(nextScores);
        persist(next, nextScores);
        setLastRun({
          score,
          level,
          unlockedNext: next.unlocked > prevUnlocked,
          levelBest: score > prevBest,
        });
        setNewHigh(isHighScore(scoresRef.current, score));
        if (level >= TOTAL_LEVELS) setScreen("victory");
        else setScreen("levelclear");
      },
      onGameOver: (score, level) => {
        const nextScores = applyScore(scoresRef.current, {
          score,
          level,
          date: Date.now(),
        });
        setScores(nextScores);
        persist(campaignRef.current, nextScores);
        setLastRun({
          score,
          level,
          unlockedNext: false,
          levelBest: false,
        });
        setNewHigh(isHighScore(scoresRef.current, score));
        setScreen("gameover");
      },
      onPickup: (kind, duration) => pickupRef.current(kind, duration),
    });
    engineRef.current = engine;

    const ro = new ResizeObserver(() => engine.resize());
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", () => engine.resize());

    return () => {
      engine.stop();
      ro.disconnect();
    };
  }, []);

  const playLevel = useCallback((n: number) => {
    if (n < 1 || n > TOTAL_LEVELS) return;
    if (n > campaignRef.current.unlocked) return;
    sfx.ui();
    setCurrentLevel(n);
    setToasts([]);
    engineRef.current?.resize();
    engineRef.current?.start(n);
    setScreen("playing");
  }, []);

  const openLevels = useCallback(() => {
    sfx.ui();
    engineRef.current?.stop();
    setToasts([]);
    setScreen("levels");
  }, []);

  const goStart = useCallback(() => {
    sfx.ui();
    engineRef.current?.stop();
    setToasts([]);
    setScreen("start");
  }, []);

  const playRecommended = useCallback(() => {
    playLevel(recommendedLevel(campaignRef.current));
  }, [playLevel]);

  const retryLevel = useCallback(() => {
    playLevel(currentLevelRef.current);
  }, [playLevel]);

  const playNext = useCallback(() => {
    playLevel(Math.min(TOTAL_LEVELS, currentLevelRef.current + 1));
  }, [playLevel]);

  const openSaves = useCallback(() => {
    sfx.ui();
    engineRef.current?.stop();
    setToasts([]);
    setSaveMsg("");
    setSaveInput(saveIdRef.current ?? "");
    setKnownSaves(listSaves());
    setScreen("saves");
  }, []);

  const applyRecord = (rec: SaveRecord, msg: string) => {
    setSaveId(rec.id);
    saveIdRef.current = rec.id;
    setActiveId(rec.id);
    setCampaign(rec.campaign);
    setScores(rec.scores);
    setSaveInput(rec.id);
    setSaveMsg(msg);
    setKnownSaves(listSaves());
  };

  const handleGenerateId = async () => {
    sfx.ui();
    const id = generateSaveId();
    const rec = await upsertProgress(id, campaignRef.current, scoresRef.current);
    applyRecord(rec, "New save ID created. Keep this code to load later.");
  };

  const handleLoadId = async () => {
    sfx.ui();
    const id = normalizeSaveId(saveInput);
    if (!id) {
      setSaveMsg("Enter a valid ID (letters, numbers, hyphens).");
      return;
    }
    const rec = getSave(id);
    if (!rec) {
      setSaveMsg("No save found for that ID.");
      return;
    }
    applyRecord(
      rec,
      `Loaded ${rec.id} · ${clearedCount(rec.campaign)}/${TOTAL_LEVELS} cleared.`
    );
  };

  const handleCreateId = async () => {
    sfx.ui();
    const id = normalizeSaveId(saveInput);
    if (!id) {
      setSaveMsg("Pick an ID of 3–23 letters, numbers, or hyphens.");
      return;
    }
    if (hasSave(id)) {
      setSaveMsg("That ID already exists. Use Load instead.");
      return;
    }
    const rec = await upsertProgress(id, campaignRef.current, scoresRef.current);
    applyRecord(rec, `Save ID ${rec.id} created with your current progress.`);
  };

  const handleCopyId = async () => {
    const id = saveIdRef.current;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setSaveMsg("Copy failed — select the ID and copy it manually.");
    }
  };

  useEffect(() => {
    const setDir = (code: string, on: boolean) => {
      const e = engineRef.current;
      if (!e) return;
      switch (code) {
        case "ArrowUp":
        case "KeyW":
          e.input.up = on;
          break;
        case "ArrowDown":
        case "KeyS":
          e.input.down = on;
          break;
        case "ArrowLeft":
        case "KeyA":
          e.input.left = on;
          break;
        case "ArrowRight":
        case "KeyD":
          e.input.right = on;
          break;
      }
    };
    const down = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if (
        !typing &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
          ev.code
        )
      )
        ev.preventDefault();
      if (ev.code === "KeyP" || ev.code === "Escape") {
        if (typing) return;
        const s = screenRef.current;
        if (s === "playing" || s === "paused") togglePause();
        else if (s === "levels" || s === "saves") goStart();
        return;
      }
      if (ev.code === "Space") {
        if (typing) return;
        const s = screenRef.current;
        if (s === "start") playRecommended();
        else if (s === "levelclear") playNext();
        else if (s === "gameover") retryLevel();
        else if (s === "victory") openLevels();
        return;
      }
      if (typing) return;
      setDir(ev.code, true);
    };
    const up = (ev: KeyboardEvent) => setDir(ev.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setToasts((prev) => {
      const next = prev.filter(
        (t) => t.duration <= 0 || hud.effects.some((e) => e.kind === t.kind)
      );
      return next.length === prev.length ? prev : next;
    });
  }, [hud.effects]);

  const togglePause = useCallback(() => {
    const s = screenRef.current;
    if (s === "playing") {
      engineRef.current?.setPaused(true);
      setScreen("paused");
      sfx.ui();
    } else if (s === "paused") {
      engineRef.current?.setPaused(false);
      setScreen("playing");
      sfx.ui();
    }
  }, []);

  const toggleMute = () => {
    const m = !isMuted();
    setMuted(m);
    setMutedState(m);
  };

  const hold = (dir: "up" | "down" | "left" | "right", on: boolean) => {
    const e = engineRef.current;
    if (e) e.input[dir] = on;
  };

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let sx = 0,
      sy = 0,
      active = false;
    const start = (x: number, y: number) => {
      sx = x;
      sy = y;
      active = true;
    };
    const move = (x: number, y: number) => {
      if (!active) return;
      const dx = x - sx;
      const dy = y - sy;
      const e = engineRef.current;
      if (!e) return;
      const th = 18;
      e.input.up = false;
      e.input.down = false;
      e.input.left = false;
      e.input.right = false;
      if (Math.abs(dx) > th || Math.abs(dy) > th) {
        if (Math.abs(dx) > Math.abs(dy)) {
          e.input.left = dx < 0;
          e.input.right = dx > 0;
        } else {
          e.input.up = dy < 0;
          e.input.down = dy > 0;
        }
      }
    };
    const end = () => {
      active = false;
      const e = engineRef.current;
      if (e) {
        e.input.up = e.input.down = e.input.left = e.input.right = false;
      }
    };
    const ts = (ev: TouchEvent) => {
      const t = ev.touches[0];
      start(t.clientX, t.clientY);
    };
    const tm = (ev: TouchEvent) => {
      const t = ev.touches[0];
      move(t.clientX, t.clientY);
    };
    cv.addEventListener("touchstart", ts, { passive: true });
    cv.addEventListener("touchmove", tm, { passive: true });
    cv.addEventListener("touchend", end, { passive: true });
    return () => {
      cv.removeEventListener("touchstart", ts);
      cv.removeEventListener("touchmove", tm);
      cv.removeEventListener("touchend", end);
    };
  }, []);

  const timePct = hud.timeMax > 0 ? Math.min(1, hud.time / hud.timeMax) : 0;
  const lowTime = hud.time <= 10 && screen === "playing";
  const rec = recommendedLevel(campaign);
  const recDef = getLevel(rec);
  const done = clearedCount(campaign);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#080a18] font-sans text-white select-none">
      <header className="z-20 flex items-center gap-2 px-3 py-2 sm:gap-4 sm:px-5 sm:py-3">
        <div className="flex flex-1 items-center gap-2 sm:gap-4">
          <Stat label="SCORE" value={hud.score.toLocaleString()} accent="#22d3ee" />
          <Stat
            label="LEVEL"
            value={`${hud.level}/${TOTAL_LEVELS}`}
            accent="#a78bfa"
          />
          <div className="hidden text-xs font-semibold tracking-wide text-violet-200/80 sm:block">
            {hud.levelName}
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <span
                key={i}
                className="text-lg transition-transform"
                style={{
                  filter: i < hud.lives ? "none" : "grayscale(1) opacity(0.3)",
                }}
              >
                💠
              </span>
            ))}
          </div>
          {hud.combo > 1 && (
            <span className="animate-pulse rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">
              x{hud.combo} COMBO
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openSaves}
            className="max-w-[7.5rem] truncate rounded-lg bg-white/5 px-2 py-1.5 text-[10px] font-bold tracking-wider text-cyan-200 transition hover:bg-white/10 sm:max-w-[9.5rem]"
            title="Save / Load"
          >
            {saveId ?? "NO SAVE ID"}
          </button>
          <button
            onClick={toggleMute}
            className="rounded-lg bg-white/5 px-2 py-1.5 text-sm transition hover:bg-white/10"
            aria-label="Toggle sound"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          {(screen === "playing" || screen === "paused") && (
            <button
              onClick={togglePause}
              className="rounded-lg bg-white/5 px-3 py-1.5 text-sm font-semibold transition hover:bg-white/10"
            >
              {screen === "paused" ? "▶" : "❚❚"}
            </button>
          )}
        </div>
      </header>

      <div className="z-20 mx-3 mb-1 h-1.5 overflow-hidden rounded-full bg-white/10 sm:mx-5">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${
            lowTime ? "animate-pulse" : ""
          }`}
          style={{
            width: `${timePct * 100}%`,
            background: lowTime
              ? "linear-gradient(90deg,#f43f5e,#fb7185)"
              : "linear-gradient(90deg,#22d3ee,#a78bfa)",
          }}
        />
      </div>

      {screen !== "start" && screen !== "levels" && toasts.length > 0 && (
        <div className="pointer-events-none absolute right-3 top-20 z-20 flex w-[min(17rem,calc(100%-1.5rem))] flex-col gap-2 sm:right-5 sm:top-24">
          {toasts.map((t) => {
            const m = ARTIFACTS[t.kind];
            const active = hud.effects.find((e) => e.kind === t.kind);
            const remaining = active ? active.remaining : t.duration;
            const pct =
              t.duration > 0 ? Math.max(0, Math.min(1, remaining / t.duration)) : 1;
            return (
              <div
                key={t.id}
                className="toast-in overflow-hidden rounded-2xl border border-white/15 bg-[#080a18]/55 p-3 shadow-lg shadow-black/40 backdrop-blur-md"
                style={{ boxShadow: `0 0 24px ${m.color}22` }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl"
                    style={{
                      background: `${m.color}22`,
                      border: `1px solid ${m.color}55`,
                    }}
                  >
                    {m.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-black tracking-wide">
                        {m.label}
                      </span>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase"
                        style={{
                          background: m.boost ? "#34d39922" : "#f43f5e22",
                          color: m.boost ? "#6ee7b7" : "#fda4af",
                        }}
                      >
                        {m.boost ? "Boost" : "Debuff"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-white/50">
                      {t.duration > 0 ? "Active effect" : "Instant bonus"}
                    </div>
                  </div>
                  <div
                    className="shrink-0 text-right font-black tabular-nums leading-none"
                    style={{ color: m.color }}
                  >
                    {t.duration > 0 ? (
                      <>
                        <div className="text-lg">{remaining.toFixed(1)}</div>
                        <div className="mt-0.5 text-[10px] font-bold tracking-widest text-white/40">
                          SEC
                        </div>
                      </>
                    ) : (
                      <div className="text-sm">+</div>
                    )}
                  </div>
                </div>
                {t.duration > 0 && (
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct * 100}%`,
                        background: m.color,
                        boxShadow: `0 0 8px ${m.color}`,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div ref={wrapRef} className="relative flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
        />

        {screen === "playing" && (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="pointer-events-auto absolute bottom-4 left-4 grid grid-cols-3 grid-rows-3 gap-1.5 opacity-80 sm:bottom-6 sm:left-6">
              <span />
              <DPad dir="up" onHold={hold}>
                ▲
              </DPad>
              <span />
              <DPad dir="left" onHold={hold}>
                ◀
              </DPad>
              <span />
              <DPad dir="right" onHold={hold}>
                ▶
              </DPad>
              <span />
              <DPad dir="down" onHold={hold}>
                ▼
              </DPad>
              <span />
            </div>
          </div>
        )}

        {screen === "start" && (
          <Overlay>
            <div className="text-center">
              <h1 className="bg-gradient-to-r from-cyan-300 via-violet-300 to-fuchsia-300 bg-clip-text text-5xl font-black tracking-tight text-transparent drop-shadow sm:text-7xl">
                NEON MAZE
              </h1>
              <p className="mt-3 text-sm text-white/60 sm:text-base">
                10 levels. Unlock the next by clearing the one before it.
              </p>
              <div className="mt-3 text-xs font-bold tracking-widest text-violet-300">
                {done}/{TOTAL_LEVELS} CLEARED
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-4 text-left text-xs sm:grid-cols-4 sm:text-sm">
              <Legend icon="⚡" label="Speed" good />
              <Legend icon="🛡️" label="Shield" good />
              <Legend icon="❄️" label="Freeze" good />
              <Legend icon="💎" label="Bonus" good />
              <Legend icon="🕸️" label="Slow" />
              <Legend icon="🌀" label="Chaos" />
              <Legend icon="🌫️" label="Fog" />
              <Legend icon="🟢" label="Exit" good />
            </div>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <button onClick={playRecommended} className="btn-primary">
                ▶ {campaign.cleared[rec - 1] ? "REPLAY" : "PLAY"} {recDef.name.toUpperCase()}
              </button>
              <button onClick={openLevels} className="btn-ghost">
                ☰ SELECT LEVEL
              </button>
              <button onClick={openSaves} className="btn-ghost">
                💾 {saveId ? `ID ${saveId}` : "SAVE / LOAD ID"}
              </button>
            </div>
            <HighScores scores={scores} compact />
            <p className="text-xs text-white/40">
              Move: WASD / Arrows / Swipe · Pause: P
            </p>
          </Overlay>
        )}

        {screen === "saves" && (
          <Overlay>
            <div className="text-center">
              <h2 className="text-3xl font-black sm:text-4xl">SAVE DATA</h2>
              <p className="mt-2 max-w-md text-sm text-white/55">
                Generate an ID or choose your own. Come back later, type it in,
                and every unlock, best score, and high score loads from the
                in-game database.
              </p>
            </div>

            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-[10px] font-bold tracking-widest text-white/40">
                CURRENT ID
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 truncate font-mono text-lg font-black tracking-wide text-cyan-300">
                  {saveId ?? "— none —"}
                </div>
                {saveId && (
                  <button
                    onClick={handleCopyId}
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/15"
                  >
                    {copied ? "COPIED" : "COPY"}
                  </button>
                )}
              </div>
              <div className="mt-1 text-xs text-white/45">
                {saveId
                  ? `${done}/${TOTAL_LEVELS} levels cleared on this ID`
                  : "Guest play is not stored under an ID until you generate one."}
              </div>
            </div>

            <form
              className="flex w-full max-w-md flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleLoadId();
              }}
            >
              <input
                value={saveInput}
                onChange={(e) => setSaveInput(e.target.value.toUpperCase())}
                placeholder="TYPE YOUR SAVE ID"
                autoComplete="off"
                spellCheck={false}
                className="save-input"
                maxLength={23}
              />
              <div className="grid grid-cols-2 gap-2">
                <button type="submit" className="btn-ghost !px-4 !py-2 !text-sm">
                  LOAD ID
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateId()}
                  className="btn-ghost !px-4 !py-2 !text-sm"
                >
                  CREATE THIS ID
                </button>
              </div>
              <button
                type="button"
                onClick={() => void handleGenerateId()}
                className="btn-primary !py-2.5 !text-base"
              >
                ✨ GENERATE RANDOM ID
              </button>
            </form>

            {saveMsg && (
              <p className="max-w-md text-center text-sm font-semibold text-emerald-300">
                {saveMsg}
              </p>
            )}

            {knownSaves.length > 0 && (
              <div className="w-full max-w-md rounded-2xl bg-black/20 p-3">
                <div className="mb-2 text-center text-[10px] font-bold tracking-widest text-white/40">
                  SAVES ON THIS DEVICE
                </div>
                <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
                  {knownSaves.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => {
                          setSaveInput(s.id);
                          applyRecord(
                            s,
                            `Loaded ${s.id} · ${clearedCount(s.campaign)}/${TOTAL_LEVELS} cleared.`
                          );
                          sfx.ui();
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-white/10 ${
                          s.id === saveId ? "bg-cyan-400/10" : ""
                        }`}
                      >
                        <span className="font-mono text-xs font-bold text-cyan-200">
                          {s.id}
                        </span>
                        <span className="text-[10px] text-white/40">
                          {clearedCount(s.campaign)}/{TOTAL_LEVELS}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button onClick={goStart} className="btn-ghost">
              ← BACK
            </button>
          </Overlay>
        )}

        {screen === "levels" && (
          <Overlay>
            <div className="text-center">
              <h2 className="text-3xl font-black sm:text-4xl">SELECT LEVEL</h2>
              <p className="mt-1 text-sm text-white/50">
                Clear a stage to unlock the next. {done}/{TOTAL_LEVELS} complete.
              </p>
            </div>
            <div className="grid w-full max-w-xl grid-cols-2 gap-2 sm:grid-cols-5">
              {LEVELS.map((lv) => {
                const locked = lv.id > campaign.unlocked;
                const cleared = campaign.cleared[lv.id - 1];
                const best = campaign.best[lv.id - 1] ?? 0;
                const recThis = lv.id === rec && !locked;
                return (
                  <button
                    key={lv.id}
                    disabled={locked}
                    onClick={() => playLevel(lv.id)}
                    className={`relative flex flex-col items-start rounded-2xl border p-3 text-left transition ${
                      locked
                        ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                        : recThis
                          ? "border-cyan-400/60 bg-cyan-400/10 hover:bg-cyan-400/15"
                          : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-lg font-black tabular-nums">
                        {locked ? "🔒" : lv.id}
                      </span>
                      {cleared && (
                        <span className="text-sm text-emerald-300">✓</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs font-bold tracking-wide text-white/80">
                      {locked ? "Locked" : lv.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-white/40">
                      {locked ? "Clear the previous level" : lv.blurb}
                    </div>
                    {!locked && best > 0 && (
                      <div className="mt-1 text-[10px] font-bold tabular-nums text-cyan-300">
                        Best {best.toLocaleString()}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button onClick={goStart} className="btn-ghost">
              ← BACK
            </button>
          </Overlay>
        )}

        {screen === "paused" && (
          <Overlay>
            <h2 className="text-4xl font-black text-white">PAUSED</h2>
            <p className="text-sm text-white/50">
              Level {currentLevel} · {getLevel(currentLevel).name}
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={togglePause} className="btn-primary">
                ▶ RESUME
              </button>
              <button onClick={retryLevel} className="btn-ghost">
                ↺ RESTART LEVEL
              </button>
              <button onClick={openLevels} className="btn-ghost">
                ☰ LEVEL SELECT
              </button>
            </div>
          </Overlay>
        )}

        {screen === "levelclear" && (
          <Overlay>
            <div className="text-center">
              <div className="text-6xl">🏆</div>
              <h2 className="mt-2 bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-4xl font-black text-transparent">
                {getLevel(lastRun.level).name.toUpperCase()} CLEAR!
              </h2>
              <p className="mt-2 text-white/70">
                Score:{" "}
                <span className="font-bold text-cyan-300">
                  {lastRun.score.toLocaleString()}
                </span>
              </p>
              {lastRun.levelBest && (
                <p className="mt-1 text-sm font-bold text-amber-300">
                  ✨ New level best!
                </p>
              )}
              {lastRun.unlockedNext && (
                <p className="mt-2 text-sm font-semibold text-violet-300">
                  Level {lastRun.level + 1} · {getLevel(lastRun.level + 1).name}{" "}
                  unlocked
                </p>
              )}
            </div>
            <div className="flex w-full max-w-sm flex-col gap-2">
              <button onClick={playNext} className="btn-primary">
                NEXT LEVEL →
              </button>
              <button onClick={openLevels} className="btn-ghost">
                ☰ LEVEL SELECT
              </button>
            </div>
          </Overlay>
        )}

        {screen === "victory" && (
          <Overlay>
            <div className="text-center">
              <div className="text-6xl">👑</div>
              <h2 className="mt-2 bg-gradient-to-r from-amber-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-4xl font-black text-transparent sm:text-5xl">
                CAMPAIGN COMPLETE
              </h2>
              <p className="mt-3 text-white/70">
                Apex is yours ·{" "}
                <span className="font-bold text-cyan-300">
                  {lastRun.score.toLocaleString()} pts
                </span>
              </p>
              {lastRun.levelBest && (
                <p className="mt-1 text-sm font-bold text-amber-300">
                  ✨ New Apex best!
                </p>
              )}
            </div>
            <HighScores scores={scores} />
            <div className="flex w-full max-w-sm flex-col gap-2">
              <button onClick={openLevels} className="btn-primary">
                ☰ LEVEL SELECT
              </button>
              <button onClick={goStart} className="btn-ghost">
                HOME
              </button>
            </div>
          </Overlay>
        )}

        {screen === "gameover" && (
          <Overlay>
            <div className="text-center">
              <h2 className="text-5xl font-black text-rose-400 drop-shadow">
                GAME OVER
              </h2>
              {newHigh && (
                <p className="mt-2 animate-bounce text-lg font-bold text-amber-300">
                  ✨ NEW HIGH SCORE! ✨
                </p>
              )}
              <p className="mt-3 text-white/70">
                {getLevel(lastRun.level).name} failed ·{" "}
                <span className="font-bold text-cyan-300">
                  {lastRun.score.toLocaleString()} pts
                </span>
              </p>
            </div>
            <HighScores scores={scores} />
            <div className="flex w-full max-w-sm flex-col gap-2">
              <button onClick={retryLevel} className="btn-primary">
                ↺ RETRY LEVEL
              </button>
              <button onClick={openLevels} className="btn-ghost">
                ☰ LEVEL SELECT
              </button>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="leading-none">
      <div className="text-[9px] font-bold tracking-widest text-white/40 sm:text-[10px]">
        {label}
      </div>
      <div
        className="text-lg font-black tabular-nums sm:text-2xl"
        style={{ color: accent }}
      >
        {value}
      </div>
    </div>
  );
}

function DPad({
  dir,
  onHold,
  children,
}: {
  dir: "up" | "down" | "left" | "right";
  onHold: (d: "up" | "down" | "left" | "right", on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onHold(dir, true);
      }}
      onPointerUp={() => onHold(dir, false)}
      onPointerLeave={() => onHold(dir, false)}
      onPointerCancel={() => onHold(dir, false)}
      className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-xl text-cyan-200 backdrop-blur-sm transition active:scale-90 active:bg-cyan-400/30 sm:h-16 sm:w-16"
    >
      {children}
    </button>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-[#080a18]/85 p-5 backdrop-blur-md">
      {children}
    </div>
  );
}

function Legend({
  icon,
  label,
  good,
}: {
  icon: string;
  label: string;
  good?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-base">{icon}</span>
      <span className={good ? "text-emerald-300" : "text-rose-300"}>{label}</span>
    </div>
  );
}

function HighScores({
  scores,
  compact,
}: {
  scores: ScoreEntry[];
  compact?: boolean;
}) {
  if (scores.length === 0)
    return (
      <p className="text-xs text-white/40">No high scores yet — be the first!</p>
    );
  return (
    <div className="w-full max-w-xs rounded-2xl bg-white/5 p-3">
      <div className="mb-1 text-center text-xs font-bold tracking-widest text-amber-300">
        🏅 HIGH SCORES
      </div>
      <ol className="space-y-0.5 text-sm">
        {scores.slice(0, compact ? 3 : 5).map((s, i) => (
          <li
            key={i}
            className="flex items-center justify-between rounded px-2 py-0.5 tabular-nums odd:bg-white/5"
          >
            <span className="text-white/50">#{i + 1}</span>
            <span className="font-bold text-cyan-200">
              {s.score.toLocaleString()}
            </span>
            <span className="text-xs text-white/40">Lv {s.level}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
