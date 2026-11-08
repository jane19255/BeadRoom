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
