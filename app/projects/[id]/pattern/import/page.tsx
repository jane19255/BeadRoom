"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { errorMessage, LoadingOverlay, Spinner, toast } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { GridAligner } from "@/components/pattern/grid-aligner"
import { GridCanvas } from "@/components/pattern/grid-canvas"
import { PaintTools, type PaintTool } from "@/components/pattern/paint-tools"
import { SizeInput } from "@/components/pattern/size-input"
import { useCellHistory } from "@/components/pattern/use-cell-history"
import { flipHorizontal, floodFill, moveSelection, rotateSelection } from "@/lib/pattern/edit"
import { useProjects } from "@/components/projects/projects-provider"
import {
  EMPTY, decodePattern, guessGridBox, guessGridSize, rgbToHex,
  type DecodeResult, type GridBox, type PaletteEntry, type PixelImage,
} from "@/lib/pattern/decode"
import { getPattern, savePattern } from "@/lib/pattern/store"

type Loaded = { src: string; pixels: PixelImage }
type Step = "choose" | "align" | "review"

const MAX_SIDE = 2400 // big phone screenshots are scaled down to keep reading fast

/** Draws an image to a canvas and returns its pixels. */
function loadImage(src: string): Promise<Loaded> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) return reject(new Error("Your browser couldn't read the image."))
      // Transparent parts (empty cells in some pattern apps) would read as black,
      // so put the image on white first.
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      try {
        const data = ctx.getImageData(0, 0, w, h)
        resolve({ src: canvas.toDataURL("image/png"), pixels: { width: w, height: h, data: data.data } })
      } catch {
        reject(new Error("This image can't be read here. Download it and upload the file instead."))
      }
    }
    img.onerror = () => reject(new Error("Could not open that image."))
    img.src = src
  })
}

/** Average colour of a small square around a point. */
function sampleHex(img: PixelImage, x: number, y: number): string {
  let r = 0, g = 0, b = 0, n = 0
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const px = Math.round(x) + dx, py = Math.round(y) + dy
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue
    const i = (py * img.width + px) * 4
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++
  }
  return rgbToHex([r / n, g / n, b / n])
}

export default function ImportPatternPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { projects, loading, loadProjectImage } = useProjects()
  const project = projects.find((item) => String(item.id) === params.id)

  const [step, setStep] = useState<Step>("choose")
  const [busy, setBusy] = useState<string | null>(null)
  const [image, setImage] = useState<Loaded | null>(null)
  const [box, setBox] = useState<GridBox>({ x0: 0, y0: 0, x1: 1, y1: 1 })
  const [cols, setCols] = useState(52)
  const [rows, setRows] = useState(52)
  const [palette, setPalette] = useState<PaletteEntry[]>([])
  const [result, setResult] = useState<DecodeResult | null>(null)
  // Cells with undo/redo (painting, fill, flip and single-cell fixes are all undoable).
  const history = useCellHistory()
  const cells = history.cells
  // Drawing: selected tool and colour (palette index, or EMPTY for "no bead").
  const [tool, setTool] = useState<PaintTool>("move")
  const [brush, setBrush] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(false)
  const [selection, setSelection] = useState<boolean[] | null>(null)
  const [flagged, setFlagged] = useState<boolean[]>([])
  const [view, setView] = useState<"pattern" | "screenshot">("pattern")
  const [picking, setPicking] = useState<number | null>(null)
  const [editCell, setEditCell] = useState<number | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)

  const recipePalette: PaletteEntry[] = useMemo(
    () => (project?.recipe ?? []).filter((row) => row.count > 0).map((row) => ({ code: row.code, hex: row.colour, count: row.count })),
    [project],
  )
  const recipeTotal = recipePalette.reduce((s, p) => s + (p.count ?? 0), 0)

  const counts = useMemo(() => {
    const out = palette.map(() => 0)
    cells.forEach((c) => { if (c !== EMPTY) out[c]++ })
    return out
  }, [cells, palette])
  const flaggedCount = flagged.filter(Boolean).length
  const emptyCells = cells.filter((c) => c === EMPTY).length

  /* ------------------------------ drawing ------------------------------ */
  function selectBrush(j: number) {
    setBrush(j)
    chooseTool(j === EMPTY ? "erase" : "paint")
  }

  function chooseTool(next: PaintTool) {
    setTool(next)
    if (next !== "select") setSelection(null)
  }

  // Select tool: move the selected cells (their red "check this" outlines move with them).
  function moveSelected(dc: number, dr: number) {
    if (!selection) return
    const moved = moveSelection(cells, selection, cols, rows, dc, dr, EMPTY)
    history.checkpoint()
    history.change(() => moved.cells)
    setFlagged((cur) => moveSelection(cur, selection, cols, rows, dc, dr, false).cells)
    setSelection(moved.mask)
  }

  function rotateSelected(dir: 1 | -1) {
    if (!selection) return
    const turned = rotateSelection(cells, selection, cols, rows, dir, EMPTY)
    history.checkpoint()
    history.change(() => turned.cells)
    setFlagged((cur) => rotateSelection(cur, selection, cols, rows, dir, false).cells)
    setSelection(turned.mask)
  }

  function deleteSelected() {
    if (!selection) return
    history.checkpoint()
    history.change((cur) => cur.map((v, i) => (selection[i] ? EMPTY : v)))
  }

  function unflag(i: number) {
    setFlagged((cur) => (cur[i] ? cur.map((f, k) => (k === i ? false : f)) : cur))
  }

  function paintCell(i: number) {
    const value = tool === "erase" ? EMPTY : brush
    if (value === null) return
    history.setCell(i, value)
    unflag(i)
  }

  function tapCell(i: number) {
    if (tool === "fill") {
      if (brush === null) { toast.error("Choose a colour first"); return }
      history.checkpoint()
      history.change((cur) => floodFill(cur, cols, rows, i, brush))
    } else if (tool === "pick") {
      selectBrush(cells[i])
    } else {
      setEditCell(i) // Move tool: tap a cell to choose its colour from a list
    }
  }

  function flip() {
    history.checkpoint()
    history.change((cur) => flipHorizontal(cur, cols, rows))
    setFlagged((cur) => flipHorizontal(cur, cols, rows))
    setSelection(null)
    toast.success("Pattern flipped left ↔ right", { description: "Tap Undo to flip it back." })
  }

  function tools(compact: boolean) {
    const brushInfo = brush === null ? null : brush === EMPTY ? { code: "Empty", hex: "transparent" } : { code: palette[brush]?.code ?? "", hex: palette[brush]?.hex ?? "#ccc" }
    return (
      <>
        <PaintTools
          compact={compact} tool={tool} onTool={chooseTool} brush={brushInfo}
          canUndo={history.canUndo} canRedo={history.canRedo}
          onUndo={() => { history.undo(); setSelection(null) }} onRedo={() => { history.redo(); setSelection(null) }} onFlip={flip}
          selectedCount={selection ? selection.filter(Boolean).length : 0}
          onDeselect={() => setSelection(null)} onDeleteSelection={deleteSelected} onRotateSelection={rotateSelected}
        />
        {compact && (
          <div className="fullscreen-colours">
            {palette.map((p, j) => (
              <button key={p.code} className={brush === j ? "is-on" : undefined} title={p.code} onClick={() => selectBrush(j)} type="button">
                <i style={{ background: p.hex }} />{p.code}
              </button>
            ))}
          </div>
        )}
      </>
    )
  }

  if (loading) return <LoadingOverlay message="Loading your project…" />
  if (!project?.id) {
    return (
      <div className="page flow-page">
        <Link className="back-button" href="/">←   All projects</Link>
        <div className="empty-state"><strong>Project not found</strong></div>
      </div>
    )
  }
  if (project.status === "Completed") {
    return (
      <div className="page flow-page">
        <Link className="back-button" href={`/projects/${project.id}`}>←   Back to {project.name}</Link>
        <div className="empty-state"><strong>This project is completed</strong><p>Completed projects are view only, so the pattern can't be re-imported.</p></div>
      </div>
    )
  }
  const projectId = project.id

  async function open(src: string) {
    setBusy("Opening image…")
    try {
      const loaded = await loadImage(src)
      const guessBox = guessGridBox(loaded.pixels)
      const guessSize = guessGridSize(loaded.pixels, guessBox)
      setImage(loaded)
      setBox(guessBox)
      if (guessSize) { setCols(guessSize.cols); setRows(guessSize.rows) }
      else if (recipeTotal) { const side = Math.round(Math.sqrt(recipeTotal)); setCols(side); setRows(side) }
      setStep("align")
    } catch (err) {
      toast.error("Couldn't open the image", { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  function read(nextPalette: PaletteEntry[]) {
    if (!image) return
    setBusy("Reading the pattern…")
    // Let the spinner paint before the heavy work starts.
    window.setTimeout(() => {
      try {
        const res = decodePattern(image.pixels, box, cols, rows, nextPalette)
        setPalette(nextPalette)
        setResult(res)
        history.reset(res.cells)
        setFlagged(res.flagged)
        setStep("review")
        setView("pattern")
      } catch (err) {
        toast.error("Couldn't read the pattern", { description: errorMessage(err) })
      } finally {
        setBusy(null)
      }
    }, 30)
  }

  async function save() {
    setBusy("Saving pattern…")
    try {
      await savePattern(projectId, cols, rows, cells.map((c) => (c === EMPTY ? "" : palette[c].code)))
      toast.success("Pattern saved", { description: `${cols} × ${rows} beads` })
      router.push(`/projects/${projectId}/pattern`)
    } catch (err) {
      toast.error("Couldn't save the pattern", { description: errorMessage(err) })
      setBusy(null)
    }
  }

  async function onSaveClick() {
    try {
      if (await getPattern(projectId)) { setConfirmReplace(true); return }
    } catch { /* if this check fails, save() will report the real problem */ }
    void save()
  }

  /* ------------------------------ step 1 ------------------------------ */
  if (step === "choose") {
    return (
      <div className="page flow-page pattern-import">
        {busy && <LoadingOverlay message={busy} />}
        <Link className="back-button" href={`/projects/${projectId}`}>←   {project.name}</Link>
        <section className="page-heading">
          <div>
            <h1>Import bead pattern</h1>
            <p>Use a screenshot of the pattern grid. BeadRoom reads each cell&apos;s colour and checks it against your recipe.</p>
          </div>
        </section>
        {!recipePalette.length ? (
          <div className="detail-card">
            <strong>Add the bead recipe first</strong>
            <p>The colours and counts in the recipe are what the pattern is matched against. Paste them with Quick fill on the project page.</p>
            <Link className="primary-button" href={`/projects/${projectId}`}>Go to recipe</Link>
          </div>
        ) : (
          <div className="pattern-choose">
            <label className="upload-zone">
              <input accept="image/*" type="file" onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => void open(String(reader.result))
                reader.readAsDataURL(file)
              }} />
              <span className="upload-icon"><Icon name="plus" /></span>
              <strong>Upload pattern screenshot</strong>
              <small>A straight screenshot works best. Keep the colour list at the bottom if it has one.</small>
            </label>
            {project.hasImage && (
              <button
                className="outline-button"
                onClick={async () => {
                  setBusy("Opening image…")
                  try {
                    const src = await loadProjectImage(project)
                    if (src) await open(src)
                    else { setBusy(null); toast.error("This project has no picture saved.") }
                  } catch (err) {
                    setBusy(null)
                    toast.error("Couldn't load the picture", { description: errorMessage(err) })
                  }
                }}
                type="button"
              >
                Use this project&apos;s image
              </button>
            )}
            <p className="pattern-hint">
              Recipe: {recipePalette.length} colours · {recipeTotal.toLocaleString()} beads
            </p>
          </div>
        )}
      </div>
    )
  }

  /* ------------------------------ step 2 ------------------------------ */
  if (step === "align" && image) {
    const spare = cols * rows - recipeTotal
    return (
      <div className="page flow-page pattern-import">
        {busy && <LoadingOverlay message={busy} />}
        <button className="back-button" onClick={() => setStep("choose")} type="button">←   Choose another image</button>
        <section className="page-heading">
          <div>
            <h1>Line up the grid</h1>
            <p>Drag the two red corners onto the outer corners of the bead grid (not the numbers). The red lines should sit on the cell borders.</p>
          </div>
        </section>
        <div className="pattern-size">
          <label><span>Columns</span><SizeInput value={cols} onChange={setCols} label="Columns" /></label>
          <span>×</span>
          <label><span>Rows</span><SizeInput value={rows} onChange={setRows} label="Rows" /></label>
          <small className={spare >= 0 ? "save-status save-status--saved" : "save-status save-status--error"}>
            {spare === 0
              ? `✓ ${(cols * rows).toLocaleString()} cells = recipe total`
              : spare > 0
                ? `✓ ${(cols * rows).toLocaleString()} cells: ${recipeTotal.toLocaleString()} beads + ${spare.toLocaleString()} empty`
                : `Only ${(cols * rows).toLocaleString()} cells, but the recipe has ${recipeTotal.toLocaleString()} beads. Check the columns and rows.`}
          </small>
        </div>
        <GridAligner src={image.src} width={image.pixels.width} height={image.pixels.height} box={box} cols={cols} rows={rows} onBoxChange={setBox} />
        <div className="pattern-actions">
          <button className="primary-button" onClick={() => read(recipePalette)} type="button">
            <Icon name="spark" /> Read pattern
          </button>
        </div>
      </div>
    )
  }

  /* ------------------------------ step 3 ------------------------------ */
  if (step === "review" && image && result) {
    const pickHex = picking !== null
    return (
      <div className="page flow-page pattern-import pattern-review">
        {busy && <LoadingOverlay message={busy} />}
        <button className="back-button" onClick={() => setStep("align")} type="button">←   Back to lining up</button>
        <section className="page-heading">
          <div>
            <h1>Check the pattern</h1>
            <p>
              {flaggedCount
                ? `${flaggedCount} cells are outlined in red: compare them with the screenshot and tap any cell to change its colour.`
                : "Every cell was read confidently. Tap any cell to change its colour."}
              {emptyCells > 0 && ` ${emptyCells.toLocaleString()} cells have no bead (shown as a light checkerboard).`}
            </p>
          </div>
          <button className="primary-button" disabled={!!busy} onClick={() => void onSaveClick()} type="button">
            {busy === "Saving pattern…" ? <><Spinner /> Saving…</> : <><Icon name="check" /> Save pattern</>}
          </button>
        </section>

        <div className="pattern-tabs" role="tablist">
          <button className={view === "pattern" ? "tab tab--active" : "tab"} onClick={() => { setView("pattern"); setPicking(null) }} type="button">Pattern</button>
          <button className={view === "screenshot" ? "tab tab--active" : "tab"} onClick={() => setView("screenshot")} type="button">Screenshot</button>
          {flaggedCount > 0 && (
            <button className="text-button" onClick={() => setFlagged(cells.map(() => false))} type="button">Clear red outlines</button>
          )}
        </div>

        {pickHex && (
          <div className="pattern-pick-banner">
            Tap a <strong>{palette[picking!].code}</strong> cell or its swatch in the colour list on the screenshot.
            <button className="text-button" onClick={() => { setPicking(null); setView("pattern") }} type="button">Cancel</button>
          </div>
        )}

        {view === "pattern" && tools(false)}
        {view === "pattern" && (tool === "paint" && brush === null) && (
          <p className="pattern-hint">Choose a colour in the colour list first, then tap or draw on the cells.</p>
        )}

        <div className="pattern-review-layout">
          <div
            className={`pattern-stage ${view === "screenshot" ? "pattern-stage--shot" : ""}`}
            // Pattern tab: the box takes the grid's own shape so the whole pattern is visible.
            style={view === "pattern" ? { aspectRatio: `${cols + 2} / ${rows + 2}` } : undefined}
          >
            {view === "pattern" ? (
              <GridCanvas
                cols={cols} rows={rows} cells={cells}
                colours={palette.map((p) => p.hex)} codes={palette.map((p) => p.code)}
                focus={highlight && brush !== null && brush !== EMPTY ? brush : null} flagged={flagged} fitKey={`${cols}x${rows}`}
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
            ) : (
              <div className="pattern-shot">
                <GridAligner
                  src={image.src} width={image.pixels.width} height={image.pixels.height} box={box} cols={cols} rows={rows}
                  onPick={pickHex ? (x, y) => {
                    const hex = sampleHex(image.pixels, x, y)
                    const next = palette.map((p, j) => (j === picking ? { ...p, picked: hex } : p))
                    toast.success(`${palette[picking!].code} colour picked`, { description: "Reading the pattern again…" })
                    setPicking(null)
                    read(next)
                  } : undefined}
                />
              </div>
            )}
          </div>

          <aside className="pattern-key">
            <h2>Colours</h2>
            <p>{result.countsMatch ? "All counts match the recipe." : "Counts compared with the recipe."} Tap a colour, then tap or draw on cells to paint them.</p>
            <label className="pattern-key__highlight">
              <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
              Highlight the selected colour
            </label>
            <ul>
              {palette.map((p, j) => {
                const diff = counts[j] - (p.count ?? counts[j])
                return (
                  <li key={p.code} className={brush === j ? "is-focused" : undefined}>
                    <button className="pattern-key__main" aria-pressed={brush === j} onClick={() => selectBrush(j)} type="button">
                      <span className="colour-dot" style={{ backgroundColor: p.hex }} />
                      <strong>{p.code}</strong>
                      <span>{counts[j]}</span>
                      <small className={diff === 0 ? "ok" : "off"}>{diff === 0 ? "✓" : diff > 0 ? `+${diff}` : diff}</small>
                    </button>
                    <button
                      className="pattern-key__pick"
                      title="Pick this colour from the screenshot"
                      onClick={() => { setPicking(j); setView("screenshot") }}
                      type="button"
                    >
                      {p.picked ? <span className="colour-dot" style={{ backgroundColor: p.picked }} /> : "Pick"}
                    </button>
                  </li>
                )
              })}
              {(emptyCells > 0 || cols * rows > recipeTotal) && (
                <li className={brush === EMPTY ? "is-focused" : undefined}>
                  <button className="pattern-key__main" aria-pressed={brush === EMPTY} onClick={() => selectBrush(EMPTY)} type="button">
                    <span className="colour-dot colour-dot--empty" />
                    <strong>Empty</strong>
                    <span>{emptyCells}</span>
                    <small className={emptyCells === cols * rows - recipeTotal ? "ok" : "off"}>
                      {emptyCells === cols * rows - recipeTotal ? "✓" : emptyCells - (cols * rows - recipeTotal) > 0 ? `+${emptyCells - (cols * rows - recipeTotal)}` : emptyCells - (cols * rows - recipeTotal)}
                    </small>
                  </button>
                </li>
              )}
            </ul>
            <p className="pattern-hint">
              Wrong colour everywhere (for example C12 shown as C18)? Tap <strong>Pick</strong> next to it and tap that colour on the screenshot.
            </p>
          </aside>
        </div>

        {editCell !== null && (
          <div className="modal-backdrop" role="presentation" onClick={() => setEditCell(null)}>
            <section className="modal pattern-cell-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" aria-label="Close" onClick={() => setEditCell(null)} type="button"><Icon name="close" /></button>
              <h2>Row {Math.floor(editCell / cols) + 1}, column {(editCell % cols) + 1}</h2>
              <p>Currently {cells[editCell] === EMPTY ? "empty (no bead)" : palette[cells[editCell]].code}. Choose the right colour:</p>
              <div className="pattern-cell-options">
                {palette.map((p, j) => (
                  <button
                    key={p.code}
                    className={cells[editCell] === j ? "is-current" : undefined}
                    onClick={() => {
                      history.checkpoint()
                      history.setCell(editCell, j)
                      setFlagged((cur) => cur.map((f, i) => (i === editCell ? false : f)))
                      setEditCell(null)
                    }}
                    type="button"
                  >
                    <span className="colour-dot" style={{ backgroundColor: p.hex }} />
                    {p.code}
                  </button>
                ))}
                <button
                  className={cells[editCell] === EMPTY ? "is-current" : undefined}
                  onClick={() => {
                    history.checkpoint()
                    history.setCell(editCell, EMPTY)
                    setFlagged((cur) => cur.map((f, i) => (i === editCell ? false : f)))
                    setEditCell(null)
                  }}
                  type="button"
                >
                  <span className="colour-dot colour-dot--empty" />
                  Empty
                </button>
              </div>
            </section>
          </div>
        )}

        {confirmReplace && (
          <ConfirmDialog
            title="Replace saved pattern?"
            message="This project already has a pattern. Saving replaces it and resets your bead-mode progress."
            confirmLabel="Replace"
            confirmClassName="primary-button"
            onCancel={() => setConfirmReplace(false)}
            onConfirm={() => { setConfirmReplace(false); void save() }}
          />
        )}
      </div>
    )
  }

  return null
}
