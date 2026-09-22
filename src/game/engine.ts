import { generateMaze, nextStep, openTiles, type Maze } from "./maze";
import { getLevel, TOTAL_LEVELS } from "./levels";
import { sfx } from "./sound";
import {
  ARTIFACTS,
  type ActiveEffect,
  type ArtifactKind,
  type HudState,
} from "./types";

export const TILE = 44; // world pixels per block tile

interface Vec {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface Artifact {
  tx: number;
  ty: number;
  kind: ArtifactKind;
  bob: number;
  taken: boolean;
}

interface Enemy {
  pos: Vec;
  target: [number, number] | null;
  speed: number;
  recalc: number;
  hue: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
}

export interface EngineCallbacks {
  onHud: (hud: HudState) => void;
  onLevelComplete: (level: number, score: number) => void;
  onGameOver: (score: number, level: number) => void;
  onPickup: (kind: ArtifactKind, duration: number) => void;
}

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cb: EngineCallbacks;
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private running = false;
  private paused = false;

  private maze!: Maze;
  private player: Vec = { x: 0, y: 0 };
  private playerR = TILE * 0.32;
  private baseSpeed = TILE * 4.2;
  private exit: [number, number] = [0, 0];
  private artifacts: Artifact[] = [];
  private enemies: Enemy[] = [];
  private particles: Particle[] = [];
  private floats: FloatText[] = [];
  private effects: ActiveEffect[] = [];

  private score = 0;
  private level = 1;
  private levelName = "Spark";
  private lives = 3;
  private time = 0;
  private timeMax = 50;
  private combo = 0;
  private comboTimer = 0;

  private invuln = 0; // brief i-frames after hit
  private shake = 0;
  private cam: Vec = { x: 0, y: 0 };
  private stepSfxTimer = 0;
  private flash = 0;
  private exitPulse = 0;

  // input
  public input = { up: false, down: false, left: false, right: false };
  private lookDir: Vec = { x: 1, y: 0 };
  private blinkT = 0;

  private dpr = 1;
  private viewW = 0;
  private viewH = 0;

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cb = cb;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = Math.floor(rect.width * this.dpr);
    this.canvas.height = Math.floor(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start(level = 1) {
    const def = getLevel(level);
    this.level = def.id;
    this.levelName = def.name;
    this.score = 0;
    this.lives = def.lives;
    this.combo = 0;
    this.buildLevel();
    this.paused = false;
    this.running = true;
    this.lastT = performance.now();
    this.acc = 0;
    cancelAnimationFrame(this.raf);
    this.loop(this.lastT);
  }

  private buildLevel() {
    const def = getLevel(this.level);
    this.levelName = def.name;
    const cols = def.cols;
    const rows = def.rows;
    this.maze = generateMaze(cols, rows);
    this.effects = [];
    this.particles = [];
    this.floats = [];
    this.enemies = [];
    this.artifacts = [];
    this.invuln = 1.2;

    // player starts top-left passage
    this.player = {
      x: 1 * TILE + TILE / 2,
      y: 1 * TILE + TILE / 2,
    };
    this.exit = [this.maze.w - 2, this.maze.h - 2];
    this.exitPulse = 0;

    this.time = def.time;
    this.timeMax = def.time;

    const tiles = openTiles(this.maze).filter(
      ([x, y]) =>
        !(x === 1 && y === 1) && !(x === this.exit[0] && y === this.exit[1])
    );
    // shuffle tiles
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    }

    const boostKinds: ArtifactKind[] = ["speed", "shield", "freeze", "points"];
    const debuffKinds: ArtifactKind[] = ["slow", "reverse", "fog"];
    let ti = 0;
    for (let i = 0; i < def.boosts && ti < tiles.length; i++, ti++) {
      const [tx, ty] = tiles[ti];
      this.artifacts.push({
        tx,
        ty,
        kind: boostKinds[Math.floor(Math.random() * boostKinds.length)],
        bob: Math.random() * Math.PI * 2,
        taken: false,
      });
    }
    for (let i = 0; i < def.debuffs && ti < tiles.length; i++, ti++) {
      const [tx, ty] = tiles[ti];
      this.artifacts.push({
        tx,
        ty,
        kind: debuffKinds[Math.floor(Math.random() * debuffKinds.length)],
        bob: Math.random() * Math.PI * 2,
        taken: false,
      });
    }

    const far = tiles
      .slice(ti)
      .sort((a, b) => dist2(b, [1, 1]) - dist2(a, [1, 1]));
    for (let i = 0; i < def.hunters && i < far.length; i++) {
      const [tx, ty] = far[i];
      this.enemies.push({
        pos: { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 },
        target: null,
        speed: this.baseSpeed * def.hunterSpeed,
        recalc: 0,
        hue: 320 + Math.random() * 30,
      });
    }
    this.emitHud();
  }

  private emitHud() {
    this.cb.onHud({
      score: Math.floor(this.score),
      level: this.level,
      levelName: this.levelName,
      lives: this.lives,
      time: Math.max(0, this.time),
      timeMax: this.timeMax,
      effects: this.effects.map((e) => ({ ...e })),
      combo: this.combo,
    });
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) {
      this.lastT = performance.now();
    }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private loop = (t: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (t - this.lastT) / 1000;
    this.lastT = t;
    if (dt > 0.05) dt = 0.05; // clamp big gaps
    if (!this.paused) {
      this.acc += dt;
      const step = 1 / 120;
      let guard = 0;
      while (this.acc >= step && guard < 8) {
        this.update(step);
        this.acc -= step;
        guard++;
      }
    }
    this.render();
  };

  private hasEffect(k: ArtifactKind) {
    return this.effects.some((e) => e.kind === k);
  }

  private addEffect(kind: ArtifactKind, duration: number) {
    const existing = this.effects.find((e) => e.kind === kind);
    if (existing) {
      existing.remaining = duration;
      existing.duration = duration;
    } else {
      this.effects.push({ kind, remaining: duration, duration });
    }
  }

  private update(dt: number) {
    // timers
    this.time -= dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.exitPulse += dt;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;

    for (const e of this.effects) e.remaining -= dt;
    this.effects = this.effects.filter((e) => e.remaining > 0);

    if (this.time <= 0) {
      this.time = 0;
      this.loseLife(true);
      return;
    }

    // input -> direction
    let dx = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    let dy = (this.input.down ? 1 : 0) - (this.input.up ? 1 : 0);
    if (this.hasEffect("reverse")) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy) || 1;

    let speed = this.baseSpeed;
    if (this.hasEffect("speed")) speed *= 1.7;
    if (this.hasEffect("slow")) speed *= 0.5;

    this.blinkT += dt;
    if (dx !== 0 || dy !== 0) {
      this.lookDir = { x: dx / len, y: dy / len };
      this.moveCircle(this.player, this.playerR, (dx / len) * speed * dt, 0);
      this.moveCircle(this.player, this.playerR, 0, (dy / len) * speed * dt);
      // trail particles
      if (Math.random() < 0.5) {
        this.particles.push({
          x: this.player.x,
          y: this.player.y,
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20,
          life: 0.4,
          maxLife: 0.4,
          size: 3 + Math.random() * 3,
          color: this.hasEffect("speed") ? "#fde68a" : "#67e8f9",
        });
      }
      this.stepSfxTimer -= dt;
      if (this.stepSfxTimer <= 0) {
        sfx.step();
        this.stepSfxTimer = 0.18;
      }
    }

    // camera follow, clamped
    const worldW = this.maze.w * TILE;
    const worldH = this.maze.h * TILE;
    let camX = this.player.x - this.viewW / 2;
    let camY = this.player.y - this.viewH / 2;
    camX = clamp(camX, 0, Math.max(0, worldW - this.viewW));
    camY = clamp(camY, 0, Math.max(0, worldH - this.viewH));
    if (worldW < this.viewW) camX = (worldW - this.viewW) / 2;
    if (worldH < this.viewH) camY = (worldH - this.viewH) / 2;
    this.cam.x += (camX - this.cam.x) * Math.min(1, dt * 8);
    this.cam.y += (camY - this.cam.y) * Math.min(1, dt * 8);

    // artifacts collect
    for (const a of this.artifacts) {
      if (a.taken) continue;
      a.bob += dt * 3;
      const ax = a.tx * TILE + TILE / 2;
      const ay = a.ty * TILE + TILE / 2;
      if (Math.hypot(ax - this.player.x, ay - this.player.y) < this.playerR + TILE * 0.28) {
        a.taken = true;
        this.collect(a, ax, ay);
      }
    }

    // enemies
    const frozen = this.hasEffect("freeze");
    for (const en of this.enemies) {
      if (!frozen) this.updateEnemy(en, dt);
      // collision with player
      if (
        Math.hypot(en.pos.x - this.player.x, en.pos.y - this.player.y) <
        this.playerR + TILE * 0.3
      ) {
        if (this.hasEffect("shield")) {
          // bounce enemy away & pop
          this.explode(en.pos.x, en.pos.y, "#f0abfc", 16);
          const ang = Math.atan2(en.pos.y - this.player.y, en.pos.x - this.player.x);
          en.pos.x += Math.cos(ang) * TILE * 1.5;
          en.pos.y += Math.sin(ang) * TILE * 1.5;
          en.target = null;
          this.shake = Math.max(this.shake, 0.5);
        } else if (this.invuln <= 0) {
          this.loseLife(false);
        }
      }
    }

    // reach exit
    const ex = this.exit[0] * TILE + TILE / 2;
    const ey = this.exit[1] * TILE + TILE / 2;
    if (Math.hypot(ex - this.player.x, ey - this.player.y) < this.playerR + TILE * 0.35) {
      this.completeLevel();
      return;
    }

    // particles / floats update
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floats) {
      f.y += f.vy * dt;
      f.vy *= 0.96;
      f.life -= dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);

    this.emitHud();
  }

  private updateEnemy(en: Enemy, dt: number) {
    const ptile: [number, number] = [
      Math.floor(this.player.x / TILE),
      Math.floor(this.player.y / TILE),
    ];
    const etile: [number, number] = [
      Math.floor(en.pos.x / TILE),
      Math.floor(en.pos.y / TILE),
    ];
    en.recalc -= dt;
    const centerX = etile[0] * TILE + TILE / 2;
    const centerY = etile[1] * TILE + TILE / 2;
    const nearCenter =
      Math.abs(en.pos.x - centerX) < 3 && Math.abs(en.pos.y - centerY) < 3;
    if (en.recalc <= 0 || !en.target || nearCenter) {
      en.target = nextStep(this.maze, etile, ptile);
      en.recalc = 0.25;
    }
    if (en.target) {
      const tx = en.target[0] * TILE + TILE / 2;
      const ty = en.target[1] * TILE + TILE / 2;
      const d = Math.hypot(tx - en.pos.x, ty - en.pos.y);
      if (d < 2) {
        en.pos.x = tx;
        en.pos.y = ty;
        en.target = null;
      } else {
        en.pos.x += ((tx - en.pos.x) / d) * en.speed * dt;
        en.pos.y += ((ty - en.pos.y) / d) * en.speed * dt;
      }
    }
  }

  private collect(a: Artifact, ax: number, ay: number) {
    const meta = ARTIFACTS[a.kind];
    if (meta.boost) {
      this.combo++;
      this.comboTimer = 3;
    }
    let duration = 0;
    switch (a.kind) {
      case "speed":
        duration = 6;
        this.addEffect("speed", duration);
        this.gainScore(50, ax, ay, "SPEED!", meta.color);
        sfx.boost();
        break;
      case "shield":
        duration = 7;
        this.addEffect("shield", duration);
        this.gainScore(50, ax, ay, "SHIELD!", meta.color);
        sfx.boost();
        break;
      case "freeze":
        duration = 5;
        this.addEffect("freeze", duration);
        this.gainScore(50, ax, ay, "FREEZE!", meta.color);
        sfx.boost();
        break;
      case "points": {
        const bonus = 200 * Math.max(1, this.combo);
        this.gainScore(bonus, ax, ay, `+${bonus}`, meta.color);
        sfx.points();
        break;
      }
      case "slow":
        duration = 5;
        this.addEffect("slow", duration);
        this.gainScore(0, ax, ay, "SLOWED", meta.color);
        this.flash = 0.6;
        this.shake = Math.max(this.shake, 0.4);
        sfx.debuff();
        break;
      case "reverse":
        duration = 5;
        this.addEffect("reverse", duration);
        this.gainScore(0, ax, ay, "CHAOS!", meta.color);
        this.flash = 0.6;
        this.shake = Math.max(this.shake, 0.4);
        sfx.debuff();
        break;
      case "fog":
        duration = 6;
        this.addEffect("fog", duration);
        this.gainScore(0, ax, ay, "FOG!", meta.color);
        this.flash = 0.5;
        sfx.debuff();
        break;
    }
    this.explode(ax, ay, meta.color, meta.boost ? 22 : 16);
    this.cb.onPickup(a.kind, duration);
  }

  private gainScore(n: number, x: number, y: number, text: string, color: string) {
    this.score += n;
    this.floats.push({ x, y, vy: -50, life: 1.1, text, color });
  }

  private loseLife(fromTime: boolean) {
    this.lives--;
    this.shake = 1;
    this.flash = 1;
    this.invuln = 1.5;
    this.combo = 0;
    this.explode(this.player.x, this.player.y, "#f87171", 30);
    sfx.hit();
    if (this.lives <= 0) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      sfx.gameover();
      this.cb.onGameOver(Math.floor(this.score), this.level);
      return;
    }
    if (fromTime) {
      this.time = 20;
    } else {
      // knock player back to start area
      this.player = { x: 1 * TILE + TILE / 2, y: 1 * TILE + TILE / 2 };
    }
    this.emitHud();
  }

  private completeLevel() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    const timeBonus = Math.floor(this.time * 5);
    const levelBonus = this.level * 100;
    this.score += timeBonus + levelBonus;
    this.explode(this.player.x, this.player.y, "#a7f3d0", 40);
    sfx.win();
    this.cb.onLevelComplete(this.level, Math.floor(this.score));
  }

  nextLevel() {
    if (this.level >= TOTAL_LEVELS) return;
    this.start(this.level + 1);
  }

  getState() {
    return { score: Math.floor(this.score), level: this.level, lives: this.lives };
  }

  private explode(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        size: 2 + Math.random() * 4,
        color,
      });
    }
  }

  // circle vs blocked-tile collision, one axis at a time
  private moveCircle(pos: Vec, r: number, dx: number, dy: number) {
    pos.x += dx;
    pos.y += dy;
    const minTX = Math.floor((pos.x - r) / TILE);
    const maxTX = Math.floor((pos.x + r) / TILE);
    const minTY = Math.floor((pos.y - r) / TILE);
    const maxTY = Math.floor((pos.y + r) / TILE);
    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        if (this.isWall(tx, ty)) {
          const rx = tx * TILE;
          const ry = ty * TILE;
          const nearX = clamp(pos.x, rx, rx + TILE);
          const nearY = clamp(pos.y, ry, ry + TILE);
          const ddx = pos.x - nearX;
          const ddy = pos.y - nearY;
          const d = Math.hypot(ddx, ddy);
          if (d < r && d > 0) {
            const push = r - d;
            pos.x += (ddx / d) * push;
            pos.y += (ddy / d) * push;
          } else if (d === 0) {
            // dead center: push back along movement
            pos.x -= dx;
            pos.y -= dy;
          }
        }
      }
    }
  }

  private isWall(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.maze.w || ty >= this.maze.h) return true;
    return this.maze.grid[ty][tx];
  }

  // -------- rendering --------
  private render() {
    const ctx = this.ctx;
    const W = this.viewW;
    const H = this.viewH;
    ctx.clearRect(0, 0, W, H);

    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1026");
    bg.addColorStop(1, "#080a18");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    let sx = 0,
      sy = 0;
    if (this.shake > 0) {
      const m = this.shake * 10;
      sx = (Math.random() - 0.5) * m;
      sy = (Math.random() - 0.5) * m;
    }
    ctx.translate(-this.cam.x + sx, -this.cam.y + sy);

    this.drawMaze();
    this.drawExit();
    this.drawArtifacts();
    this.drawParticles();
    this.drawEnemies();
    this.drawPlayer();
    this.drawFloats();

    ctx.restore();

    // fog of war overlay (screen space)
    if (this.hasEffect("fog")) {
      const px = this.player.x - this.cam.x;
      const py = this.player.y - this.cam.y;
      const grd = ctx.createRadialGradient(px, py, TILE * 1.2, px, py, TILE * 4);
      grd.addColorStop(0, "rgba(3,6,18,0)");
      grd.addColorStop(1, "rgba(3,6,18,0.97)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
    }

    // damage / debuff flash
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(244,63,94,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }

    // vignette
    const vg = ctx.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(W, H) * 0.3,
      W / 2,
      H / 2,
      Math.max(W, H) * 0.75
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  private visibleTiles() {
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(this.cam.y / TILE) - 1);
    const x1 = Math.min(this.maze.w - 1, Math.ceil((this.cam.x + this.viewW) / TILE) + 1);
    const y1 = Math.min(this.maze.h - 1, Math.ceil((this.cam.y + this.viewH) / TILE) + 1);
    return { x0, y0, x1, y1 };
  }

  private drawMaze() {
    const ctx = this.ctx;
    const { x0, y0, x1, y1 } = this.visibleTiles();
    // floor
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.maze.grid[ty][tx]) {
          ctx.fillStyle = (tx + ty) % 2 === 0 ? "#111834" : "#0e142c";
          ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
        }
      }
    }
    // walls with neon edge
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.maze.grid[ty][tx]) {
          const x = tx * TILE;
          const y = ty * TILE;
          const g = ctx.createLinearGradient(x, y, x, y + TILE);
          g.addColorStop(0, "#28306a");
          g.addColorStop(1, "#1a2050");
          ctx.fillStyle = g;
          ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
          ctx.strokeStyle = "rgba(99,102,241,0.35)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 1.5, y + 1.5, TILE - 3, TILE - 3);
        }
      }
    }
  }

  private drawExit() {
    const ctx = this.ctx;
    const x = this.exit[0] * TILE + TILE / 2;
    const y = this.exit[1] * TILE + TILE / 2;
    const pulse = 0.5 + Math.sin(this.exitPulse * 4) * 0.5;
    ctx.save();
    ctx.shadowBlur = 25 + pulse * 15;
    ctx.shadowColor = "#4ade80";
    for (let i = 3; i >= 1; i--) {
      ctx.beginPath();
      ctx.arc(x, y, (TILE * 0.16) * i + pulse * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(74,222,128,${0.5 / i})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, TILE * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "#4ade80";
    ctx.fill();
    ctx.restore();
  }

  private drawArtifacts() {
    const ctx = this.ctx;
    for (const a of this.artifacts) {
      if (a.taken) continue;
      const meta = ARTIFACTS[a.kind];
      const x = a.tx * TILE + TILE / 2;
      const y = a.ty * TILE + TILE / 2 + Math.sin(a.bob) * 3;
      ctx.save();
      ctx.shadowBlur = 16;
      ctx.shadowColor = meta.color;
      // ring
      ctx.beginPath();
      ctx.arc(x, y, TILE * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = meta.boost ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = meta.color;
      ctx.stroke();
      ctx.restore();
      // icon
      ctx.font = `${Math.floor(TILE * 0.42)}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.icon, x, y + 1);
    }
  }

  private drawEnemies() {
    const ctx = this.ctx;
    const frozen = this.hasEffect("freeze");
    for (const en of this.enemies) {
      ctx.save();
      ctx.shadowBlur = 18;
      ctx.shadowColor = frozen ? "#93c5fd" : `hsl(${en.hue},90%,60%)`;
      ctx.beginPath();
      ctx.arc(en.pos.x, en.pos.y, this.playerR * 0.95, 0, Math.PI * 2);
      ctx.fillStyle = frozen ? "#bfdbfe" : `hsl(${en.hue},80%,55%)`;
      ctx.fill();
      ctx.restore();
      // eyes
      ctx.fillStyle = "#0b1026";
      const ex = Math.sign(this.player.x - en.pos.x) * 3;
      const ey = Math.sign(this.player.y - en.pos.y) * 3;
      ctx.beginPath();
      ctx.arc(en.pos.x - 4 + ex, en.pos.y - 2 + ey, 2.6, 0, Math.PI * 2);
      ctx.arc(en.pos.x + 4 + ex, en.pos.y - 2 + ey, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayer() {
    const ctx = this.ctx;
    const { x, y } = this.player;
    const r = this.playerR;
    const shield = this.hasEffect("shield");
    const hitBlink = this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0;
    ctx.save();
    if (hitBlink) ctx.globalAlpha = 0.4;
    // aura
    let color = "#22d3ee";
    if (this.hasEffect("speed")) color = "#fbbf24";
    if (this.hasEffect("slow")) color = "#f472b6";
    if (this.hasEffect("reverse")) color = "#c084fc";
    ctx.shadowBlur = 22;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Face — same style as the hunters: two dark eyes that look where you go
    const lx = this.lookDir.x * 3.2;
    const ly = this.lookDir.y * 3.2;
    const eyeY = y - r * 0.12;
    const eyeSpread = 4.4;
    const eyeR = 2.7;
    const blinking = this.blinkT % 3.4 > 3.22;

    if (blinking) {
      ctx.strokeStyle = "#0b1026";
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - eyeSpread - 2.4 + lx, eyeY + ly);
      ctx.lineTo(x - eyeSpread + 2.4 + lx, eyeY + ly);
      ctx.moveTo(x + eyeSpread - 2.4 + lx, eyeY + ly);
      ctx.lineTo(x + eyeSpread + 2.4 + lx, eyeY + ly);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#0b1026";
      ctx.beginPath();
      ctx.arc(x - eyeSpread + lx, eyeY + ly, eyeR, 0, Math.PI * 2);
      ctx.arc(x + eyeSpread + lx, eyeY + ly, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tiny smile so it still reads as a face
    ctx.strokeStyle = "#0b1026";
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    ctx.beginPath();
    const mouthY = y + r * 0.28 + ly * 0.2;
    if (this.hasEffect("slow") || this.hasEffect("reverse")) {
      ctx.arc(x + lx * 0.3, mouthY + 3, 4.2, Math.PI * 1.15, Math.PI * 1.85);
    } else {
      ctx.arc(x + lx * 0.3, mouthY - 1.5, 4.2, Math.PI * 0.15, Math.PI * 0.85);
    }
    ctx.stroke();
    ctx.restore();

    if (shield) {
      ctx.save();
      ctx.strokeStyle = `rgba(56,189,248,${0.6 + Math.sin(this.exitPulse * 8) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#38bdf8";
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFloats() {
    const ctx = this.ctx;
    ctx.textAlign = "center";
    ctx.font = "bold 16px system-ui, sans-serif";
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillStyle = f.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function dist2(a: [number, number], b: [number, number]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}
