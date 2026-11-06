"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { errorMessage, LoadingOverlay, Spinner, toast } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { GridAligner } from "@/components/pattern/grid-aligner"
import { GridCanvas } from "@/components/pattern/grid-canvas"
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
  const { projects, loading } = useProjects()
  const project = projects.find((item) => String(item.id) === params.id)

  const [step, setStep] = useState<Step>("choose")
  const [busy, setBusy] = useState<string | null>(null)
  const [image, setImage] = useState<Loaded | null>(null)
  const [box, setBox] = useState<GridBox>({ x0: 0, y0: 0, x1: 1, y1: 1 })
  const [cols, setCols] = useState(52)
  const [rows, setRows] = useState(52)
  const [palette, setPalette] = useState<PaletteEntry[]>([])
  const [result, setResult] = useState<DecodeResult | null>(null)
  const [cells, setCells] = useState<number[]>([])
  const [flagged, setFlagged] = useState<boolean[]>([])
  const [focus, setFocus] = useState<number | null>(null)
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

  if (loading) return <LoadingOverlay message="Loading your project…" />
  if (!project?.id) {
    return (
      <div className="page flow-page">
        <Link className="back-button" href="/">←   All projects</Link>
        <div className="empty-state"><strong>Project not found</strong></div>
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
        setCells(res.cells)
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
            {project.image && (
              <button className="outline-button" onClick={() => void open(project.image!)} type="button">
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
          <label><span>Columns</span><input type="number" min={2} max={300} value={cols} onChange={(e) => setCols(Math.max(2, Number(e.target.value) || 2))} /></label>
          <span>×</span>
          <label><span>Rows</span><input type="number" min={2} max={300} value={rows} onChange={(e) => setRows(Math.max(2, Number(e.target.value) || 2))} /></label>
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

        <div className="pattern-review-layout">
          <div className="pattern-stage">
            {view === "pattern" ? (
              <GridCanvas
                cols={cols} rows={rows} cells={cells}
                colours={palette.map((p) => p.hex)} codes={palette.map((p) => p.code)}
                focus={focus} flagged={flagged} fitKey={`${cols}x${rows}`}
                onCellTap={(i) => setEditCell(i)}
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
            <p>{result.countsMatch ? "All counts match the recipe." : "Counts compared with the recipe."} Tap a colour to highlight it.</p>
            <ul>
              {palette.map((p, j) => {
                const diff = counts[j] - (p.count ?? counts[j])
                return (
                  <li key={p.code} className={focus === j ? "is-focused" : undefined}>
                    <button className="pattern-key__main" onClick={() => setFocus(focus === j ? null : j)} type="button">
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
                <li>
                  <span className="pattern-key__main" style={{ cursor: "default" }}>
                    <span className="colour-dot colour-dot--empty" />
                    <strong>Empty</strong>
                    <span>{emptyCells}</span>
                    <small className={emptyCells === cols * rows - recipeTotal ? "ok" : "off"}>
                      {emptyCells === cols * rows - recipeTotal ? "✓" : emptyCells - (cols * rows - recipeTotal) > 0 ? `+${emptyCells - (cols * rows - recipeTotal)}` : emptyCells - (cols * rows - recipeTotal)}
                    </small>
                  </span>
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
                      setCells((cur) => cur.map((c, i) => (i === editCell ? j : c)))
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
                    setCells((cur) => cur.map((c, i) => (i === editCell ? EMPTY : c)))
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
