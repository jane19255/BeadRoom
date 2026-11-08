"use client"

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { hexToRgb, luminance } from "@/lib/pattern/decode"
import { cellsBetween } from "@/lib/pattern/edit"

export type GridCanvasProps = {
  cols: number
  rows: number
  /** Palette index for every cell, row by row; -1 = empty (no bead). */
  cells: number[]
  /** Hex colour per palette index. */
  colours: string[]
  /** Code per palette index (shown in cells when zoomed in). */
  codes: string[]
  /** Palette index to highlight; every other colour is faded. */
  focus?: number | null
  /** One character per cell, "1" = placed (drawn faded with a tick). */
  done?: string
  /** Cells to outline in red (worth checking). */
  flagged?: boolean[]
  /** Row to outline (0-based). */
  currentRow?: number | null
  onCellTap?: (index: number) => void
  /** Thicker guide lines every `size` cells (0 = none), starting after `col`/`row` cells, in `color`. */
  guide?: { size: number; col: number; row: number; color?: string | null }
  /** Changes when the grid should zoom to fit again (e.g. a new pattern). */
  fitKey?: string | number
  /**
   * Paint mode: Pencil, mouse or one finger paints cells (tap or drag); two fingers pan and pinch.
   * Once the Pencil has been used, a single finger no longer paints (so a resting palm can't).
   * onPaintStart runs once per stroke (for undo), onPaint for every cell the stroke touches.
   */
  painting?: boolean
  onPaintStart?: () => void
  onPaint?: (index: number) => void
  /** Shown floating over the grid in full screen (e.g. colour + undo while drawing). */
  fullscreenTools?: ReactNode
}

type View = { scale: number; x: number; y: number }

const AXIS = 22 // px reserved for row/column numbers
const MIN_SCALE = 3
const MAX_SCALE = 80

function mix(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const m = (v: number) => Math.round(v + (255 - v) * amount)
  return `rgb(${m(r)},${m(g)},${m(b)})`
}

export function GridCanvas(props: GridCanvasProps) {
  const { cols, rows, cells, colours, codes, focus = null, done, flagged, currentRow = null, onCellTap, fitKey, painting = false, onPaintStart, onPaint, fullscreenTools } = props
  const guide = props.guide ?? { size: 5, col: Math.floor((cols % 5) / 2), row: Math.floor((rows % 5) / 2) }
  // Is the line before cell `n` (0..count) a thick one? Outer edges always are.
  const isMajor = (n: number, count: number, offset: number) =>
    n === 0 || n === count || (guide.size > 0 && (n - offset) % guide.size === 0 && n > 0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ scale: 10, x: AXIS, y: AXIS })
  const viewRef = useRef(view)
  viewRef.current = view

  // Track the container size.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function fit() {
    if (!size.w || !size.h) return
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((size.w - AXIS - 8) / cols, (size.h - AXIS - 8) / rows)))
    setView({ scale, x: AXIS + (size.w - AXIS - cols * scale) / 2, y: AXIS + (size.h - AXIS - rows * scale) / 2 })
  }

  // Fit when first shown, when the size first becomes known, or when asked to.
  const fittedFor = useRef<string>("")
  useEffect(() => {
    const key = `${fitKey}|${cols}x${rows}|${size.w > 0}`
    if (size.w && fittedFor.current !== key) {
      fittedFor.current = key
      fit()
    }
  }) // eslint-disable-line react-hooks/exhaustive-deps

  function zoomAt(factor: number, sx: number, sy: number) {
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor))
      const k = scale / v.scale
      return { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k }
    })
  }

  // Keep a row in view when it changes (row-by-row mode).
  useEffect(() => {
    if (currentRow === null || !size.h) return
    setView((v) => {
      const top = v.y + currentRow * v.scale
      const bottom = top + v.scale
      if (top >= AXIS + 4 && bottom <= size.h - 4) return v
      return { ...v, y: AXIS + (size.h - AXIS) / 2 - (currentRow + 0.5) * v.scale }
    })
  }, [currentRow, size.h])

  /* ------------------------------ drawing ------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = "#f8f7f2"
    ctx.fillRect(0, 0, size.w, size.h)

    const { scale: s, x: ox, y: oy } = view
    const c0 = Math.max(0, Math.floor((AXIS - ox) / s)), c1 = Math.min(cols, Math.ceil((size.w - ox) / s))
    const r0 = Math.max(0, Math.floor((AXIS - oy) / s)), r1 = Math.min(rows, Math.ceil((size.h - oy) / s))

    // Precompute display colours per palette index.
    const faded = colours.map((c) => mix(c, 0.82))
    const placed = colours.map((c) => mix(c, 0.6))

    const showText = s >= 18
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.font = `600 ${Math.max(8, Math.min(15, s * 0.32))}px system-ui, sans-serif`

    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * cols + c
        const p = cells[i]
        if (p < 0) { // empty: light checkerboard, no code, never faded or marked
          const x = ox + c * s, y = oy + r * s
          // Grey (not white) so empty cells never look like white H2 beads.
          ctx.fillStyle = "#e4e4de"
          ctx.fillRect(x, y, s + 0.5, s + 0.5)
          if (s >= 8) {
            ctx.fillStyle = "#cfd0c8"
            const h = s / 2
            ctx.fillRect(x, y, h, h)
            ctx.fillRect(x + h, y + h, h + 0.5, h + 0.5)
          }
          continue
        }
        const isDone = done?.[i] === "1"
        const dim = focus !== null && p !== focus
        const x = ox + c * s, y = oy + r * s
        ctx.fillStyle = dim ? faded[p] : isDone ? placed[p] : colours[p]
        ctx.fillRect(x, y, s + 0.5, s + 0.5)
        if (showText && !dim) {
          ctx.fillStyle = isDone ? "rgba(32,37,31,0.55)" : luminance(colours[p]) > 150 ? "#20251f" : "#ffffff"
          ctx.fillText(isDone ? "✓" : codes[p], x + s / 2, y + s / 2 + 0.5)
        }
      }
    }

    // Grid lines: light between every cell, thick guide lines between blocks (e.g. 5×5).
    const [lr, lg, lb] = hexToRgb(guide.color || "#20251f")
    const thinColour = `rgba(${lr},${lg},${lb},${guide.color ? 0.35 : 0.12})`
    const thickColour = `rgba(${lr},${lg},${lb},${guide.color ? 0.95 : 0.6})`
    const thick = Math.max(1.5, Math.min(2.5, s * 0.08))
    for (let c = c0; c <= c1; c++) {
      const major = isMajor(c, cols, guide.col)
      if (!major && s < 5) continue
      ctx.fillStyle = major ? thickColour : thinColour
      const w = major ? thick : 0.5
      ctx.fillRect(Math.round(ox + c * s) - w / 2, oy + r0 * s, w, (r1 - r0) * s)
    }
    for (let r = r0; r <= r1; r++) {
      const major = isMajor(r, rows, guide.row)
      if (!major && s < 5) continue
      ctx.fillStyle = major ? thickColour : thinColour
      const w = major ? thick : 0.5
      ctx.fillRect(ox + c0 * s, Math.round(oy + r * s) - w / 2, (c1 - c0) * s, w)
    }

    // Cells worth checking.
    if (flagged) {
      ctx.strokeStyle = "#e0322b"
      ctx.lineWidth = Math.max(1.5, Math.min(3, s * 0.12))
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
        if (!flagged[r * cols + c]) continue
        const inset = ctx.lineWidth / 2 + 0.5
        ctx.strokeRect(ox + c * s + inset, oy + r * s + inset, s - 2 * inset, s - 2 * inset)
      }
    }

    // Current row.
    if (currentRow !== null && currentRow >= 0 && currentRow < rows) {
      ctx.strokeStyle = "#f2a900"
      ctx.lineWidth = 3
      ctx.strokeRect(ox - 1.5, oy + currentRow * s - 1.5, cols * s + 3, s + 3)
    }

    // Axis numbers.
    ctx.fillStyle = "#f8f7f2"
    ctx.fillRect(0, 0, size.w, AXIS)
    ctx.fillRect(0, 0, AXIS, size.h)
    ctx.font = "500 10px system-ui, sans-serif"
    // Numbers: all of them when zoomed in, otherwise the first cell of each block (+ first/last).
    const blockStart = (n: number, offset: number) => guide.size > 0 && (n - 1 - offset) % guide.size === 0 && n - 1 >= offset
    const showAll = s >= 14
    // First/last numbers are shown too, unless a block-start number sits right next to them.
    const edgeLabel = (n: number, count: number, offset: number) =>
      (n === 1 || n === count) && ![-2, -1, 1, 2].some((d) => blockStart(n + d, offset) && n + d >= 1 && n + d <= count)
    for (let c = c0; c < c1; c++) {
      const n = c + 1, start = blockStart(n, guide.col)
      if (!showAll && !start && !edgeLabel(n, cols, guide.col)) continue
      if (!showAll && s < 7 && guide.size > 0 && ((n - 1 - guide.col) / guide.size) % 2 === 1) continue // every other block when tiny
      ctx.fillStyle = start ? "#20251f" : "#9a9f97"
      ctx.fillText(String(n), ox + c * s + s / 2, AXIS / 2)
    }
    for (let r = r0; r < r1; r++) {
      const n = r + 1, start = blockStart(n, guide.row)
      if (!showAll && !start && !edgeLabel(n, rows, guide.row) && r !== currentRow) continue
      if (!showAll && currentRow !== null && r !== currentRow && Math.abs(r - currentRow) * s < 14) continue // don't crowd the current row's number
      if (!showAll && s < 7 && r !== currentRow && guide.size > 0 && ((n - 1 - guide.row) / guide.size) % 2 === 1) continue
      ctx.fillStyle = r === currentRow ? "#b07a00" : start ? "#20251f" : "#9a9f97"
      ctx.fillText(String(n), AXIS / 2, oy + r * s + s / 2)
    }
  }, [view, size, cols, rows, cells, colours, codes, focus, done, flagged, currentRow, guide.size, guide.col, guide.row, guide.color]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------- interaction ---------------------------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; dist: number; mid: { x: number; y: number } } | null>(null)
  // Painting: which pointer is drawing, and the last cell it painted.
  const stroke = useRef<{ id: number; last: { c: number; r: number } | null } | null>(null)
  const penSeen = useRef(false)

  function local(e: { clientX: number; clientY: number }) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function cellAt(p: { x: number; y: number }) {
    const v = viewRef.current
    const c = Math.floor((p.x - v.x) / v.scale), r = Math.floor((p.y - v.y) / v.scale)
    return p.x > AXIS && p.y > AXIS && c >= 0 && r >= 0 && c < cols && r < rows ? { c, r } : null
  }

  function paintTo(p: { x: number; y: number }) {
    if (!stroke.current || !onPaint) return
    const cell = cellAt(p)
    if (!cell) { stroke.current.last = null; return }
    const from = stroke.current.last ?? cell
    for (const step of cellsBetween(from, cell)) onPaint(step.r * cols + step.c)
    stroke.current.last = cell
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = local(e)
    if (e.pointerType === "pen") penSeen.current = true
    // Paint with Pencil / mouse, or a finger when no Pencil has been used. A second finger turns it into a pan/zoom.
    const canPaint = painting && onPaint && (e.pointerType !== "touch" || !penSeen.current)
    if (canPaint && pointers.current.size === 0) {
      pointers.current.set(e.pointerId, p)
      stroke.current = { id: e.pointerId, last: null }
      onPaintStart?.()
      paintTo(p)
      gesture.current = { moved: true, startX: p.x, startY: p.y, dist: 0, mid: p }
      return
    }
    if (e.pointerType === "pen" && painting) return // never pan with the Pencil while painting
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 1) gesture.current = { moved: false, startX: p.x, startY: p.y, dist: 0, mid: p }
    if (pointers.current.size === 2) {
      stroke.current = null // second finger: stop painting, start pan/zoom
      const [a, b] = [...pointers.current.values()]
      gesture.current = { moved: true, startX: 0, startY: 0, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev || !gesture.current) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (stroke.current?.id === e.pointerId) { paintTo(p); return }
    if (pointers.current.size === 1) {
      if (!gesture.current.moved && Math.hypot(p.x - gesture.current.startX, p.y - gesture.current.startY) < 6) return
      gesture.current.moved = true
      setView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }))
    } else if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom and drag to move, at the same time.
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = gesture.current.dist > 0 ? dist / gesture.current.dist : 1
      const dx = mid.x - gesture.current.mid.x, dy = mid.y - gesture.current.mid.y
      setView((v) => {
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * k))
        const kk = scale / v.scale
        return { scale, x: mid.x - (mid.x - v.x) * kk + dx, y: mid.y - (mid.y - v.y) * kk + dy }
      })
      gesture.current.dist = dist
      gesture.current.mid = mid
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    const wasTap = pointers.current.size === 1 && gesture.current && !gesture.current.moved && !stroke.current
    pointers.current.delete(e.pointerId)
    if (stroke.current?.id === e.pointerId) stroke.current = null
    if (pointers.current.size === 0) {
      if (wasTap && onCellTap) {
        const cell = cellAt(local(e))
        if (cell) onCellTap(cell.r * cols + cell.c)
      }
      gesture.current = null
    } else if (pointers.current.size === 1) {
      // One finger left after a pinch: carry on panning from where it is.
      const [rest] = [...pointers.current.values()]
      gesture.current = { moved: true, startX: rest.x, startY: rest.y, dist: 0, mid: rest }
    }
  }

  /* ----------------------------- full screen ----------------------------- */
  // Grid fills the whole screen (sidebar, header and controls hidden); zoom/pan/paint still work.
  // Uses the browser's real full screen where allowed, and a full-window view otherwise.
  const [full, setFull] = useState(false)
  type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> }
  type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
  function enterFull() {
    setFull(true)
    const el = wrapRef.current as FsEl | null
    try {
      const req = el?.requestFullscreen?.bind(el) ?? el?.webkitRequestFullscreen?.bind(el)
      const result = req?.()
      if (result && typeof (result as Promise<void>).catch === "function") (result as Promise<void>).catch(() => {})
    } catch { /* full-window view still works */ }
  }
  function exitFull() {
    setFull(false)
    const doc = document as FsDoc
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      try { void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch?.(() => {}) } catch { /* ignore */ }
    }
  }
  useEffect(() => {
    if (!full) return
    const doc = document as FsDoc
    const onChange = () => { if (!doc.fullscreenElement && !doc.webkitFullscreenElement) setFull(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitFull() }
    document.addEventListener("fullscreenchange", onChange)
    document.addEventListener("webkitfullscreenchange", onChange)
    window.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      document.removeEventListener("webkitfullscreenchange", onChange)
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = overflow
    }
  }, [full]) // eslint-disable-line react-hooks/exhaustive-deps
  // Re-fit when entering/leaving full screen. The box only gets its new size a moment later
  // (and full screen can settle in steps), so re-fit on size changes for a short while.
  const refitUntil = useRef(0)
  const lastFull = useRef(full)
  useEffect(() => {
    if (lastFull.current !== full) { lastFull.current = full; refitUntil.current = Date.now() + 800 }
    if (size.w && Date.now() < refitUntil.current) fit()
  }, [full, size.w, size.h]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse wheel / trackpad zoom (needs a non-passive listener to stop the page scrolling).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), e.clientX - rect.left, e.clientY - rect.top)
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
      }
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [])

  return (
    <div className={`grid-canvas ${full ? "grid-canvas--full" : ""} ${painting ? "grid-canvas--painting" : ""}`} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="grid-canvas__zoom">
        <button aria-label="Zoom in" onClick={() => zoomAt(1.4, size.w / 2, size.h / 2)} type="button">+</button>
        <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.4, size.w / 2, size.h / 2)} type="button">−</button>
        <button aria-label="Fit whole pattern" onClick={fit} type="button">⤢</button>
        {!full && <button aria-label="Full screen" title="Full screen" onClick={enterFull} type="button">⛶</button>}
      </div>
      {full && (
        <>
          <button className="grid-canvas__exit" onClick={exitFull} type="button">✕ Exit full screen</button>
          {fullscreenTools && <div className="grid-canvas__tools">{fullscreenTools}</div>}
        </>
      )}
    </div>
  )
}
