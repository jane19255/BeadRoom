"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { errorMessage, LoadingOverlay, SaveStatus, toast, useUnsavedChangesWarning, type SaveState } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { GridCanvas } from "@/components/pattern/grid-canvas"
import { useProjects } from "@/components/projects/projects-provider"
import { compareCodes } from "@/lib/beads"
import { autoGuideOffset, getPattern, saveGuide, savePatternCells, saveProgress, type StoredPattern } from "@/lib/pattern/store"
import { flipHorizontal, flipHorizontalText } from "@/lib/pattern/edit"
import { getPalette } from "@/lib/supabase/data"

/** Keeps the phone screen on while beading (where the browser supports it). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    type Sentinel = { release: () => Promise<void> }
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } }
    if (!nav.wakeLock) return
    let lock: Sentinel | null = null
    const request = () => { nav.wakeLock!.request("screen").then((l) => { lock = l }).catch(() => {}) }
    const onVisible = () => { if (document.visibilityState === "visible") request() }
    request()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      void lock?.release().catch(() => {})
    }
  }, [active])
}

type Box = { c0: number; c1: number; r0: number; r1: number; beads: number[] }

/** Grid line colours: dark (default) for light patterns, light/bright ones for dark patterns. */
const LINE_COLOURS: { name: string; hex: string | null }[] = [
  { name: "Dark", hex: null },
  { name: "White", hex: "#ffffff" },
  { name: "Grey", hex: "#9a9f97" },
  { name: "Red", hex: "#ff3b30" },
  { name: "Yellow", hex: "#ffd60a" },
  { name: "Cyan", hex: "#32d1ff" },
]

export default function BeadModePage() {
  const params = useParams<{ id: string }>()
  const { projects, loading: projectsLoading } = useProjects()
  const project = projects.find((item) => String(item.id) === params.id)
  const readOnly = project?.status === "Completed"
  const projectId = Number(params.id)

  const [pattern, setPattern] = useState<StoredPattern | null>(null)
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading")
  const [loadError, setLoadError] = useState("")
  const [hexByCode, setHexByCode] = useState<Map<string, string>>(new Map())
  const [done, setDone] = useState("")
  // Box-by-box: `working` is the box you're beading (saved, so you come back to it);
  // `viewing` is a box you tapped just to look at (never changes progress). Both are box numbers.
  const [working, setWorking] = useState(0)
  const [viewing, setViewing] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [tapToMark, setTapToMark] = useState(false)
  const [boxMode, setBoxMode] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [confirmReset, setConfirmReset] = useState(false)
  // Thick guide lines: block size and where blocks start (null = automatic, centred on the board).
  const [guideSize, setGuideSize] = useState(5)
  const [guideCol, setGuideCol] = useState<number | null>(null)
  const [guideRow, setGuideRow] = useState<number | null>(null)
  const [guideColor, setGuideColor] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([getPattern(projectId), getPalette().catch(() => [])])
      .then(([stored, palette]) => {
        if (cancelled) return
        setHexByCode(new Map(palette.map((p) => [p.code.toUpperCase(), p.colour])))
        if (!stored) { setLoadState("missing"); return }
        setPattern(stored)
        setDone(stored.done)
        setWorking(Math.max(0, stored.currentRow)) // the saved box number (checked against the boxes below)
        setGuideSize(stored.guideSize)
        setGuideCol(stored.guideColOffset)
        setGuideRow(stored.guideRowOffset)
        setGuideColor(stored.guideColor)
        setLoadState("ready")
      })
      .catch((err) => { if (!cancelled) { setLoadError(errorMessage(err)); setLoadState("error") } })
    return () => { cancelled = true }
  }, [projectId])

  useWakeLock(loadState === "ready")

  // Colours used in the pattern, in code order, with their totals.
  const legend = useMemo(() => {
    if (!pattern) return { codes: [] as string[], colours: [] as string[], cells: [] as number[] }
    const recipeHex = new Map((project?.recipe ?? []).map((r) => [r.code.toUpperCase(), r.colour]))
    // "" = empty cell (no bead): drawn as a gap, not a colour.
    const codes = [...new Set(pattern.cells)].filter((c) => c !== "").sort(compareCodes)
    const index = new Map(codes.map((c, i) => [c, i]))
    return {
      codes,
      colours: codes.map((c) => recipeHex.get(c.toUpperCase()) ?? hexByCode.get(c.toUpperCase()) ?? "#cccccc"),
      cells: pattern.cells.map((c) => (c === "" ? -1 : index.get(c)!)),
    }
  }, [pattern, project, hexByCode])

  const stats = useMemo(() => {
    const total = legend.codes.map(() => 0)
    const placed = legend.codes.map(() => 0)
    legend.cells.forEach((c, i) => { if (c < 0) return; total[c]++; if (done[i] === "1") placed[c]++ })
    return { total, placed, allPlaced: placed.reduce((s, n) => s + n, 0), beads: total.reduce((s, n) => s + n, 0) }
  }, [legend, done])

  // 5×5 boxes lined up with the thick grid lines, in reading order (left → right, then the next band
  // down). Boxes with no beads at all are left out. Edge boxes can be smaller than 5×5.
  const boxes = useMemo(() => {
    if (!pattern) return [] as Box[]
    const { cols, rows } = pattern
    const offset = (n: number, saved: number | null) =>
      guideSize === 5 && saved !== null ? saved : guideSize === 10 && saved !== null ? saved % 5 : autoGuideOffset(n, 5)
    const spans = (n: number, off: number) => {
      const cuts = [0]
      for (let k = off > 0 ? off : 5; k < n; k += 5) cuts.push(k)
      cuts.push(n)
      return cuts.slice(0, -1).map((a, k) => [a, cuts[k + 1]] as const)
    }
    const colSpans = spans(cols, offset(cols, guideCol)), rowSpans = spans(rows, offset(rows, guideRow))
    const list: Box[] = []
    for (const [r0, r1] of rowSpans) for (const [c0, c1] of colSpans) {
      const beads: number[] = []
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (legend.cells[r * cols + c] >= 0) beads.push(r * cols + c)
      if (beads.length) list.push({ c0, c1, r0, r1, beads })
    }
    return list
  }, [pattern, legend, guideSize, guideCol, guideRow])
  const boxDone = (b: Box) => b.beads.every((i) => done[i] === "1")
  /** Next unfinished box after `from` (wrapping round), or null when every box is done. */
  const nextUnfinished = (from: number) => {
    for (let k = 1; k <= boxes.length; k++) {
      const j = (from + k) % boxes.length
      if (!boxDone(boxes[j])) return j
    }
    return null
  }
  // On open (and if the saved box is finished or gone): land on the first unfinished box.
  const settled = useRef(false)
  useEffect(() => {
    if (settled.current || !boxes.length || loadState !== "ready") return
    settled.current = true
    if (working >= boxes.length || boxDone(boxes[working])) setWorking(nextUnfinished(boxes.length - 1) ?? 0)
  }, [boxes, loadState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save progress shortly after changes stop.
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ done, working })
  latest.current = { done, working }
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current || !pattern || readOnly) { firstRender.current = !pattern; return }
    setSaveState("pending")
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setSaveState("saving")
      try {
        await saveProgress(projectId, latest.current.done, latest.current.working)
        setSaveState("saved")
      } catch (err) {
        setSaveState("error")
        toast.error("Couldn't save progress", { description: errorMessage(err) })
      }
    }, 800)
  }, [done, working]) // eslint-disable-line react-hooks/exhaustive-deps
  useUnsavedChangesWarning(saveState === "pending" || saveState === "saving" || saveState === "error")

  const guideTimer = useRef<number | undefined>(undefined)
  type GuideSettings = { size: number; col: number | null; row: number | null; color: string | null }
  function updateGuide(change: Partial<GuideSettings>) {
    const next: GuideSettings = { size: guideSize, col: guideCol, row: guideRow, color: guideColor, ...change }
    setGuideSize(next.size); setGuideCol(next.col); setGuideRow(next.row); setGuideColor(next.color)
    window.clearTimeout(guideTimer.current)
    guideTimer.current = window.setTimeout(() => {
      saveGuide(projectId, next.size, next.col, next.row, next.color)
        .catch((err) => toast.error("Couldn't save grid lines", { description: errorMessage(err) }))
    }, 600)
  }

  function retrySave() {
    window.clearTimeout(timer.current)
    setSaveState("saving")
    saveProgress(projectId, latest.current.done, latest.current.working)
      .then(() => setSaveState("saved"))
      .catch((err) => { setSaveState("error"); toast.error("Couldn't save progress", { description: errorMessage(err) }) })
  }

  /** Mirror the whole pattern left ↔ right (done marks move with their beads). Press again to flip back. */
  const [flipping, setFlipping] = useState(false)
  async function flipPattern() {
    if (!pattern) return
    const cells = flipHorizontal(pattern.cells, pattern.cols, pattern.rows)
    const flippedDone = flipHorizontalText(done, pattern.cols, pattern.rows)
    setFlipping(true)
    try {
      window.clearTimeout(timer.current) // the flip saves progress too
      await savePatternCells(projectId, cells, flippedDone)
      setPattern({ ...pattern, cells, done: flippedDone })
      if (flippedDone !== done) {
        firstRender.current = true // the progress was just saved with the flip: skip one auto-save
        setDone(flippedDone)
      }
      setSaveState("saved")
      toast.success("Pattern flipped left ↔ right", { description: "Press Flip again to turn it back." })
    } catch (err) {
      toast.error("Couldn't flip the pattern", { description: errorMessage(err) })
    } finally {
      setFlipping(false)
    }
  }

  function boxAt(i: number) {
    if (!pattern) return -1
    const r = Math.floor(i / pattern.cols), c = i % pattern.cols
    return boxes.findIndex((b) => c >= b.c0 && c < b.c1 && r >= b.r0 && r < b.r1)
  }

  function setCells(indexes: number[], value: "0" | "1") {
    setDone((current) => {
      const chars = current.split("")
      for (const i of indexes) chars[i] = value
      return chars.join("")
    })
  }

  if (projectsLoading || loadState === "loading") return <LoadingOverlay message="Opening bead mode…" />

  if (loadState !== "ready" || !pattern) {
    return (
      <div className="page flow-page">
        <Link className="back-button" href={`/projects/${projectId}`}>←   {project?.name ?? "Project"}</Link>
        <div className="empty-state">
          <Icon name="grid" size={24} />
          <strong>{loadState === "error" ? "Couldn't open the pattern" : "No pattern yet"}</strong>
          <p>{loadState === "error" ? loadError : "Import a screenshot of the pattern to use bead mode."}</p>
          <Link className="primary-button" href={`/projects/${projectId}/pattern/import`}>Import pattern</Link>
        </div>
      </div>
    )
  }

  const { cols, rows } = pattern
  const guide = {
    size: guideSize,
    col: guideCol ?? autoGuideOffset(cols, guideSize),
    row: guideRow ?? autoGuideOffset(rows, guideSize),
    color: guideColor,
  }
  const describe = (n: number, offset: number) => {
    if (!guideSize) return `${n}`
    const blocks = Math.floor((n - offset) / guideSize), rest = n - offset - blocks * guideSize
    return [offset, `${guideSize}×${blocks}`, rest].filter((x) => x !== 0).join(" + ")
  }
  const totalCells = cols * rows
  const percent = stats.beads ? Math.round((stats.allPlaced / stats.beads) * 100) : 0
  const workingBox = Math.min(working, Math.max(0, boxes.length - 1))
  const shown = viewing !== null && viewing < boxes.length ? viewing : workingBox
  const box = boxes[shown] ?? null
  const isChecking = viewing !== null && viewing !== workingBox
  const shownDone = box ? boxDone(box) : false
  const boxesDone = boxes.filter(boxDone).length
  const targets = box ? box.beads.filter((i) => focus === null || legend.cells[i] === focus) : []
  const targetsDone = targets.length > 0 && targets.every((i) => done[i] === "1")
  // Colours in this box, most beads first, e.g. "D4 ×12 · C7 ×8" (how many still to place).
  const inBox = new Map<number, { n: number; left: number }>()
  for (const i of box?.beads ?? []) {
    const k = legend.cells[i], e = inBox.get(k) ?? { n: 0, left: 0 }
    e.n++; if (done[i] !== "1") e.left++
    inBox.set(k, e)
  }
  const boxColours = [...inBox].sort((a, b) => b[1].n - a[1].n || a[0] - b[0])

  function finishBox() {
    if (!box) return
    if (focus !== null) { setCells(targets, targetsDone ? "0" : "1"); return } // one colour at a time: no jump
    if (shownDone) { setCells(box.beads, "0"); setWorking(shown); setViewing(null); return } // "Mark not done": redo it
    setCells(box.beads, "1")
    // Jump to the next unfinished box after this one (the done marks above aren't in `done` yet).
    let next: number | null = null
    for (let k = 1; k <= boxes.length; k++) {
      const j = (shown + k) % boxes.length
      if (j !== shown && !boxDone(boxes[j])) { next = j; break }
    }
    setWorking(next ?? shown)
    setViewing(null)
    if (next === null) toast.success("Every box is done!", { description: "All beads placed 🎉" })
  }

  return (
    <div className="bead-mode">
      <header className="bead-mode__top">
        <Link className="back-button" href={`/projects/${projectId}`}>←</Link>
        <div className="bead-mode__title">
          <strong>{project?.name ?? "Bead mode"}</strong>
          <span>{boxesDone} / {boxes.length} boxes · {stats.allPlaced.toLocaleString()} / {stats.beads.toLocaleString()} beads · {percent}%</span>
        </div>
        <SaveStatus state={saveState} onRetry={retrySave} />
        <div className="bead-mode__progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
      </header>

      <div className="bead-mode__stage">
        <GridCanvas
          cols={cols} rows={rows} cells={legend.cells} colours={legend.colours} codes={legend.codes}
          focus={focus} done={done} box={boxMode && box ? box : null} fitKey={projectId} guide={guide}
          onCellTap={(i) => {
            if (tapToMark && !readOnly) { if (legend.cells[i] >= 0) setCells([i], done[i] === "1" ? "0" : "1") }
            else if (boxMode) { const b = boxAt(i); if (b >= 0) setViewing(b === workingBox ? null : b) }
          }}
        />
      </div>

      <div className="bead-mode__controls">
        {readOnly && <p className="readonly-note">Completed project · view only</p>}
        <div className="bead-mode__toggles">
          <button className={boxMode ? "chip chip--on" : "chip"} onClick={() => setBoxMode((v) => !v)} type="button">Box by box</button>
          {!readOnly && (
            <button className={tapToMark ? "chip chip--on" : "chip"} onClick={() => setTapToMark((v) => !v)} type="button">
              {tapToMark ? "Tap marks beads ✓" : "Tap to mark beads"}
            </button>
          )}
          <button className={showGuide ? "chip chip--on" : "chip"} onClick={() => setShowGuide((v) => !v)} type="button">Grid lines</button>
          {!readOnly && (
            <>
              <button className="chip" onClick={() => void flipPattern()} disabled={flipping} title="Mirror the whole pattern left ↔ right" type="button">⇋ Flip</button>
              <button className="chip" onClick={() => setConfirmReset(true)} type="button">Reset</button>
              <Link className="chip" href={`/projects/${projectId}/pattern/import`}>Re-import</Link>
            </>
          )}
        </div>

        {showGuide && (
          <div className="guide-panel">
            <div className="guide-panel__line">
              <span>Thick lines every</span>
              {[5, 10, 0].map((n) => (
                <button key={n} className={guideSize === n ? "chip chip--on" : "chip"} onClick={() => updateGuide({ size: n })} type="button">
                  {n ? `${n}` : "Off"}
                </button>
              ))}
            </div>
            {guideSize > 0 && (["col", "row"] as const).map((axis) => {
              const value = axis === "col" ? guide.col : guide.row
              const isAuto = (axis === "col" ? guideCol : guideRow) === null
              const set = (v: number | null) => updateGuide(axis === "col" ? { col: v } : { row: v })
              return (
                <div className="guide-panel__line" key={axis}>
                  <span>{axis === "col" ? "Columns" : "Rows"}: {describe(axis === "col" ? cols : rows, value)}</span>
                  <button className="chip" aria-label="Fewer cells before first block" disabled={value === 0} onClick={() => set(Math.max(0, value - 1))} type="button">−</button>
                  <button className="chip" aria-label="More cells before first block" disabled={value >= guideSize - 1} onClick={() => set(Math.min(guideSize - 1, value + 1))} type="button">+</button>
                  <button className={isAuto ? "chip chip--on" : "chip"} onClick={() => set(null)} type="button">Auto</button>
                </div>
              )
            })}
            <div className="guide-panel__line">
              <span>Line colour</span>
              {LINE_COLOURS.map(({ name, hex }) => (
                <button
                  key={name}
                  aria-label={`${name} lines`}
                  title={name}
                  className={`line-swatch ${(guideColor ?? null) === hex ? "line-swatch--on" : ""}`}
                  style={{ background: hex ?? "#20251f" }}
                  onClick={() => updateGuide({ color: hex })}
                  type="button"
                />
              ))}
              <label className={`line-swatch line-swatch--custom ${guideColor && !LINE_COLOURS.some((c) => c.hex === guideColor) ? "line-swatch--on" : ""}`} title="Any colour">
                <input
                  aria-label="Pick any line colour"
                  type="color"
                  value={guideColor ?? "#20251f"}
                  onChange={(e) => updateGuide({ color: e.target.value })}
                />
              </label>
            </div>
          </div>
        )}

        {boxMode && box && (
          <div className={`bead-mode__box ${isChecking ? "bead-mode__box--checking" : ""} ${readOnly ? "bead-mode__box--view" : ""}`}>
            <button aria-label="Previous box" disabled={shown === 0} onClick={() => setViewing(shown - 1 === workingBox ? null : shown - 1)} type="button">‹</button>
            <div className="bead-mode__box-info">
              <div className="bead-mode__box-title">
                <strong>Box {shown + 1}</strong> <span>of {boxes.length}</span>
                {shownDone && <em className="bead-mode__tag bead-mode__tag--done">Done ✓</em>}
                {isChecking && !readOnly && <em className="bead-mode__tag">Just looking</em>}
                <span className="bead-mode__box-where">Rows {box.r0 + 1}–{box.r1} · Cols {box.c0 + 1}–{box.c1}</span>
              </div>
              <p className="bead-mode__runs">
                {boxColours.map(([k, e]) => (
                  <span key={k} className={(focus !== null && k !== focus) || e.left === 0 ? "is-dim" : undefined}>
                    <i className="colour-dot" style={{ backgroundColor: legend.colours[k] }} />
                    {legend.codes[k]}×{e.n}
                  </span>
                ))}
              </p>
            </div>
            {!readOnly && (
              <div className="bead-mode__box-actions">
                {isChecking && (
                  <button className="outline-button" onClick={() => setViewing(null)} type="button">Back to my box ({workingBox + 1})</button>
                )}
                <button className={shownDone && focus === null ? "outline-button" : "primary-button"} onClick={finishBox} type="button">
                  {focus !== null
                    ? targets.length === 0 ? `No ${legend.codes[focus]} here` : targetsDone ? `Undo ${legend.codes[focus]}` : `${legend.codes[focus]} ×${targets.length} done ✓`
                    : shownDone ? "Mark not done" : boxesDone === boxes.length - 1 ? "Box done ✓" : "Box done ✓ → Next"}
                </button>
              </div>
            )}
            <button aria-label="Next box" disabled={shown >= boxes.length - 1} onClick={() => setViewing(shown + 1 === workingBox ? null : shown + 1)} type="button">›</button>
          </div>
        )}

        <div className="bead-mode__legend" role="list">
          {legend.codes.map((code, j) => {
            const left = stats.total[j] - stats.placed[j]
            return (
              <button
                key={code}
                role="listitem"
                className={`legend-chip ${focus === j ? "legend-chip--on" : ""} ${left === 0 ? "legend-chip--done" : ""}`}
                onClick={() => setFocus(focus === j ? null : j)}
                type="button"
              >
                <i className="colour-dot" style={{ backgroundColor: legend.colours[j] }} />
                <strong>{code}</strong>
                <span>{left === 0 ? "✓" : left}</span>
              </button>
            )
          })}
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Reset progress?"
          message="All placed beads will be unmarked and you'll start again from box 1."
          confirmLabel="Reset"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setDone("0".repeat(totalCells))
            setWorking(0)
            setViewing(null)
            setConfirmReset(false)
          }}
        />
      )}
    </div>
  )
}
