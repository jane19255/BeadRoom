/**
 * Reads a bead pattern grid from a screenshot.
 *
 * It does NOT read the printed codes (they blur and get covered by watermarks).
 * It reads each cell's colour and matches it to the project's recipe colours:
 *   1. Sample a ring of pixels just inside each cell's border (the code text sits in the middle).
 *   2. Each pixel votes for its nearest recipe colour (in Lab colour space, close to how eyes see colour).
 *   3. Recalibrate each recipe colour to how it actually looks in this screenshot, then vote again.
 *   4. If the recipe has bead counts, nudge the least-certain cells so every colour's total matches.
 * Cells that were unsure or changed in step 4 are flagged for the user to check.
 *
 * Pure functions on RGBA pixel data: no React, no DOM, no Supabase.
 */

export type Rgb = [number, number, number]
export type Lab = [number, number, number]

export type PixelImage = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

/** Grid edges in image pixels (x1/y1 are the right/bottom edges). */
export type GridBox = { x0: number; y0: number; x1: number; y1: number }

export type PaletteEntry = {
  code: string
  /** Saved colour (from the colour table). */
  hex: string
  /** Bead count from the recipe, used to check and correct the reading. */
  count?: number
  /** Colour the user picked from the screenshot itself: trusted over everything else. */
  picked?: string
}

/** Cell value meaning "no bead here" (transparent / empty background). */
export const EMPTY = -1

export type DecodeResult = {
  /** Index into the palette for every cell, row by row, or EMPTY (-1) for no bead. */
  cells: number[]
  /** How many cells were read as empty. */
  emptyCount: number
  /** true = worth a second look (low agreement, or changed to make the counts match). */
  flagged: boolean[]
  /** How many cells ended up with each palette colour. */
  counts: number[]
  /** True when the palette had counts and every count now matches. */
  countsMatch: boolean
  /** Each palette colour as it appears in this screenshot. */
  observed: string[]
}

/* ------------------------------------------------------------------ */
/* Colour helpers                                                       */
/* ------------------------------------------------------------------ */

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("")
  const n = parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) return [204, 204, 204]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")
}

const LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92
}

function labF(t: number) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = LINEAR[r | 0], lg = LINEAR[g | 0], lb = LINEAR[b | 0]
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883
  const fx = labF(x), fy = labF(y), fz = labF(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function labToRgb([L, A, B]: Lab): Rgb {
  const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883
  const lin = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ]
  return lin.map((c) => 255 * (c > 0.0031308 ? 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055 : 12.92 * c)) as Rgb
}

/** Relative brightness 0..255, used to pick black or white text on a colour. */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/* ------------------------------------------------------------------ */
/* Finding the grid                                                    */
/* ------------------------------------------------------------------ */

function pixel(img: PixelImage, x: number, y: number): Rgb {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

function dist2(a: Lab, b: Lab) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

/** Longest run of indexes where `ok[i]` is true. */
function longestRun(ok: boolean[]): [number, number] {
  let best: [number, number] = [0, ok.length]
  let bestLen = 0
  let start = -1
  for (let i = 0; i <= ok.length; i++) {
    if (i < ok.length && ok[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      if (i - start > bestLen) { bestLen = i - start; best = [start, i] }
      start = -1
    }
  }
  return best
}

/**
 * Best guess at where the grid is: the largest block of the image that isn't page background.
 * The user can drag the corners afterwards.
 */
export function guessGridBox(img: PixelImage): GridBox {
  const { width: w, height: h } = img
  // Page background = typical colour of the four corners.
  const corners: Lab[] = []
  for (const [cx, cy] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) corners.push(rgbToLab(...pixel(img, cx, cy)))
  corners.sort((a, b) => a[0] - b[0])
  const bg = corners[1]

  const step = Math.max(1, Math.floor(Math.min(w, h) / 400))
  const isContent = (x: number, y: number) => dist2(rgbToLab(...pixel(img, x, y)), bg) > 8 * 8 // low enough that white "empty" cells on a light-grey page still count

  const colShare: boolean[] = []
  for (let x = 0; x < w; x++) {
    let hit = 0, total = 0
    for (let y = 0; y < h; y += step) { total++; if (isContent(x, y)) hit++ }
    colShare.push(hit / total > 0.35)
  }
  const [x0, x1] = longestRun(colShare)

  const rowShare: boolean[] = []
  for (let y = 0; y < h; y++) {
    let hit = 0, total = 0
    for (let x = x0; x < x1; x += step) { total++; if (isContent(x, y)) hit++ }
    rowShare.push(hit / total > 0.5)
  }
  const [y0, y1] = longestRun(rowShare)
  return { x0, y0, x1, y1 }
}

/** Strength of edges along one direction, used to find the repeating cell size. */
function edgeProfile(img: PixelImage, box: GridBox, vertical: boolean): number[] {
  const len = Math.round(vertical ? box.x1 - box.x0 : box.y1 - box.y0)
  const across = Math.round(vertical ? box.y1 - box.y0 : box.x1 - box.x0)
  const step = Math.max(1, Math.floor(across / 300))
  const profile = new Array(len).fill(0)
  for (let i = 1; i < len; i++) {
    let sum = 0
    for (let j = 0; j < across; j += step) {
      const x = Math.round(vertical ? box.x0 + i : box.x0 + j)
      const y = Math.round(vertical ? box.y0 + j : box.y0 + i)
      const a = pixel(img, x, y), b = vertical ? pixel(img, x - 1, y) : pixel(img, x, y - 1)
      sum += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    }
    profile[i] = sum
  }
  return profile
}

/**
 * Finds the cell size (in pixels) from how the edge pattern repeats along a profile.
 * Cell borders and the code text inside each cell both repeat once per cell, so the
 * profile lines up with itself when shifted by one cell. Measuring the shift over
 * many cells (not just one) makes the size precise to a fraction of a pixel.
 */
function cellSize(profile: number[]): number | null {
  const n = profile.length
  const mean = profile.reduce((s, v) => s + v, 0) / n
  const p = profile.map((v) => v - mean)
  const maxLag = Math.floor(n / 3)
  const scores = new Float64Array(maxLag + 2)
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i++) s += p[i] * p[i + lag]
    scores[lag] = s / (n - lag)
  }
  const isPeak = (lag: number) => scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]
  const refine = (lag: number) => {
    const a = scores[lag - 1], b = scores[lag], c = scores[lag + 1]
    const d = a - 2 * b + c
    return lag + (d !== 0 ? (0.5 * (a - c)) / d : 0)
  }

  // 1. Rough size: the strongest repeat, preferring the smallest size that's nearly as strong
  //    (so two cells aren't mistaken for one).
  let bestLag = -1, best = -Infinity
  for (let lag = 4; lag <= maxLag; lag++) if (isPeak(lag) && scores[lag] > best) { best = scores[lag]; bestLag = lag }
  if (bestLag < 0 || best <= 0) return null
  for (let lag = 4; lag < bestLag; lag++) if (isPeak(lag) && scores[lag] > best * 0.7) { bestLag = lag; break }
  const rough = refine(bestLag)

  // 2. Precise size: find the repeat m cells away and divide by m.
  const m = Math.floor(maxLag / rough)
  if (m < 2) return rough
  let farLag = Math.round(m * rough)
  const lo = Math.max(4, Math.round(m * rough - rough / 3)), hi = Math.min(maxLag, Math.round(m * rough + rough / 3))
  for (let lag = lo; lag <= hi; lag++) if (scores[lag] > scores[farLag]) farLag = lag
  return refine(farLag) / m
}

/** Best guess at the number of columns and rows inside the box. */
export function guessGridSize(img: PixelImage, box: GridBox): { cols: number; rows: number } | null {
  const w = cellSize(edgeProfile(img, box, true))
  const h = cellSize(edgeProfile(img, box, false))
  if (!w && !h) return null
  // Cells are square, so if only one direction was found, use it for both.
  const cols = Math.round((box.x1 - box.x0) / (w ?? h!))
  const rows = Math.round((box.y1 - box.y0) / (h ?? w!))
  if (cols < 2 || rows < 2 || cols > 300 || rows > 300) return null
  return { cols, rows }
}

/* ------------------------------------------------------------------ */
/* Reading the cells                                                   */
/* ------------------------------------------------------------------ */

/** Ring of pixels just inside each cell's border, as Lab colours. */
function sampleCells(img: PixelImage, box: GridBox, cols: number, rows: number): Float32Array[] {
  const cw = (box.x1 - box.x0) / cols
  const ch = (box.y1 - box.y0) / rows
  const ring = Math.max(2, Math.round(Math.min(cw, ch) * 0.22))
  // Keep big screenshots fast: sample at most ~120 pixels per cell.
  const area = Math.max(1, cw * ch)
  const stride = Math.max(1, Math.floor(Math.sqrt(area / 400)))
  const out: Float32Array[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xa = Math.round(box.x0 + c * cw) + 1, xb = Math.round(box.x0 + (c + 1) * cw) - 1
      const ya = Math.round(box.y0 + r * ch) + 1, yb = Math.round(box.y0 + (r + 1) * ch) - 1
      const values: number[] = []
      for (let y = ya; y < yb; y += stride) {
        for (let x = xa; x < xb; x += stride) {
          const inside = x >= xa + ring && x < xb - ring && y >= ya + ring && y < yb - ring
          if (inside) continue // skip the middle where the code text is
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
          const lab = rgbToLab(...pixel(img, x, y))
          values.push(lab[0], lab[1], lab[2])
        }
      }
      out.push(Float32Array.from(values))
    }
  }
  return out
}

/**
 * How much "printed code" each cell has: the share of pixels in the middle of the cell that
 * clearly differ from the cell's own colour. Bead cells have a code printed in them
 * (e.g. "H2"); empty cells don't, which is how a white H2 bead is told apart from an empty
 * white background.
 */
function textScores(img: PixelImage, box: GridBox, cols: number, rows: number, cellCols: Lab[]): number[] {
  const cw = (box.x1 - box.x0) / cols
  const ch = (box.y1 - box.y0) / rows
  const ring = Math.max(2, Math.round(Math.min(cw, ch) * 0.22))
  const stride = Math.max(1, Math.floor(Math.sqrt(Math.max(1, cw * ch) / 400)))
  const out: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xa = Math.round(box.x0 + c * cw) + 1 + ring, xb = Math.round(box.x0 + (c + 1) * cw) - 1 - ring
      const ya = Math.round(box.y0 + r * ch) + 1 + ring, yb = Math.round(box.y0 + (r + 1) * ch) - 1 - ring
      const base = cellCols[r * cols + c]
      let ink = 0, total = 0
      for (let y = ya; y < yb; y += stride) {
        for (let x = xa; x < xb; x += stride) {
          if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
          total++
          if (dist2(rgbToLab(...pixel(img, x, y)), base) > 22 * 22) ink++
        }
      }
      out.push(total ? ink / total : 0)
    }
  }
  return out
}

/** Below this share of "printed code" pixels a cell counts as blank. */
const BLANK_TEXT = 0.035

/** Share of each cell's pixels voting for each colour → cost (0 = all pixels agree). */
function voteCosts(samples: Float32Array[], refs: Lab[]): Float32Array[] {
  const k = refs.length
  return samples.map((px) => {
    const votes = new Float32Array(k)
    const n = px.length / 3
    for (let p = 0; p < px.length; p += 3) {
      let best = 0, bestD = Infinity
      for (let j = 0; j < k; j++) {
        const d = (px[p] - refs[j][0]) ** 2 + (px[p + 1] - refs[j][1]) ** 2 + (px[p + 2] - refs[j][2]) ** 2
        if (d < bestD) { bestD = d; best = j }
      }
      votes[best]++
    }
    const cost = new Float32Array(k)
    for (let j = 0; j < k; j++) cost[j] = n ? 1 - votes[j] / n : 1
    return cost
  })
}

function argmin(a: Float32Array) {
  let best = 0
  for (let i = 1; i < a.length; i++) if (a[i] < a[best]) best = i
  return best
}

/** Per-channel median of a cell's sampled pixels: its main colour, ignoring stray text/watermark pixels. */
function cellColour(px: Float32Array): Lab {
  const n = px.length / 3
  if (!n) return [0, 0, 0]
  const ch = (o: number) => {
    const v: number[] = []
    for (let p = o; p < px.length; p += 3) v.push(px[p])
    v.sort((a, b) => a - b)
    return v[v.length >> 1]
  }
  return [ch(0), ch(1), ch(2)]
}

function nearest(colour: Lab, refs: Lab[]) {
  let best = 0, bestD = Infinity
  for (let j = 0; j < refs.length; j++) {
    const d = dist2(colour, refs[j])
    if (d < bestD) { bestD = d; best = j }
  }
  return best
}

function medianLab(points: Lab[]): Lab {
  const m = (o: number) => points.map((p) => p[o]).sort((a, b) => a - b)[points.length >> 1]
  return [m(0), m(1), m(2)]
}

/**
 * Screenshots usually show every colour shifted the same way (a bit darker, warmer, …).
 * Learn that shift as out = a·in + b per RGB channel, from cells that clearly match a saved colour.
 */
function learnColourShift(cellCols: Lab[], saved: Rgb[]): (rgb: Rgb) => Rgb {
  let shift = (rgb: Rgb) => rgb
  for (let pass = 0; pass < 4; pass++) {
    const refs = saved.map((rgb) => rgbToLab(...clampRgb(shift(rgb))))
    const groups: Lab[][] = saved.map(() => [])
    cellCols.forEach((c) => groups[nearest(c, refs)].push(c))
    // pairs: (saved colour, how that colour's cells actually look), weighted by how many cells
    const pairs = groups
      .map((g, j) => ({ from: saved[j], to: g.length >= 3 ? labToRgb(medianLab(g)) : null, w: Math.sqrt(g.length) }))
      .filter((p): p is { from: Rgb; to: Rgb; w: number } => p.to !== null)
    const fit = fitShift(pairs)
    if (!fit) break
    shift = fit
  }
  return shift
}

/** Least-squares out = a·in + b per RGB channel from (saved, observed) colour pairs. */
function fitShift(pairs: { from: Rgb; to: Rgb; w: number }[]): ((rgb: Rgb) => Rgb) | null {
  if (pairs.length < 3) return null
  const fit = [0, 1, 2].map((c) => {
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
    for (const { from, to, w } of pairs) { sw += w; sx += w * from[c]; sy += w * to[c]; sxx += w * from[c] ** 2; sxy += w * from[c] * to[c] }
    const den = sw * sxx - sx * sx
    const a = den > 1e-6 ? (sw * sxy - sx * sy) / den : 1
    const safeA = Math.max(0.6, Math.min(1.5, a)) // a screenshot never changes contrast wildly
    return { a: safeA, b: (sy - safeA * sx) / sw }
  })
  return (rgb: Rgb) => [0, 1, 2].map((c) => fit[c].a * rgb[c] + fit[c].b) as Rgb
}

function clampRgb(rgb: Rgb): Rgb {
  return rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as Rgb
}

/** Hungarian algorithm: cheapest one-to-one pairing of rows and columns of a square cost matrix. */
function cheapestPairing(cost: number[][]): number[] {
  const n = cost.length
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0)
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity, j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0 }
        if (minv[j] < delta) { delta = minv[j]; j1 = j }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta } else minv[j] -= delta
      }
      j0 = j1
    } while (p[j0] !== 0)
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1 } while (j0)
  }
  const rowToCol = new Array(n).fill(-1)
  for (let j = 1; j <= n; j++) if (p[j] > 0) rowToCol[p[j] - 1] = j - 1
  return rowToCol
}

type Grouping = { centres: Lab[]; groups: number[] }

function kMeans(points: Lab[], start: Lab[]): Grouping {
  const centres = start.map((c) => [...c] as Lab)
  let groups: number[] = []
  for (let pass = 0; pass < 15; pass++) {
    groups = points.map((p) => nearest(p, centres))
    for (let j = 0; j < centres.length; j++) {
      const members = points.filter((_, i) => groups[i] === j)
      if (members.length) centres[j] = medianLab(members)
    }
  }
  return { centres, groups }
}

/** k-means where some centres are fixed (colours the user picked). */
function kMeansKeeping(points: Lab[], start: Lab[], fixed: (Lab | null)[]): Lab[] {
  const centres = start.map((c, j) => [...(fixed[j] ?? c)] as Lab)
  for (let pass = 0; pass < 10; pass++) {
    const groups = points.map((p) => nearest(p, centres))
    for (let j = 0; j < centres.length; j++) {
      if (fixed[j]) continue
      const members = points.filter((_, i) => groups[i] === j)
      if (members.length) centres[j] = medianLab(members)
    }
  }
  return centres
}

/** Several k-means groupings: one started from the expected recipe colours, the rest from k-means++. */
function candidateGroupings(points: Lab[], expected: Lab[]): Grouping[] {
  const k = expected.length
  let seed = 12345
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const out = [kMeans(points, expected)]
  const runs = points.length > 20000 ? 3 : 7
  for (let run = 0; run < runs; run++) {
    // k-means++: each new centre is picked far from the existing ones.
    const centres: Lab[] = [points[Math.floor(random() * points.length)]]
    const d = points.map((p) => dist2(p, centres[0]))
    while (centres.length < k) {
      const total = d.reduce((s, v) => s + v, 0)
      let r = random() * total, idx = 0
      while (idx < points.length - 1 && r > d[idx]) { r -= d[idx]; idx++ }
      centres.push(points[idx])
      for (let i = 0; i < points.length; i++) d[i] = Math.min(d[i], dist2(points[i], points[idx]))
    }
    out.push(kMeans(points, centres))
  }
  return out
}

/** How badly cells assigned to their nearest reference colour miss the recipe counts. */
function countMiss(cellCols: Lab[], refs: Lab[], palette: PaletteEntry[]) {
  const sizes = refs.map(() => 0)
  cellCols.forEach((c) => sizes[nearest(c, refs)]++)
  return sizes.reduce((s, n, j) => s + Math.abs(n - (palette[j].count ?? n)), 0)
}

/**
 * Decides how each recipe colour looks in this screenshot. Tries several ideas and keeps the
 * one whose cell totals best match the recipe counts (earlier ideas win ties):
 *   1. the saved colours as they are (screenshots from pattern apps usually use exact colours)
 *   2. the saved colours after learning an overall shift (photos: darker, warmer, …)
 *   3. colour groups found in the screenshot alone, paired with recipe colours by look + count
 */
function calibrate(cellCols: Lab[], palette: PaletteEntry[]): Lab[] {
  const saved = palette.map((p) => hexToRgb(p.hex))
  const direct: Lab[] = saved.map((rgb) => rgbToLab(...rgb))
  const shift = learnColourShift(cellCols, saved)
  const expected: Lab[] = saved.map((rgb) => rgbToLab(...clampRgb(shift(rgb))))
  const hasCounts = palette.every((p) => typeof p.count === "number")
  if (!hasCounts) {
    const picked = palette.map((p) => (p.picked ? rgbToLab(...hexToRgb(p.picked)) : null))
    return kMeansKeeping(cellCols, expected.map((r, j) => picked[j] ?? r), picked)
  }

  const candidates: Lab[][] = [direct, kMeans(cellCols, direct).centres, expected, kMeans(cellCols, expected).centres]
  for (const { centres, groups } of candidateGroupings(cellCols, expected).slice(1)) {
    const sizes = centres.map(() => 0)
    groups.forEach((g) => sizes[g]++)
    const cost = centres.map((centre, g) =>
      palette.map((p, j) => Math.sqrt(dist2(centre, expected[j])) / 12 + (2 * Math.abs(sizes[g] - p.count!)) / Math.max(p.count!, 5)),
    )
    const refs = expected.map((c) => [...c] as Lab)
    cheapestPairing(cost).forEach((j, g) => { if (j >= 0 && sizes[g] > 0) refs[j] = centres[g] })
    candidates.push(refs)
  }
  // 4. Learn the overall shift from the best screenshot-only pairing (most colours pair correctly
  //    even when look-alikes don't), then start the groups from the shifted saved colours.
  const paired = candidates.slice(4)
  if (paired.length) {
    const bestPaired = paired.reduce((a, b) => (countMiss(cellCols, a, palette) <= countMiss(cellCols, b, palette) ? a : b))
    const fit = fitShift(saved.map((from, j) => ({ from, to: labToRgb(bestPaired[j]), w: Math.sqrt(palette[j].count! + 1) })))
    if (fit) candidates.push(kMeans(cellCols, saved.map((rgb) => rgbToLab(...clampRgb(fit(rgb))))).centres)
  }

  // Colours the user picked from the screenshot are exact: use them in every idea.
  const picked = palette.map((p) => (p.picked ? rgbToLab(...hexToRgb(p.picked)) : null))
  if (picked.some(Boolean)) {
    const withPicked = candidates.map((refs) => refs.map((r, j) => picked[j] ?? r))
    candidates.length = 0
    for (const refs of withPicked) candidates.push(refs, kMeansKeeping(cellCols, refs, picked))
  }

  let best = candidates[0], bestMiss = Infinity
  for (const refs of candidates) {
    const miss = countMiss(cellCols, refs, palette)
    if (miss < bestMiss) { best = refs; bestMiss = miss }
  }
  return best
}

/**
 * Moves the least-certain cells from colours that have too many to colours that have too few,
 * until every count matches. Returns which cells were changed.
 */
function balanceCounts(cells: number[], costs: Float32Array[], target: number[]): Set<number> {
  const k = target.length
  const changed = new Set<number>()
  const count = new Array(k).fill(0)
  cells.forEach((c) => count[c]++)
  for (let guard = 0; guard < cells.length; guard++) {
    const over: number[] = [], under: number[] = []
    for (let j = 0; j < k; j++) {
      if (count[j] > target[j]) over.push(j)
      else if (count[j] < target[j]) under.push(j)
    }
    if (!over.length || !under.length) break
    let best = { extra: Infinity, cell: -1, to: -1 }
    for (let i = 0; i < cells.length; i++) {
      const from = cells[i]
      if (count[from] <= target[from]) continue
      for (const to of under) {
        const extra = costs[i][to] - costs[i][from]
        if (extra < best.extra) best = { extra, cell: i, to }
      }
    }
    if (best.cell < 0) break
    count[cells[best.cell]]--
    count[best.to]++
    cells[best.cell] = best.to
    changed.add(best.cell)
  }
  return changed
}

/** How much more of a cell's pixels the winning colour needs over the runner-up to count as sure. */
const FLAG_MARGIN = 0.12

export function decodePattern(img: PixelImage, box: GridBox, cols: number, rows: number, palette: PaletteEntry[]): DecodeResult {
  if (!palette.length) throw new Error("The recipe has no colours to match against.")
  const n = cols * rows
  const samples = sampleCells(img, box, cols, rows)
  const cellCols = samples.map(cellColour)

  const target = palette.map((p) => p.count ?? -1)
  const hasCounts = target.every((t) => t >= 0)
  const recipeTotal = target.reduce((s, t) => s + t, 0)

  // 1. Empty cells: if the recipe has fewer beads than the grid has cells, the difference is
  //    "no bead" cells. Pick the cells with no printed code in them (blankest first).
  const isEmpty = new Array<boolean>(n).fill(false)
  const flagged = new Array<boolean>(n).fill(false)
  const text = hasCounts && recipeTotal < n ? textScores(img, box, cols, rows, cellCols) : null
  if (text) {
    const want = n - recipeTotal
    const blankest = [...text.keys()].filter((i) => text[i] < BLANK_TEXT).sort((a, b) => text[a] - text[b])
    // Empty cells all look the same (the background). Learn that look from the clearest blank
    // cells, so a bead whose code happens to be hidden (e.g. under a watermark) isn't taken as empty.
    const sure = blankest.slice(0, Math.max(1, Math.min(want, blankest.length) >> 1))
    const emptyLook = sure.length ? medianLab(sure.map((i) => cellCols[i])) : null
    let taken = 0
    for (const i of blankest) {
      if (taken >= want) break
      if (emptyLook && dist2(cellCols[i], emptyLook) > 12 * 12) { flagged[i] = true; continue }
      isEmpty[i] = true
      taken++
    }
    // Borderline cells either side of the cut are worth a look.
    for (const i of blankest) if (text[i] > BLANK_TEXT * 0.5 && text[i] < BLANK_TEXT * 2) flagged[i] = true
  }

  // 2. Bead cells: learn how each recipe colour looks here, then every sampled pixel votes.
  const beadIdx = [...Array(n).keys()].filter((i) => !isEmpty[i])
  const refs = calibrate(beadIdx.map((i) => cellCols[i]), palette)
  const costs = voteCosts(beadIdx.map((i) => samples[i]), refs)
  const picks = costs.map(argmin)

  // Worth a second look: the winning colour only narrowly beat the runner-up.
  costs.forEach((cost, k) => {
    let second = Infinity
    for (let j = 0; j < cost.length; j++) if (j !== picks[k] && cost[j] < second) second = cost[j]
    if (second - cost[picks[k]] < FLAG_MARGIN) flagged[beadIdx[k]] = true
  })
  const canBalance = hasCounts && recipeTotal === beadIdx.length
  if (canBalance) for (const k of balanceCounts(picks, costs, target)) flagged[beadIdx[k]] = true

  const cells = new Array<number>(n).fill(EMPTY)
  beadIdx.forEach((i, k) => { cells[i] = picks[k] })
  const counts = new Array(palette.length).fill(0)
  picks.forEach((c) => counts[c]++)
  return {
    cells,
    emptyCount: n - beadIdx.length,
    flagged,
    counts,
    countsMatch: canBalance && counts.every((c, j) => c === target[j]),
    observed: refs.map((lab) => rgbToHex(labToRgb(lab))),
  }
}
