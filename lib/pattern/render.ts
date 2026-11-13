/**
 * Picture of a bead pattern: only the beads, cropped to the design, with empty cells left
 * see-through (transparent PNG). Used as a project's picture. Browser only.
 *
 * `colourAt(i)` gives the hex colour of cell i (row by row), or null for an empty cell.
 * Returns null if the pattern has no beads.
 */
export function renderPatternPicture(cols: number, rows: number, colourAt: (i: number) => string | null): string | null {
  let minC = cols, maxC = -1, minR = rows, maxR = -1
  for (let i = 0; i < cols * rows; i++) {
    if (!colourAt(i)) continue
    const r = Math.floor(i / cols), c = i % cols
    if (c < minC) minC = c
    if (c > maxC) maxC = c
    if (r < minR) minR = r
    if (r > maxR) maxR = r
  }
  if (maxC < 0) return null
  const w = maxC - minC + 1, h = maxR - minR + 1
  const cell = Math.max(4, Math.min(40, Math.floor(1200 / Math.max(w, h)))) // ~1200 px on the long side
  const canvas = document.createElement("canvas")
  canvas.width = w * cell
  canvas.height = h * cell
  const ctx = canvas.getContext("2d")!
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const colour = colourAt(r * cols + c)
      if (!colour) continue
      ctx.fillStyle = colour
      ctx.fillRect((c - minC) * cell, (r - minR) * cell, cell, cell)
    }
  }
  return canvas.toDataURL("image/png")
}
