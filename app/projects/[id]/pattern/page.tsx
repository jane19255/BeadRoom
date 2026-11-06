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
import { autoGuideOffset, getPattern, saveGuide, saveProgress, type StoredPattern } from "@/lib/pattern/store"
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
  const projectId = Number(params.id)

  const [pattern, setPattern] = useState<StoredPattern | null>(null)
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading")
  const [loadError, setLoadError] = useState("")
  const [hexByCode, setHexByCode] = useState<Map<string, string>>(new Map())
  const [done, setDone] = useState("")
  const [currentRow, setCurrentRow] = useState(0)
  const [focus, setFocus] = useState<number | null>(null)
  const [tapToMark, setTapToMark] = useState(false)
  const [rowMode, setRowMode] = useState(true)
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
        setCurrentRow(Math.min(stored.currentRow, stored.rows - 1))
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

  // Save progress shortly after changes stop.
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ done, currentRow })
  latest.current = { done, currentRow }
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current || !pattern) { firstRender.current = !pattern; return }
    setSaveState("pending")
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(async () => {
      setSaveState("saving")
      try {
        await saveProgress(projectId, latest.current.done, latest.current.currentRow)
        setSaveState("saved")
      } catch (err) {
        setSaveState("error")
        toast.error("Couldn't save progress", { description: errorMessage(err) })
      }
    }, 800)
  }, [done, currentRow]) // eslint-disable-line react-hooks/exhaustive-deps
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
    saveProgress(projectId, latest.current.done, latest.current.currentRow)
      .then(() => setSaveState("saved"))
      .catch((err) => { setSaveState("error"); toast.error("Couldn't save progress", { description: errorMessage(err) }) })
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
  const rowCells = Array.from({ length: cols }, (_, c) => currentRow * cols + c)
  const rowTargets = rowCells.filter((i) => (focus === null ? legend.cells[i] >= 0 : legend.cells[i] === focus))
  const rowDone = rowTargets.length > 0 && rowTargets.every((i) => done[i] === "1")

  // What's in the current row, left to right, e.g. "D4 ×12 · C7 ×3 · D4 ×5" (handy for placing a row).
  const runs: { code: number; n: number }[] = []
  for (const i of rowCells) {
    const c = legend.cells[i]
    if (runs.length && runs[runs.length - 1].code === c) runs[runs.length - 1].n++
    else runs.push({ code: c, n: 1 })
  }

  return (
    <div className="bead-mode">
      <header className="bead-mode__top">
        <Link className="back-button" href={`/projects/${projectId}`}>←</Link>
        <div className="bead-mode__title">
          <strong>{project?.name ?? "Bead mode"}</strong>
          <span>{stats.allPlaced.toLocaleString()} / {stats.beads.toLocaleString()} beads · {percent}%</span>
        </div>
        <SaveStatus state={saveState} onRetry={retrySave} />
        <div className="bead-mode__progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
      </header>

      <div className="bead-mode__stage">
        <GridCanvas
          cols={cols} rows={rows} cells={legend.cells} colours={legend.colours} codes={legend.codes}
          focus={focus} done={done} currentRow={rowMode ? currentRow : null} fitKey={projectId} guide={guide}
          onCellTap={(i) => {
            if (tapToMark) { if (legend.cells[i] >= 0) setCells([i], done[i] === "1" ? "0" : "1") }
            else if (rowMode) setCurrentRow(Math.floor(i / cols))
          }}
        />
      </div>

      <div className="bead-mode__controls">
        <div className="bead-mode__toggles">
          <button className={rowMode ? "chip chip--on" : "chip"} onClick={() => setRowMode((v) => !v)} type="button">Row by row</button>
          <button className={tapToMark ? "chip chip--on" : "chip"} onClick={() => setTapToMark((v) => !v)} type="button">
            {tapToMark ? "Tap marks beads ✓" : "Tap to mark beads"}
          </button>
          <button className={showGuide ? "chip chip--on" : "chip"} onClick={() => setShowGuide((v) => !v)} type="button">Grid lines</button>
          <button className="chip" onClick={() => setConfirmReset(true)} type="button">Reset</button>
          <Link className="chip" href={`/projects/${projectId}/pattern/import`}>Re-import</Link>
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

        {rowMode && (
          <div className="bead-mode__row">
            <button aria-label="Previous row" disabled={currentRow === 0} onClick={() => setCurrentRow((r) => Math.max(0, r - 1))} type="button">‹</button>
            <div>
              <strong>Row {currentRow + 1}</strong> <span>of {rows}</span>
              <p className="bead-mode__runs">
                {runs.map((run, k) => run.code < 0 ? (
                  <span key={k} className="bead-mode__gap">gap×{run.n}</span>
                ) : (
                  <span key={k} className={focus !== null && run.code !== focus ? "is-dim" : undefined}>
                    <i className="colour-dot" style={{ backgroundColor: legend.colours[run.code] }} />
                    {legend.codes[run.code]}×{run.n}
                  </span>
                ))}
              </p>
            </div>
            <button
              className="primary-button"
              disabled={rowTargets.length === 0}
              onClick={() => {
                if (rowDone) { setCells(rowTargets, "0"); return }
                setCells(rowTargets, "1")
                if (focus === null && currentRow < rows - 1) setCurrentRow((r) => r + 1)
              }}
              type="button"
            >
              {rowTargets.length === 0
                ? focus === null ? "Empty row" : `No ${legend.codes[focus]} in this row`
                : rowDone ? "Undo" : focus === null ? "Row done ✓" : `${legend.codes[focus]} ×${rowTargets.length} done ✓`}
            </button>
            <button aria-label="Next row" disabled={currentRow >= rows - 1} onClick={() => setCurrentRow((r) => Math.min(rows - 1, r + 1))} type="button">›</button>
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
          message="All placed beads will be unmarked and you'll start again from row 1."
          confirmLabel="Reset"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setDone("0".repeat(totalCells))
            setCurrentRow(0)
            setConfirmReset(false)
          }}
        />
      )}
    </div>
  )
}
