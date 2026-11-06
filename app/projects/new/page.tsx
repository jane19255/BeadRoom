"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, type FormEvent } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { errorMessage, Spinner } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { useProjects } from "@/components/projects/projects-provider"
import { RecipeImport } from "@/components/projects/recipe-import"
import { splitCode } from "@/lib/beads"
import { getCategoryNames, getPalette } from "@/lib/supabase/data"
import type { RecipeRow } from "@/lib/types"

export default function AddProjectPage() {
  const router = useRouter()
  const { createProject } = useProjects()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [availableCategories, setAvailableCategories] = useState<string[]>([])
  const [image, setImage] = useState("")
  const [recipe, setRecipe] = useState<RecipeRow[]>([])
  const [availablePalette, setAvailablePalette] = useState<RecipeRow[]>([])
  const addPrefixes = useMemo(
    () => [...new Set(availablePalette.map((o) => splitCode(o.code).prefix))].sort(),
    [availablePalette],
  )
  const [formError, setFormError] = useState("")
  const [deleteRecipeIndex, setDeleteRecipeIndex] = useState<number | null>(
    null,
  )
  const totalBeads = recipe.reduce((total, row) => total + row.count, 0)

  useEffect(() => {
    let cancelled = false
    getCategoryNames()
      .then((names) => {
        if (cancelled) return
        setAvailableCategories(names)
        setCategory((current) => (names.includes(current) ? current : (names[0] ?? "")))
      })
      .catch((err) => setFormError(errorMessage(err)))
    getPalette()
      .then((palette) => { if (!cancelled) setAvailablePalette(palette) })
      .catch((err) => setFormError(errorMessage(err)))
    return () => { cancelled = true }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || saving) return
    if (!category) {
      setFormError("Add a category in Manage categories before creating a project.")
      return
    }
    setSaving(true)
    const saved = await createProject({
      name: name.trim(),
      category,
      pattern: "default",
      status: "Not started",
      beads: Math.max(1, totalBeads),
      image,
      recipe,
    })
    setSaving(false)
    if (saved?.id) router.push(`/projects/${saved.id}`)
  }

  function uploadImage(file?: File) {
    if (!file) return
    setFormError("")
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result))
    reader.onerror = () => setFormError("Could not read the selected image.")
    reader.readAsDataURL(file)
  }

  function updateRecipe(index: number, changes: Partial<RecipeRow>) {
    setRecipe((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...changes } : row,
      ),
    )
  }

  function addRecipeRow() {
    const next = availablePalette.find(
      (option) => !recipe.some((row) => row.code === option.code),
    )
    if (!next) {
      setFormError("No unused colours are available in Supabase. Add more colours in Colour inventory.")
      return
    }
    setRecipe((current) => [...current, { ...next, count: 1 }])
  }

  return (
    <div className="page flow-page">
      <Link className="back-button" href="/">
        ←   All projects
      </Link>
      <section className="page-heading">
        <div>
          <h1>A small idea, ready to grow.</h1>
          <p>
            Upload your pattern, review the detected colours, and adjust every
            bead count before saving.
          </p>
        </div>
      </section>

      <form className="project-form" onSubmit={submit}>
        <div className="form-main">
          <section className="form-card">
            <div className="form-card-heading">
              <div>
                <span>1</span>
                <div>
                  <h2>Project details</h2>
                  <p>Give your project a useful name and home.</p>
                </div>
              </div>
              <small>Project details and recipe saved to Supabase</small>
            </div>
            <label>
              <span>Project name</span>
              <input
                autoFocus
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter project name"
                value={name}
              />
            </label>
            <label>
              <span>Category</span>
              <select
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                {availableCategories.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </section>

          <section className="form-card">
            <div className="form-card-heading">
              <div>
                <span>2</span>
                <div>
                  <h2>Upload pattern image</h2>
                  <p>
                    Optional. The image is kept as a reference on the project
                    page.
                  </p>
                </div>
              </div>
            </div>
            <label className="upload-zone">
              <input
                accept="image/*"
                onChange={(event) => uploadImage(event.target.files?.[0])}
                type="file"
              />
              <span className="upload-icon">
                <Icon name="plus" />
              </span>
              <strong>
                {image ? "Choose a different image" : "Upload your bead pattern"}
              </strong>
              <small>
                PNG, JPG or WebP. Clear, front-facing pattern images work best.
              </small>
            </label>
            {formError && <p className="form-error">{formError}</p>}
          </section>

          <section className="form-card">
            <div className="form-card-heading">
              <div>
                <span>3</span>
                <div>
                  <h2>Bead recipe</h2>
                  <p>
                    Paste colour codes into quick fill, or add colours one by
                    one. Edit any colour or count before saving.
                  </p>
                </div>
              </div>
              <strong>{totalBeads.toLocaleString()} beads</strong>
            </div>
            <RecipeImport
              hasExisting={recipe.length > 0}
              onApply={(rows) => setRecipe(rows)}
              palette={availablePalette}
            />
            <div className="recipe-editor-head">
              <span>Prefix</span>
              <span>Number</span>
              <span>Swatch</span>
              <span>Count</span>
              <span></span>
            </div>
            {recipe.length ? (
              recipe.map((row, index) => (
                <div className="recipe-editor-row" key={`${row.code}-${index}`}>
                  {(() => {
                    const { prefix, number } = splitCode(row.code)
                    const prefixList = addPrefixes.includes(prefix) ? addPrefixes : [prefix, ...addPrefixes]
                    const numbers = availablePalette
                      .filter((o) => splitCode(o.code).prefix === prefix)
                      .map((o) => splitCode(o.code).number)
                    const numberList = numbers.includes(number) ? numbers : [number, ...numbers]
                    const pick = (code: string) => {
                      const option = availablePalette.find((o) => o.code === code)
                      if (!option) return
                      updateRecipe(index, { code, colour: option.colour, colorId: option.colorId })
                    }
                    return (
                      <>
                        <select
                          aria-label={`Colour prefix row ${index + 1}`}
                          value={prefix}
                          onChange={(event) => {
                            const next = availablePalette.find(
                              (o) =>
                                splitCode(o.code).prefix === event.target.value &&
                                !recipe.some((r) => r.code === o.code),
                            )
                            if (next) pick(next.code)
                          }}
                        >
                          {prefixList.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        <select
                          aria-label={`Colour number row ${index + 1}`}
                          value={number}
                          onChange={(event) => pick(`${prefix}${event.target.value}`)}
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
                      </>
                    )
                  })()}
                  <span
                    className="colour-dot"
                    style={{ backgroundColor: row.colour }}
                  />
                  <input
                    aria-label={`${row.code} bead count`}
                    min="0"
                    inputMode="numeric"
                    onKeyDown={(event) => {
                      if (["e", "E", "+", "-", "."].includes(event.key))
                        event.preventDefault()
                    }}
                    onChange={(event) =>
                      updateRecipe(index, {
                        count: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                    type="number"
                    step="1"
                    value={row.count}
                  />
                  <button
                    aria-label={`Remove ${row.code}`}
                    onClick={() => setDeleteRecipeIndex(index)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))
            ) : (
              <div className="recipe-empty">
                Paste colour codes into quick fill above, or add colours
                manually.
              </div>
            )}
            <button
              className="outline-button add-recipe-button"
              onClick={addRecipeRow}
              type="button"
            >
              <Icon name="plus" /> Add colour
            </button>
          </section>
        </div>

        <aside className="project-preview">
          <div className="preview-art upload-preview">
            {image ? (
              <img alt="Uploaded project pattern" src={image} />
            ) : (
              <div>
                <Icon name="palette" size={28} />
                <span>Your image preview</span>
              </div>
            )}
          </div>
          <div>
            <h2>{name || "Untitled project"}</h2>
            <p>
              {category} · {totalBeads.toLocaleString()} beads · {recipe.length}{" "}
              colours
            </p>
          </div>
          <button
            className="primary-button"
            disabled={!name.trim() || !recipe.length || saving}
            type="submit"
          >
            {saving ? <><Spinner /> Saving…</> : <><Icon name="check" /> Save project</>}
          </button>
          <Link className="outline-button" href="/">
            Cancel
          </Link>
        </aside>
      </form>
      {deleteRecipeIndex !== null && (
        <ConfirmDialog
          title="Delete recipe colour?"
          message={`Remove ${recipe[deleteRecipeIndex]?.code ?? "this colour"} from the project recipe?`}
          onCancel={() => setDeleteRecipeIndex(null)}
          onConfirm={() => {
            setRecipe((current) =>
              current.filter((_, index) => index !== deleteRecipeIndex),
            )
            setDeleteRecipeIndex(null)
          }}
        />
      )}
    </div>
  )
}
