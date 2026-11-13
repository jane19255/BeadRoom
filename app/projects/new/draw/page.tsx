"use client"

import { renderPatternPicture } from "@/lib/pattern/render"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { errorMessage, LoadingOverlay, Spinner, toast, useUnsavedChangesWarning } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { GridCanvas } from "@/components/pattern/grid-canvas"
import { PaintTools, type PaintTool } from "@/components/pattern/paint-tools"
import { SizeInput } from "@/components/pattern/size-input"
import { useCellHistory } from "@/components/pattern/use-cell-history"
import { useProjects } from "@/components/projects/projects-provider"
import { EMPTY } from "@/lib/pattern/decode"
import { flipHorizontal, floodFill, moveSelection, rotateSelection } from "@/lib/pattern/edit"
import { savePattern } from "@/lib/pattern/store"
import { getCategoryNames, getPalette } from "@/lib/supabase/data"
import type { RecipeRow } from "@/lib/types"

/** Unfinished drawings are kept on this device so a refresh doesn't lose them. */
const DRAFT_KEY = "beadroom-draw-draft"
type Draft = { name: string; category: string; cols: number; rows: number; cells: string[] }

/** Common colours shown first, right after Empty. Every other colour follows in code order. */
const FAVOURITE_CODES = ["H2", "H7"]

const BOARDS = [
  { label: "29 × 29", cols: 29, rows: 29 },
  { label: "50 × 50", cols: 50, rows: 50 },
  { label: "52 × 52", cols: 52, rows: 52 },
]

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}

export default function DrawPatternPage() {
  const router = useRouter()
  const { createProject } = useProjects()

  const [palette, setPalette] = useState<RecipeRow[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [step, setStep] = useState<"setup" | "draw">("setup")
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [cols, setCols] = useState(52)
  const [rows, setRows] = useState(52)
  const history = useCellHistory()
  const cells = history.cells
  const [tool, setTool] = useState<PaintTool>("paint")
  const [brush, setBrush] = useState<number | null>(null)
  // Select tool: which cells are selected (null = none).
  const [selection, setSelection] = useState<boolean[] | null>(null)
  const [highlight, setHighlight] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [confirmStartOver, setConfirmStartOver] = useState(false)
  // Board size the current drawing was made on (to keep the drawing if the size changes).
  const boardSize = useRef<{ cols: number; rows: number } | null>(null)
  // Set once the project is saved, so a late draft save can't bring the drawing back.
  const savedProject = useRef(false)

  useEffect(() => {
    getPalette()
      .then(setPalette)
      .catch((err) => { setPalette([]); toast.error("Couldn't load your colours", { description: errorMessage(err) }) })
    getCategoryNames()
      .then((names) => { setCategories(names); setCategory((c) => c || names[0] || "") })
      .catch(() => {})
    setHasDraft(!!readDraft())
  }, [])

  const indexByCode = useMemo(() => new Map((palette ?? []).map((p, i) => [p.code.toUpperCase(), i])), [palette])
  // Fixed colour order: H2, H7, then everything else by code (A1, A2, … B1, …). Nothing moves around.
  const favourites = useMemo(
    () => FAVOURITE_CODES.map((code) => indexByCode.get(code)).filter((i): i is number => i !== undefined),
    [indexByCode],
  )
  const otherColours = useMemo(
    () => (palette ?? []).map((_, i) => i).filter((i) => !favourites.includes(i)),
    [palette, favourites],
  )

  // Keep the drawing on this device while working on it.
  useEffect(() => {
    if (step !== "draw" || !palette || saving) return
    const t = window.setTimeout(() => {
      if (savedProject.current) return
      try {
        const draft: Draft = { name, category, cols, rows, cells: cells.map((c) => (c < 0 ? "" : palette[c]?.code ?? "")) }
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      } catch { /* storage full or blocked: drawing still works */ }
    }, 400)
    return () => window.clearTimeout(t)
  }, [step, cells, name, category, cols, rows, palette, saving])

  const counts = useMemo(() => {
    const out = new Map<number, number>()
    for (const c of cells) if (c >= 0) out.set(c, (out.get(c) ?? 0) + 1)
    return out
  }, [cells])
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const totalBeads = used.reduce((s, [, n]) => s + n, 0)
  useUnsavedChangesWarning(step === "draw" && totalBeads > 0 && !saving)


  if (!palette) return <LoadingOverlay message="Loading your colours…" />

  /* ------------------------------ actions ------------------------------ */
  function start() {
    if (cols < 2 || rows < 2) return
    const prev = boardSize.current
    if (prev && prev.cols === cols && prev.rows === rows) { setStep("draw"); return }
    // New board, or the size changed: keep whatever was drawn, from the top-left corner.
    const next = new Array<number>(cols * rows).fill(EMPTY)
    if (prev && cells.length === prev.cols * prev.rows) {
      for (let r = 0; r < Math.min(rows, prev.rows); r++)
        for (let c = 0; c < Math.min(cols, prev.cols); c++) next[r * cols + c] = cells[r * prev.cols + c]
    }
    history.reset(next)
    boardSize.current = { cols, rows }
    setStep("draw")
  }

  function continueDraft() {
    const draft = readDraft()
    if (!draft || !palette) return
    setName(draft.name)
    setCategory(draft.category)
    setCols(draft.cols)
    setRows(draft.rows)
    boardSize.current = { cols: draft.cols, rows: draft.rows }
    history.reset(draft.cells.map((code) => (code ? indexByCode.get(code.toUpperCase()) ?? EMPTY : EMPTY)))
    setStep("draw")
  }

  function selectBrush(i: number) {
    setBrush(i)
    if (tool !== "fill") chooseTool(i === EMPTY ? "erase" : "paint")
  }

  function paintCell(i: number) {
    const value = tool === "erase" ? EMPTY : brush
    if (value === null) return
    history.setCell(i, value)
  }

  function tapCell(i: number) {
    if (tool === "fill") {
      if (brush === null) { toast.error("Choose a colour first"); return }
      history.checkpoint()
      history.change((cur) => floodFill(cur, cols, rows, i, brush))
    } else if (tool === "pick") {
      if (cells[i] >= 0) selectBrush(cells[i])
      else selectBrush(EMPTY)
    }
  }

  function flip() {
    history.checkpoint()
    history.change((cur) => flipHorizontal(cur, cols, rows))
    setSelection(null)
  }

  /* Select tool */
  function chooseTool(next: PaintTool) {
    setTool(next)
    if (next !== "select") setSelection(null)
  }
  function moveSelected(dc: number, dr: number) {
    if (!selection) return
    const moved = moveSelection(cells, selection, cols, rows, dc, dr, EMPTY)
    history.checkpoint()
    history.change(() => moved.cells)
    setSelection(moved.mask)
  }
  function rotateSelected(dir: 1 | -1) {
    if (!selection) return
    const turned = rotateSelection(cells, selection, cols, rows, dir, EMPTY)
    history.checkpoint()
    history.change(() => turned.cells)
    setSelection(turned.mask)
  }
  function deleteSelected() {
    if (!selection) return
    history.checkpoint()
    history.change((cur) => cur.map((v, i) => (selection[i] ? EMPTY : v)))
  }
  const selectedCount = selection ? selection.filter(Boolean).length : 0

  async function save() {
    if (!palette) return
    if (!name.trim()) { toast.error("Give the project a name first"); setStep("setup"); return }
    if (!category.trim()) { toast.error("Choose a category first"); setStep("setup"); return }
    if (!totalBeads) { toast.error("Draw at least one bead first"); return }
    setSaving(true)
    const recipe: RecipeRow[] = used.map(([i, count]) => ({ ...palette[i], count }))
    const image = renderPatternPicture(cols, rows, (i) => (cells[i] < 0 ? null : palette[cells[i]]?.colour ?? "#cccccc")) ?? undefined
    const saved = await createProject({
      name: name.trim(), category: category.trim(), pattern: "default", status: "Not started",
      beads: totalBeads, image, recipe,
    })
    if (!saved?.id) { setSaving(false); return }
    savedProject.current = true
    try {
      await savePattern(saved.id, cols, rows, cells.map((c) => (c < 0 ? "" : palette[c].code)))
    } catch (err) {
      toast.error("Project saved, but the pattern grid wasn't", { description: errorMessage(err) })
    }
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
    router.push(`/projects/${saved.id}`)
  }

  const brushInfo = brush === null ? null : brush === EMPTY ? { code: "Empty", hex: "transparent" } : { code: palette[brush].code, hex: palette[brush].colour }
  const tools = (compact: boolean) => (
    <>
      <PaintTools
        compact={compact} tool={tool} onTool={chooseTool} brush={brushInfo}
        canUndo={history.canUndo} canRedo={history.canRedo}
        onUndo={() => { history.undo(); setSelection(null) }} onRedo={() => { history.redo(); setSelection(null) }} onFlip={flip}
        selectedCount={selectedCount} onDeselect={() => setSelection(null)} onDeleteSelection={deleteSelected} onRotateSelection={rotateSelected}
      />
      {compact && (
        <div className="fullscreen-colours fullscreen-colours--all">
          {/* Every colour, same fixed order as the main bar: Empty, H2, H7, then by code */}
          <button className={brush === EMPTY ? "is-on" : undefined} onClick={() => selectBrush(EMPTY)} type="button">
            <i className="colour-dot--empty" />Empty
          </button>
          {[...favourites, ...otherColours].map((i) => (
            <button key={i} className={brush === i ? "is-on" : undefined} onClick={() => selectBrush(i)} type="button">
              <i style={{ background: palette[i].colour }} />{palette[i].code}
            </button>
          ))}
        </div>
      )}
    </>
  )

  /* ------------------------------ step 1: setup ------------------------------ */
  if (step === "setup") {
    return (
      <div className="page flow-page">
        <Link className="back-button" href="/">←   All projects</Link>
        <section className="page-heading">
          <div>
            <h1>Draw a pattern</h1>
            <p>Draw your own design bead by bead. The bead recipe (codes and counts) is worked out for you.</p>
          </div>
        </section>

        {hasDraft && !cells.length && (
          <div className="detail-card draw-draft">
            <div>
              <strong>You have an unfinished drawing</strong>
              <p>Pick up where you left off, or start a new one below.</p>
            </div>
            <button className="primary-button" onClick={continueDraft} type="button">Continue drawing</button>
          </div>
        )}

        <div className="detail-card draw-setup">
          <label>
            <span>Project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Little cat keychain" />
          </label>
          <label>
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={!categories.length}>
              {categories.length
                ? categories.map((c) => <option key={c} value={c}>{c}</option>)
                : <option value="">No categories yet</option>}
            </select>
            {!categories.length && (
              <small className="pattern-hint">Add a category with Manage categories on the All projects page first.</small>
            )}
          </label>
          <div>
            <span className="draw-setup__label">Board size</span>
            <div className="draw-setup__boards">
              {BOARDS.map((b) => (
                <button
                  key={b.label}
                  className={cols === b.cols && rows === b.rows ? "chip chip--on" : "chip"}
                  onClick={() => { setCols(b.cols); setRows(b.rows) }}
                  type="button"
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="pattern-size" style={{ marginTop: 10 }}>
              <label><span>Columns</span><SizeInput value={cols} onChange={setCols} label="Columns" /></label>
              <span>×</span>
              <label><span>Rows</span><SizeInput value={rows} onChange={setRows} label="Rows" /></label>
            </div>
          </div>
          <button className="primary-button" disabled={!name.trim()} onClick={start} type="button">
            <Icon name="grid" /> {cells.length ? "Back to drawing" : "Start drawing"}
          </button>
        </div>
      </div>
    )
  }

  /* ------------------------------ step 2: draw ------------------------------ */
  return (
    <div className="page flow-page draw-page">
      {saving && <LoadingOverlay message="Saving your project…" />}
      <section className="page-heading">
        <div>
          <h1>{name || "Draw a pattern"}</h1>
          <p>{cols} × {rows} board · {totalBeads.toLocaleString()} beads · {used.length} colours</p>
        </div>
        <div className="modal-actions" style={{ marginTop: 0 }}>
          <button className="outline-button" onClick={() => setStep("setup")} type="button">Name & size</button>
          <button className="primary-button" disabled={saving || !totalBeads} onClick={() => void save()} type="button">
            {saving ? <><Spinner /> Saving…</> : <><Icon name="check" /> Save project</>}
          </button>
        </div>
      </section>

      {/* Tools and colours together (stays at the top while scrolling), so switching
          between a colour and Erase never needs scrolling. */}
      <div className="draw-toolbar">
        {tools(false)}
        <div className="draw-colours" role="listbox" aria-label="Colours">
          <button className={brush === EMPTY ? "is-on" : undefined} onClick={() => selectBrush(EMPTY)} type="button">
            <i className="colour-dot--empty" />Empty
          </button>
          {[...favourites, ...otherColours].map((i) => (
            <button key={palette[i].code} className={brush === i ? "is-on" : undefined} onClick={() => selectBrush(i)} type="button">
              <i style={{ background: palette[i].colour }} />{palette[i].code}
            </button>
          ))}
        </div>
        <label className="pattern-key__highlight draw-toolbar__highlight">
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
          Highlight the selected colour
        </label>
      </div>

      <div className="draw-layout">
        <div className="draw-stage" style={{ aspectRatio: `${cols + 2} / ${rows + 2}` }}>
          <GridCanvas
            cols={cols} rows={rows} cells={cells}
            colours={palette.map((p) => p.colour)} codes={palette.map((p) => p.code)}
            focus={highlight && brush !== null && brush >= 0 ? brush : null}
            fitKey={`${cols}x${rows}`}
            painting={tool === "paint" || tool === "erase"}
            onPaintStart={() => history.checkpoint()}
            onPaint={paintCell}
            onCellTap={tapCell}
            selecting={tool === "select"}
            selection={selection}
            onSelect={setSelection}
            onMoveSelection={moveSelected}
            fullscreenTools={tools(true)}
          />
        </div>

        <aside className="draw-panel">
          <div className="detail-card">
            <h2>Bead recipe</h2>
            <p className="pattern-hint" style={{ marginTop: 0 }}>Counted from your drawing. Saved with the project.</p>
            {used.length ? (
              <ul className="draw-panel__recipe">
                {used.map(([i, n]) => (
                  <li key={i}>
                    <button onClick={() => selectBrush(i)} type="button">
                      <i style={{ background: palette[i].colour }} />
                      <strong>{palette[i].code}</strong>
                      <span>{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pattern-hint">Nothing drawn yet.</p>
            )}
            {used.length > 0 && (
              <button className="text-button" onClick={() => setConfirmStartOver(true)} type="button">Clear the whole board</button>
            )}
          </div>
        </aside>
      </div>

      {confirmStartOver && (
        <ConfirmDialog
          title="Clear the whole board?"
          message="Every bead will be removed. You can still undo this."
          confirmLabel="Clear"
          onCancel={() => setConfirmStartOver(false)}
          onConfirm={() => {
            history.checkpoint()
            history.change(() => new Array<number>(cols * rows).fill(EMPTY))
            setConfirmStartOver(false)
          }}
        />
      )}
    </div>
  )
}
