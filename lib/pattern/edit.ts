/** Editing helpers for pattern grids (cells are palette indexes, row by row; -1 = empty). */

/** Mirror left ↔ right. Works for any per-cell array or string (cells, done marks…). */
export function flipHorizontal<T>(cells: T[], cols: number, rows: number): T[] {
  const out = new Array<T>(cells.length)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = cells[r * cols + (cols - 1 - c)]
  return out
}

export function flipHorizontalText(text: string, cols: number, rows: number): string {
  return flipHorizontal(text.split(""), cols, rows).join("")
}

/** Paint-bucket fill: every connected cell (up/down/left/right) with the same colour as `start`. */
export function floodFill(cells: number[], cols: number, rows: number, start: number, value: number): number[] {
  const target = cells[start]
  if (target === value) return cells
  const out = cells.slice()
  const stack = [start]
  while (stack.length) {
    const i = stack.pop()!
    if (out[i] !== target) continue
    out[i] = value
    const r = Math.floor(i / cols), c = i % cols
    if (c > 0) stack.push(i - 1)
    if (c < cols - 1) stack.push(i + 1)
    if (r > 0) stack.push(i - cols)
    if (r < rows - 1) stack.push(i + cols)
  }
  return out
}

/** Every cell on the straight line between two cells, so a fast stroke leaves no gaps. */
export function cellsBetween(a: { c: number; r: number }, b: { c: number; r: number }): { c: number; r: number }[] {
  const out: { c: number; r: number }[] = []
  let x = a.c, y = a.r
  const dx = Math.abs(b.c - a.c), dy = -Math.abs(b.r - a.r)
  const sx = a.c < b.c ? 1 : -1, sy = a.r < b.r ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push({ c: x, r: y })
    if (x === b.c && y === b.r) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
  return out
}

/** Cells whose centres are inside a loop drawn on the grid (points in cell units). */
export function cellsInsideLoop(points: { x: number; y: number }[], cols: number, rows: number): boolean[] {
  const mask = new Array<boolean>(cols * rows).fill(false)
  if (points.length < 3) return mask
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
  for (let r = Math.max(0, Math.floor(minY)); r <= Math.min(rows - 1, Math.floor(maxY)); r++) {
    for (let c = Math.max(0, Math.floor(minX)); c <= Math.min(cols - 1, Math.floor(maxX)); c++) {
      const x = c + 0.5, y = r + 0.5
      let inside = false
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j]
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
      }
      if (inside) mask[r * cols + c] = true
    }
  }
  return mask
}

/** How far a selection may move (dc/dr) and still stay inside the grid. */
export function selectionLimits(mask: boolean[], cols: number, rows: number) {
  let minC = cols, maxC = -1, minR = rows, maxR = -1
  mask.forEach((m, i) => {
    if (!m) return
    const r = Math.floor(i / cols), c = i % cols
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r)
  })
  return { minDc: -minC, maxDc: cols - 1 - maxC, minDr: -minR, maxDr: rows - 1 - maxR }
}

/**
 * Moves the selected cells by (dc, dr). The cells they leave become `empty`. Beads replace
 * whatever is under their new position; empty cells in the selection are see-through (they
 * don't wipe out beads they land on). Returns the new cells and where the selection now is.
 */
export function moveSelection<T>(cells: T[], mask: boolean[], cols: number, rows: number, dc: number, dr: number, empty: T) {
  const out = cells.slice()
  const moved = new Array<boolean>(cells.length).fill(false)
  mask.forEach((m, i) => { if (m) out[i] = empty })
  mask.forEach((m, i) => {
    if (!m) return
    const r = Math.floor(i / cols) + dr, c = (i % cols) + dc
    if (r < 0 || c < 0 || r >= rows || c >= cols) return
    moved[r * cols + c] = true
    if (cells[i] !== empty) out[r * cols + c] = cells[i]
  })
  return { cells: out, mask: moved }
}
