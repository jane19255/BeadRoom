"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { errorMessage, SaveStatus, Spinner, toast, useUnsavedChangesWarning, type SaveState } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { useProjects } from "@/components/projects/projects-provider"
import { RecipeImport } from "@/components/projects/recipe-import"
import { keyOf, splitCode } from "@/lib/beads"
import { getCategoryNames, getPalette } from "@/lib/supabase/data"
import { getPattern } from "@/lib/pattern/store"
import { renderPatternPicture } from "@/lib/pattern/render"
import type { Project, RecipeRow } from "@/lib/types"

export function ProjectDetail({ project }: { project: Project }) {
  const router = useRouter()
  const {
    setStockCheck, updateProjectStatus, completeProject,
    updateProjectDetails, updateProjectRecipe, loadProjectImage, updateProjectPicture,
  } = useProjects()
  // The full picture isn't part of the project list (too big); fetch it when the project opens.
  useEffect(() => {
    if (project.hasImage && !project.image) {
      loadProjectImage(project).catch((err) => toast.error("Couldn't load the picture", { description: errorMessage(err) }))
    }
  }, [project.id, project.hasImage, project.image]) // eslint-disable-line react-hooks/exhaustive-deps
  const onUpdateRecipe = (recipe: RecipeRow[]) => updateProjectRecipe(project, recipe)
  const onUpdateDetails = (name: string, category: string, image?: string) =>
    updateProjectDetails(project, name, category, image)
  const [statusBusy, setStatusBusy] = useState(false)
  // Saved bead pattern (if any): size and progress for the "Bead pattern" card.
  const [patternInfo, setPatternInfo] = useState<{ cols: number; rows: number; placed: number; beads: number; cells: string[] } | null | undefined>(undefined)
  const isCompleted = project.status === "Completed" // completed projects are view only
  const [confirmPatternPicture, setConfirmPatternPicture] = useState(false)
  const [makingPicture, setMakingPicture] = useState(false)
  useEffect(() => {
    if (!project.id) return
    let cancelled = false
    getPattern(project.id)
      .then((p) => {
        if (cancelled) return
        if (!p) { setPatternInfo(null); return }
        const beads = p.cells.filter((c) => c !== "").length // "" = empty cell, no bead
        const placed = p.cells.filter((c, i) => c !== "" && p.done[i] === "1").length
        setPatternInfo({ cols: p.cols, rows: p.rows, placed, beads, cells: p.cells })
      })
      .catch(() => { if (!cancelled) setPatternInfo(null) })
    return () => { cancelled = true }
  }, [project.id])
  /** Project picture = the saved bead pattern: only the beads, cropped, empty cells see-through. */
  async function applyPatternPicture() {
    if (!patternInfo) return
    setMakingPicture(true)
    // Bead colours: from the recipe, then the colour inventory for anything not in the recipe.
    const hex = new Map<string, string>()
    for (const p of availablePalette) hex.set(p.code.toUpperCase(), p.colour)
    for (const r of project.recipe ?? []) hex.set(r.code.toUpperCase(), r.colour)
    const picture = renderPatternPicture(patternInfo.cols, patternInfo.rows, (i) => {
      const code = patternInfo.cells[i]
      return code ? hex.get(code.toUpperCase()) ?? "#cccccc" : null
    })
    if (!picture) toast.error("The pattern has no beads to make a picture from.")
    else await updateProjectPicture(project, picture)
    setMakingPicture(false)
  }

  async function runStatusAction(action: () => Promise<unknown>) {
    setStatusBusy(true)
    await action()
    setStatusBusy(false)
  }
  const [recipe, setRecipe] = useState<RecipeRow[]>(project.recipe ?? [])
  const [availablePalette, setAvailablePalette] = useState<RecipeRow[]>([])
  const prefixes = useMemo(
    () => [...new Set(availablePalette.map((o) => splitCode(o.code).prefix))].sort(),
    [availablePalette],
  )
  const [availableCategories, setAvailableCategories] = useState<string[]>([project.category]);
  useEffect(() => {
    let cancelled = false
    getCategoryNames()
      .then((names) => { if (!cancelled) setAvailableCategories(names) })
      .catch((err) => console.error(err))
    getPalette()
      .then((palette) => { if (!cancelled) setAvailablePalette(palette) })
      .catch((err) => toast.error("Couldn't load colours", { description: errorMessage(err) }))
    return () => { cancelled = true }
  }, [])
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [projectName, setProjectName] = useState(project.name)
  const [projectCategory, setProjectCategory] = useState(project.category)
  const [projectImage, setProjectImage] = useState(project.image ?? "")
  // Only send the picture when it was actually changed, so saving never wipes a picture
  // that hadn't finished loading.
  const [imageChanged, setImageChanged] = useState(false)
  const [deleteRecipeIndex, setDeleteRecipeIndex] = useState<number | null>(
    null,
  )

  const saveTimer = useRef<number | undefined>(undefined)
  const [savingDetails, setSavingDetails] = useState(false)
  // Recipe changes save automatically; this shows whether they actually reached the database.
  const [recipeStatus, setRecipeStatus] = useState<SaveState>("idle")
  const saveRequest = useRef(0)

  // Warn before closing/refreshing the tab while a change hasn't been saved yet.
  useUnsavedChangesWarning(recipeStatus === "pending" || recipeStatus === "saving" || recipeStatus === "error" || savingDetails)

  // While editing, show the newly picked image straight away; otherwise show the saved one.
  const displayImage = isEditingDetails && imageChanged ? projectImage : (project.image ?? project.thumb)

  function uploadImage(file?: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setProjectImage(String(reader.result)); setImageChanged(true) }
    reader.onerror = () => toast.error("Could not read the selected image.")
    reader.readAsDataURL(file)
  }

  function saveRecipe(nextRecipe: RecipeRow[]) {
    setRecipe(nextRecipe)
    setRecipeStatus("pending")
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(async () => {
      const request = ++saveRequest.current
      setRecipeStatus("saving")
      const ok = await onUpdateRecipe(nextRecipe)
      // Ignore the result if a newer edit has started saving in the meantime.
      if (request === saveRequest.current) setRecipeStatus(ok ? "saved" : "error")
    }, 600)
  }

  async function saveDetails() {
    if (!projectName.trim()) {
      toast.error("Project name can't be empty")
      return
    }
    setSavingDetails(true)
    const ok = await onUpdateDetails(projectName.trim(), projectCategory, imageChanged ? projectImage : undefined)
    if (ok) setImageChanged(false)
    setSavingDetails(false)
    if (ok) setIsEditingDetails(false) // on failure, stay in edit mode so nothing typed is lost
  }

  return (
    <div className="page flow-page">
      <Link className="back-button" href="/">
        ←   All projects
      </Link>
      {isCompleted && (
        <p className="readonly-note" role="note">
          <Icon name="check" size={15} /> This project is completed, so it's view only.
        </p>
      )}
      <section className={`page-heading detail-heading ${isEditingDetails ? "detail-heading--editing" : ""}`}>
        <div>
          {isEditingDetails ? (
            <div className="detail-edit-fields">
              <label>
                <span>Project name</span>
                <input
                  onChange={(event) => setProjectName(event.target.value)}
                  value={projectName}
                />
              </label>
              <label>
                <span>Category</span>
                <select
                  onChange={(event) => setProjectCategory(event.target.value)}
                  value={projectCategory}
                >
                  {availableCategories.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label className="upload-zone">
                <input
                  accept="image/*"
                  onChange={(event) => uploadImage(event.target.files?.[0])}
                  type="file"
                />
                <span className="upload-icon">
                  <Icon name="plus" />
                </span>
                <strong>{projectImage || project.hasImage ? "Replace image" : "Add image"}</strong>
                <small>PNG, JPG or WebP.</small>
              </label>
            </div>
          ) : (
            <>
              <h1>{project.name}</h1>
            </>
          )}
          <p>A good bead project, one careful row at a time.</p>
        </div>
        {project.status !== "Completed" && (
          isEditingDetails ? (
            <div className="modal-actions" style={{ marginTop: 0 }}>
              <button
                className="outline-button"
                disabled={savingDetails}
                onClick={() => {
                  setProjectName(project.name)
                  setProjectCategory(project.category)
                  setProjectImage(project.image ?? ""); setImageChanged(false)
                  setIsEditingDetails(false)
                }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={savingDetails} onClick={() => void saveDetails()}>
                {savingDetails ? <><Spinner /> Saving…</> : "Save details"}
              </button>
            </div>
          ) : (
            <button
              className="outline-button"
              onClick={() => {
                setProjectName(project.name)
                setProjectCategory(project.category)
                setProjectImage(project.image ?? ""); setImageChanged(false)
                setIsEditingDetails(true)
              }}
            >
              Edit details
            </button>
          )
        )}
      </section>

      {/* Order on phone/iPad: Check stock → picture → recipe. On a laptop: recipe + Check stock left, picture right. */}
      <div className="detail-layout detail-layout--ordered">
          <section className="detail-card recipe-card">
            <div className="section-heading">
              <div>
                <h2>Bead recipe</h2>
                <p>Colours and quantities for this project.</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <SaveStatus state={recipeStatus} onRetry={() => saveRecipe(recipe)} />
                <strong>
                  {recipe.reduce((total, row) => total + row.count, 0)} beads
                </strong>
              </div>
            </div>
            {project.status !== "Completed" && (
              <RecipeImport
                hasExisting={recipe.length > 0}
                onApply={(rows) => saveRecipe(rows)}
                palette={availablePalette}
              />
            )}
            <div className="recipe-editor-head">
              <span>Prefix</span>
              <span>Number</span>
              <span>Swatch</span>
              <span>Count</span>
              <span></span>
            </div>
            {recipe.map((row, index) => {
              const { prefix, number } = splitCode(row.code)
              const prefixList = prefixes.includes(prefix) ? prefixes : [prefix, ...prefixes]
              const numbers = availablePalette
                .filter((o) => splitCode(o.code).prefix === prefix)
                .map((o) => splitCode(o.code).number)
              const numberList = numbers.includes(number) ? numbers : [number, ...numbers]

              const changeCode = (code: string) => {
                const option = availablePalette.find((o) => o.code === code)
                if (!option) return
                saveRecipe(
                  recipe.map((item, i) =>
                    i === index ? { ...item, code, colour: option.colour, colorId: option.colorId } : item,
                  ),
                )
              }

              return (
                <div className="recipe-editor-row" key={`${row.code}-${index}`}>
                  <select
                    aria-label={`Colour prefix row ${index + 1}`}
                    disabled={project.status === "Completed"}
                    value={prefix}
                    onChange={(event) => {
                      const next = availablePalette.find(
                        (o) =>
                          splitCode(o.code).prefix === event.target.value &&
                          !recipe.some((r) => r.code === o.code),
                      )
                      if (next) changeCode(next.code)
                    }}
                  >
                    {prefixList.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`Colour number row ${index + 1}`}
                    disabled={project.status === "Completed"}
                    value={number}
                    onChange={(event) => changeCode(`${prefix}${event.target.value}`)}
                  >
                    {numberList.map((n) => (
                      <option
                        key={n}
                        value={n}
                        disabled={recipe.some((r, i) => i !== index && r.code === `${prefix}${n}`)}
                      >
                        {n}
                      </option>
                    ))}
                  </select>
                  <span
                    className="colour-dot"
                    style={{ backgroundColor: row.colour }}
                  />
                  <input
                    aria-label={`${row.code} bead count`}
                    min="0"
                    inputMode="numeric"
                    onChange={(event) =>
                      saveRecipe(
                        recipe.map((item, rowIndex) =>
                          rowIndex === index
                            ? {
                              ...item,
                              count: Math.max(0, Number(event.target.value) || 0),
                            }
                            : item,
                        ),
                      )
                    }
                    onKeyDown={(event) => {
                      if (["e", "E", "+", "-", "."].includes(event.key))
                        event.preventDefault()
                    }}
                    disabled={project.status === "Completed"}
                    step="1"
                    type="number"
                    value={row.count}
                  />
                  {project.status !== "Completed" && (
                    <button
                      aria-label={`Remove ${row.code}`}
                      onClick={() => setDeleteRecipeIndex(index)}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
            {project.status !== "Completed" && (
              <button
                className="outline-button add-recipe-button"
                disabled={!availablePalette.some((option) => !recipe.some((row) => row.code === option.code))}
                onClick={() => {
                  const next = availablePalette.find(
                    (option) => !recipe.some((row) => row.code === option.code),
                  )
                  if (next) saveRecipe([...recipe, { ...next, count: 1 }])
                }}
              >
                <Icon name="plus" /> Add another colour
              </button>
            )}
          </section>

          {project.status !== "Completed" && (
            <section className="detail-card project-actions">
              <div>
                <Icon name="box" />
                <div>
                  <strong>Ready to check your bead stock?</strong>
                  <p>Compare this recipe with your colour inventory.</p>
                </div>
              </div>
              <button
                className="primary-button"
                onClick={() => {
                  // Check just this project; Back on the stock page returns here.
                  setStockCheck({ keys: [keyOf(project)], back: { href: `/projects/${project.id}`, label: `Back to ${project.name}` } })
                  router.push("/stock")
                }}
              >
                Check stock
              </button>
            </section>
          )}
        <aside className="detail-preview">
          <div className={`preview-art art-panel--${project.pattern}`}>
            {displayImage ? (
              <img alt={project.name} src={displayImage} />
            ) : (
              <div className="project-image-placeholder" aria-label="No project image uploaded">
                <Icon name="palette" size={28} />
                <span>No image</span>
              </div>
            )}
          </div>
          <div>
            <p className="preview-category">{project.category}</p>
            <h2>{project.name}</h2>
            <p>
              {project.status} · {project.beads} beads
            </p>
          </div>
          <div className="pattern-card">
            <div>
              <strong>Bead pattern</strong>
              <p>
                {patternInfo === undefined
                  ? "Checking…"
                  : patternInfo
                    ? `${patternInfo.cols} × ${patternInfo.rows} · ${Math.round((patternInfo.placed / Math.max(1, patternInfo.beads)) * 100)}% placed`
                    : isCompleted ? "No bead pattern was saved for this project." : "Import a screenshot to follow the grid while you bead."}
              </p>
            </div>
            {patternInfo ? (
              <>
                <Link className="primary-button" href={`/projects/${project.id}/pattern`}>
                  <Icon name="grid" /> {isCompleted ? "View pattern" : "Open bead mode"}
                </Link>
                {!isCompleted && (
                  <button className="outline-button" disabled={makingPicture} onClick={() => setConfirmPatternPicture(true)} type="button">
                    {makingPicture ? <><Spinner /> Making picture…</> : <><Icon name="palette" /> Use pattern as picture</>}
                  </button>
                )}
              </>
            ) : !isCompleted ? (
              <Link className="outline-button" href={`/projects/${project.id}/pattern/import`}>
                <Icon name="plus" /> Import pattern
              </Link>
            ) : null}
          </div>
          {project.status === "Not started" && (
            <button
              className="primary-button"
              disabled={statusBusy}
              onClick={() => runStatusAction(() => updateProjectStatus(project, "On-going"))}
            >
              {statusBusy ? <><Spinner /> Starting…</> : <><Icon name="check" /> Start project</>}
            </button>
          )}
          {project.status === "On-going" && (
            <button
              className="primary-button"
              disabled={statusBusy}
              onClick={() => runStatusAction(() => completeProject(project))}
            >
              {statusBusy ? <><Spinner /> Completing…</> : <><Icon name="check" /> Project completed</>}
            </button>
          )}
        </aside>
      </div>
      {confirmPatternPicture && (
        <ConfirmDialog
          title="Use the bead pattern as the picture?"
          message="The project picture will be replaced with a picture of the bead pattern (only the beads, with the empty areas see-through)."
          confirmLabel="Replace picture"
          confirmClassName="primary-button"
          onCancel={() => setConfirmPatternPicture(false)}
          onConfirm={() => { setConfirmPatternPicture(false); void applyPatternPicture() }}
        />
      )}
      {deleteRecipeIndex !== null && (
        <ConfirmDialog
          title="Delete recipe colour?"
          message={`Remove ${recipe[deleteRecipeIndex]?.code ?? "this colour"} from the project recipe?`}
          onCancel={() => setDeleteRecipeIndex(null)}
          onConfirm={() => {
            saveRecipe(recipe.filter((_, index) => index !== deleteRecipeIndex))
            setDeleteRecipeIndex(null)
          }}
        />
      )}
    </div>
  )
}
