// Maze generation using recursive backtracker on a "block grid".
// The block grid has dimensions (2*cols+1) x (2*rows+1).
// A cell value of `true` means WALL, `false` means open passage.

export interface Maze {
  cols: number;
  rows: number;
  w: number; // block grid width  (2*cols+1)
  h: number; // block grid height (2*rows+1)
  grid: boolean[][]; // grid[y][x] -> true = wall
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateMaze(cols: number, rows: number): Maze {
  const w = 2 * cols + 1;
  const h = 2 * rows + 1;
  const grid: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    grid[y] = new Array(w).fill(true);
  }

  const visited: boolean[][] = [];
  for (let y = 0; y < rows; y++) visited[y] = new Array(cols).fill(false);

  const stack: [number, number][] = [];
  visited[0][0] = true;
  grid[1][1] = false;
  stack.push([0, 0]);

  const dirs: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const neighbors: [number, number, number, number][] = [];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !visited[ny][nx]) {
        neighbors.push([nx, ny, dx, dy]);
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny, dx, dy] = shuffle(neighbors)[0];
    visited[ny][nx] = true;
    // carve passage: cell center + wall between
    grid[2 * ny + 1][2 * nx + 1] = false;
    grid[2 * cy + 1 + dy][2 * cx + 1 + dx] = false;
    stack.push([nx, ny]);
  }

  // Add a few extra openings to create loops (more fun / less dead-endy)
  const extra = Math.floor(cols * rows * 0.06);
  for (let i = 0; i < extra; i++) {
    const x = 1 + Math.floor(Math.random() * (cols - 1)) * 2;
    const y = 1 + Math.floor(Math.random() * (rows - 1)) * 2;
    // knock a wall between two cells
    if (Math.random() < 0.5) grid[y][x + 1] = false;
    else grid[y + 1][x] = false;
  }

  return { cols, rows, w, h, grid };
}

// BFS returns the next tile to step to along the shortest path.
export function nextStep(
  maze: Maze,
  from: [number, number],
  to: [number, number]
): [number, number] | null {
  const { w, h, grid } = maze;
  if (from[0] === to[0] && from[1] === to[1]) return null;
  const key = (x: number, y: number) => y * w + x;
  const prev = new Map<number, number>();
  const queue: [number, number][] = [from];
  const seen = new Set<number>([key(from[0], from[1])]);
  const dirs = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  let found = false;
  while (queue.length) {
    const [cx, cy] = queue.shift()!;
    if (cx === to[0] && cy === to[1]) {
      found = true;
      break;
    }
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (grid[ny][nx]) continue; // wall
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, key(cx, cy));
      queue.push([nx, ny]);
    }
  }
  if (!found) return null;
  // walk back from `to` to the tile right after `from`
  let cur = key(to[0], to[1]);
  const start = key(from[0], from[1]);
  let step = cur;
  while (cur !== start) {
    step = cur;
    const p = prev.get(cur);
    if (p === undefined) return null;
    cur = p;
  }
  return [step % w, Math.floor(step / w)];
}

// Collect all open passage tiles
export function openTiles(maze: Maze): [number, number][] {
  const tiles: [number, number][] = [];
  for (let y = 0; y < maze.h; y++) {
    for (let x = 0; x < maze.w; x++) {
      if (!maze.grid[y][x]) tiles.push([x, y]);
    }
  }
  return tiles;
}
