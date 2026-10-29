"use client";

import { useMemo, useRef, useState, useEffect, type FormEvent, type ReactNode } from "react"
import "./index.css";
import { supabase } from "@/lib/supabase/client";
import { getColorsAndInventory } from "@/lib/supabase/data";

type IconName = "grid" | "palette" | "spark" | "search" | "plus" | "chevron" | "check" | "box" | "more" | "list" | "close"

type IconProps = {
  name: IconName
  size?: number
}

function Icon({ name, size = 16 }: IconProps) {
  const paths: Record<IconName, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    palette: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="8.2" cy="9" r=".8" fill="currentColor" />
        <circle cx="12" cy="7" r=".8" fill="currentColor" />
        <circle cx="15.8" cy="9" r=".8" fill="currentColor" />
        <path d="M12 21c-1.7 0-2.2-1-1.5-2.1.8-1.2 2.7-.6 4.4-1.1 2.6-.8 5.1-3.1 5.1-6.4" />
      </>
    ),
    spark: (
      <path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" />
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    check: <path d="m5 12 4 4L19 6" />,
    box: (
      <>
        <path d="m4 8 8-4 8 4-8 4-8-4Z" />
        <path d="m4 8 8 4 8-4M4 8v8l8 4 8-4V8M12 12v8" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </>
    ),
    list: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4" cy="6" r="1" fill="currentColor" />
        <circle cx="4" cy="12" r="1" fill="currentColor" />
        <circle cx="4" cy="18" r="1" fill="currentColor" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
  }

  return (
    <svg
      aria-hidden="true"
      className="icon"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {paths[name]}
    </svg>
  )
}

function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
  confirmLabel = "Delete",
  confirmClassName = "danger-button",
}: {
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  confirmClassName?: string
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close"
          onClick={onCancel}
          type="button"
        >
          <Icon name="close" />
        </button>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="outline-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={confirmClassName} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

type Project = {
  id?: number;
  name: string;
  category: string;
  pattern: string;
  status: "Not started" | "On-going" | "Completed";
  beads: number;
  image?: string;
  recipe?: RecipeRow[];
};

type RecipeRow = {
  code: string
  count: number
  colour: string
  colorId?: number
}


// Turns "D4;836,C7;229,..." into recipe rows by matching each code to the colour table.
function parseRecipeText(text: string, palette: RecipeRow[]) {
  const norm = (code: string) => {
    const clean = code.replace(/\s+/g, "").toUpperCase()
    const m = clean.match(/^([A-Z]+)0*(\d+)$/)
    return m ? `${m[1]}${m[2]}` : clean
  }
  const byCode = new Map(palette.map((option) => [norm(option.code), option]))
  const merged = new Map<string, RecipeRow>()
  const unknown: string[] = []
  const invalid: string[] = []

  const cleaned = text.replace(/；/g, ";").replace(/[，、]/g, ",")
  for (const raw of cleaned.split(/[,\n]+/)) {
    const part = raw.trim()
    if (!part) continue
    const match = part.match(/^([A-Za-z]+\s*\d+)\s*[;:=]\s*(\d+)$/)
    if (!match) {
      invalid.push(part)
      continue
    }
    const key = norm(match[1])
    const option = byCode.get(key)
    if (!option) {
      unknown.push(key)
      continue
    }
    const count = Number(match[2])
    const existing = merged.get(key)
    if (existing) existing.count += count
    else merged.set(key, { ...option, count })
  }
  return { rows: [...merged.values()], unknown, invalid }
}

function RecipeImport({
  palette,
  hasExisting,
  onApply,
}: {
  palette: RecipeRow[]
  hasExisting: boolean
  onApply: (rows: RecipeRow[]) => void
}) {
  const [text, setText] = useState("")
  const [message, setMessage] = useState("")
  const [isError, setIsError] = useState(false)
  const [pending, setPending] = useState<{
    rows: RecipeRow[]
    unknown: string[]
    invalid: string[]
  } | null>(null)

  function commit(rows: RecipeRow[], unknown: string[], invalid: string[]) {
    onApply(rows)
    const total = rows.reduce((sum, row) => sum + row.count, 0)
    const notes: string[] = []
    if (unknown.length) notes.push(`Not in Colour inventory, skipped: ${unknown.join(", ")}.`)
    if (invalid.length) notes.push(`Could not read: ${invalid.join(", ")}.`)
    setMessage(
      `Filled ${rows.length} colours, ${total.toLocaleString()} beads. Please check the list below. ${notes.join(" ")}`.trim(),
    )
    setIsError(notes.length > 0)
    if (!notes.length) setText("")
  }

  function apply() {
    if (!text.trim()) return
    if (!palette.length) {
      setMessage("Colours are still loading, or Colour inventory is empty.")
      setIsError(true)
      return
    }
    const { rows, unknown, invalid } = parseRecipeText(text, palette)
    if (!rows.length) {
      setMessage("No colours could be filled. Use the format D4;836,C7;229")
      setIsError(true)
      return
    }
    if (hasExisting) {
      setPending({ rows, unknown, invalid })
      return
    }
    commit(rows, unknown, invalid)
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
        Quick fill from colour codes
      </label>
      <textarea
        aria-label="Colour codes and counts"
        onChange={(event) => setText(event.target.value)}
        placeholder="D4;836,C7;229,H2;215,C21;203"
        rows={2}
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid #d9d9d9",
          borderRadius: 8,
          font: "inherit",
          resize: "vertical",
          boxSizing: "border-box",
        }}
        value={text}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <button className="outline-button" onClick={apply} type="button">
          Fill recipe
        </button>
        <span style={{ fontSize: 13, opacity: 0.7 }}>
          Format: code;amount, separated by commas. You can edit everything below afterwards.
        </span>
      </div>
      {message && (
        <p className={isError ? "form-error" : undefined} style={isError ? undefined : { fontSize: 13, marginTop: 8 }}>
          {message}
        </p>
      )}
      {pending && (
        <ConfirmDialog
          title="Replace current recipe?"
          message={`This will replace the colours currently in the recipe with the ${pending.rows.length} colours from your pasted codes.`}
          confirmLabel="Replace"
          confirmClassName="primary-button"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            commit(pending.rows, pending.unknown, pending.invalid)
            setPending(null)
          }}
        />
      )}
    </div>
  )
}

function InventoryPage() {
  type InventoryColor = {
    id: number;
    group: string | null;
    code: string | null;
    hex: string | null;
    quantity: number;
  };

  const [colors, setColors] = useState<InventoryColor[]>([]);
  const [colourQuery, setColourQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("All stock levels");
  const [showCustomColour, setShowCustomColour] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("X");
  const [number, setNumber] = useState("1");
  const [quantity, setQuantity] = useState("0");
  const [hex, setHex] = useState("#b791ad");

  async function loadInventory() {
    try {
      setLoading(true);
      setError(null);
      const data = await getColorsAndInventory();
      setColors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadInventory(); }, []);

  async function saveQuantity(colorId: number, nextQuantity: number) {
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      setError("Stock must be a whole number of zero or more.");
      return;
    }
    const previous = colors.find((item) => item.id === colorId)?.quantity ?? 0;
    setColors((current) => current.map((item) => item.id === colorId ? { ...item, quantity: nextQuantity } : item));
    setSavingId(colorId);
    setError(null);
    try {
      const { data: existing, error: findError } = await supabase
        .from("inventory").select("id").eq("color_id", colorId).maybeSingle();
      if (findError) throw findError;
      if (existing) {
        const { error: updateError } = await supabase.from("inventory")
          .update({ quantity: nextQuantity }).eq("id", existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from("inventory")
          .insert({ color_id: colorId, quantity: nextQuantity });
        if (insertError) throw insertError;
      }
    } catch (err) {
      setColors((current) => current.map((item) => item.id === colorId ? { ...item, quantity: previous } : item));
      setError(err instanceof Error ? err.message : "Could not save stock quantity.");
    } finally {
      setSavingId(null);
    }
  }

  async function addCustomColor() {
    const code = `${prefix}${number}`;
    if (colors.some((item) => item.code?.toUpperCase() === code.toUpperCase())) {
      setError(`Colour ${code} already exists.`);
      return;
    }
    const stock = Number(quantity);
    if (!Number.isInteger(stock) || stock < 0) {
      setError("Stock must be a whole number of zero or more.");
      return;
    }
    setError(null);
    try {
      const { data: color, error: colorError } = await supabase
        .from("color")
        .insert({ letter_group: prefix, color_code: code, hex_code: hex })
        .select("id, letter_group, color_code, hex_code")
        .single();
      if (colorError) throw colorError;
      const { error: inventoryError } = await supabase
        .from("inventory").insert({ color_id: color.id, quantity: stock });
      if (inventoryError) {
        // Avoid leaving a colour without its initial inventory row.
        await supabase.from("color").delete().eq("id", color.id);
        throw inventoryError;
      }
      setColors((current) => [...current, {
        id: Number(color.id), group: color.letter_group, code: color.color_code,
        hex: color.hex_code, quantity: stock,
      }].sort((a, b) => compareCodes(a.code, b.code)));
      setShowCustomColour(false);
      setPrefix("X"); setNumber("1"); setQuantity("0"); setHex("#b791ad");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add colour.");
    }
  }

  const filtered = colors.filter((item) => {
    const matchesQuery = (item.code ?? "").toLowerCase().includes(colourQuery.toLowerCase()) ||
      (item.group ?? "").toLowerCase().includes(colourQuery.toLowerCase());
    if (!matchesQuery) return false;
    if (availabilityFilter === "In stock only") return item.quantity > 0;
    if (availabilityFilter === "Out of stock") return item.quantity === 0;
    return true;
  }).sort((a, b) => {
    if (availabilityFilter === "Most available") return b.quantity - a.quantity;
    if (availabilityFilter === "Least available") return a.quantity - b.quantity;
    return compareCodes(a.code, b.code);
  });

  const grouped = new Map<string, InventoryColor[]>();
  filtered.forEach((item) => {
    const letter = item.group || item.code?.[0] || "Other";
    grouped.set(letter, [...(grouped.get(letter) ?? []), item]);
  });

  return (
    <div className="page inventory-page">
      <section className="page-heading">
        <div><h1>Colour inventory</h1><p>Stock levels are loaded from and saved to Supabase.</p></div>
        <button className="outline-button" onClick={() => setShowCustomColour(true)}><Icon name="plus" /> Add custom colour</button>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="inventory-toolbar">
        <label className="search-field"><Icon name="search" />
          <input aria-label="Find a colour" onChange={(event) => setColourQuery(event.target.value)} placeholder="Find a colour code..." value={colourQuery} />
        </label>
        <label className="select-field"><select aria-label="Filter by availability" onChange={(event) => setAvailabilityFilter(event.target.value)} value={availabilityFilter}>
          <option>All stock levels</option><option>In stock only</option><option>Out of stock</option><option>Most available</option><option>Least available</option>
        </select><Icon name="chevron" size={14} /></label>
      </section>
      {loading ? <p>Loading inventory from Supabase…</p> : (
        <section className="colour-groups" aria-label="Colour inventory">
          {Array.from(grouped.entries()).map(([letter, rows]) => (
            <article className="colour-card" id={`colour-${letter}`} key={letter}>
              <header><div><strong>{letter}</strong><span>{letter} colours</span></div><small>{rows.length} colours</small></header>
              <div className="colour-table-head"><span>Code</span><span>Preview</span><span>In stock</span></div>
              <div className="colour-rows">{rows.map((row) => (
                <div className="colour-row" key={row.id}>
                  <strong>{row.code}</strong>
                  <span className="colour-dot" style={{ backgroundColor: row.hex || "#cccccc" }} />
                  <input aria-label={`${row.code} beads in stock`} value={row.quantity}
                    inputMode="numeric" min="0" step="1" type="number" disabled={savingId === row.id}
                    onKeyDown={(event) => { if (["e", "E", "+", "-", "."].includes(event.key)) event.preventDefault(); }}
                    onChange={(event) => {
                      const value = event.target.value;
                      setColors((current) => current.map((item) => item.id === row.id ? { ...item, quantity: value === "" ? 0 : Math.max(0, Number(value)) } : item));
                    }}
                    onBlur={(event) => void saveQuantity(row.id, Number(event.target.value || 0))}
                  />
                </div>
              ))}</div>
              <footer>{rows.length} colours from Supabase</footer>
            </article>
          ))}
          {!filtered.length && <p className="no-colours">{colors.length ? "No matching colours." : "No colours found in the Supabase color table."}</p>}
        </section>
      )}
      {showCustomColour && <div className="modal-backdrop" role="presentation" onClick={() => setShowCustomColour(false)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="custom-colour-title" onClick={(event) => event.stopPropagation()}>
          <button className="modal-close" aria-label="Close" onClick={() => setShowCustomColour(false)}><Icon name="close" /></button>
          <h2 id="custom-colour-title">Add a custom colour</h2>
          <p>The colour and starting stock will be saved to Supabase.</p>
          <div className="modal-field-row">
            <label><span>Prefix</span><select value={prefix} onChange={(event) => setPrefix(event.target.value)}>{["A", "B", "C", "D", "E", "F", "G", "H", "M", "X"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Number</span><select value={number} onChange={(event) => setNumber(event.target.value)}>{Array.from({ length: 99 }, (_, i) => String(i + 1)).map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Count</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} min="0" step="1" type="number" /></label>
          </div>
          <label><span>Swatch</span><input aria-label="Choose colour" type="color" value={hex} onChange={(event) => setHex(event.target.value)} /></label>
          <div className="modal-actions"><button className="outline-button" onClick={() => setShowCustomColour(false)}>Cancel</button><button className="primary-button" onClick={() => void addCustomColor()}><Icon name="plus" /> Add colour</button></div>
        </section>
      </div>}
    </div>
  );
}

function AddProjectPage({
  onBack,
  onCreate,
}: {
  onBack: () => void
  onCreate: (project: Project) => void
}) {
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
    let cancelled = false;
    async function loadCategories() {
      const { data, error } = await supabase.from("category").select("name").order("name");
      if (error) {
        setFormError(`Could not load categories from Supabase: ${error.message}`);
        return;
      }
      if (!cancelled) {
        const names = (data ?? []).map((row) => row.name as string);
        setAvailableCategories(names);
        setCategory((current) => names.includes(current) ? current : (names[0] ?? ""));
      }
    }
    void loadCategories();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPalette() {
      const { data, error } = await supabase.from("color").select("id, color_code, hex_code").order("color_code");
      if (error) {
        setFormError(`Could not load colour palette from Supabase: ${error.message}`);
        return;
      }
      if (!cancelled) {
        setAvailablePalette((data ?? []).map((row) => ({ code: row.color_code, colour: row.hex_code ?? "#cccccc", count: 0, colorId: Number(row.id) })).sort((a, b) => compareCodes(a.code, b.code)));
      }
    }
    void loadPalette();
    return () => { cancelled = true; };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) return
    if (!category) {
      setFormError("Add a category in Manage categories before creating a project.")
      return
    }
    onCreate({
      name: name.trim(),
      category,
      pattern: "default",
      status: "Not started",
      beads: Math.max(1, totalBeads),
      image,
      recipe,
    })
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
      <button className="back-button" onClick={onBack}>
        ←   All projects
      </button>
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
            disabled={!name.trim() || !recipe.length}
            type="submit"
          >
            <Icon name="check" /> Save project
          </button>
          <button className="outline-button" onClick={onBack} type="button">
            Cancel
          </button>
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

function ProjectDetailPage({
  project,
  onBack,
  onCheckStock,
  onComplete,
  onStart,
  onUpdateRecipe,
  onUpdateDetails,
}: {
  project: Project
  onBack: () => void
  onCheckStock: () => void
  onComplete: () => void
  onStart: () => void
  onUpdateRecipe: (recipe: RecipeRow[]) => void
  onUpdateDetails: (name: string, category: string, image: string) => void
}) {
  const [recipe, setRecipe] = useState<RecipeRow[]>(project.recipe ?? [])
  const [availablePalette, setAvailablePalette] = useState<RecipeRow[]>([])
  const prefixes = useMemo(
    () => [...new Set(availablePalette.map((o) => splitCode(o.code).prefix))].sort(),
    [availablePalette],
  )
  const [availableCategories, setAvailableCategories] = useState<string[]>([project.category]);
  useEffect(() => {
    let cancelled = false;
    async function loadCategories() {
      const { data, error } = await supabase.from("category").select("name").order("name");
      if (error) { window.console.error("Could not load categories:", error.message); return; }
      if (!cancelled) setAvailableCategories((data ?? []).map((row) => row.name as string));
    }
    void loadCategories();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function loadPalette() {
      const { data, error } = await supabase.from("color").select("id, color_code, hex_code").order("color_code");
      if (error) {
        window.console.error("Could not load colour palette:", error.message);
        return;
      }
      if (!cancelled) {
        setAvailablePalette((data ?? []).map((row) => ({ code: row.color_code, colour: row.hex_code ?? "#cccccc", count: 0, colorId: Number(row.id) })).sort((a, b) => compareCodes(a.code, b.code)));
      }
    }
    void loadPalette();
    return () => { cancelled = true; };
  }, []);
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [projectName, setProjectName] = useState(project.name)
  const [projectCategory, setProjectCategory] = useState(project.category)
  const [projectImage, setProjectImage] = useState(project.image ?? "")
  const [deleteRecipeIndex, setDeleteRecipeIndex] = useState<number | null>(
    null,
  )

  const saveTimer = useRef<number | undefined>(undefined)

  // While editing, show the newly picked image straight away; otherwise show the saved one.
  const displayImage = isEditingDetails ? projectImage : project.image

  function uploadImage(file?: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setProjectImage(String(reader.result))
    reader.onerror = () => window.alert("Could not read the selected image.")
    reader.readAsDataURL(file)
  }

  function saveRecipe(nextRecipe: RecipeRow[]) {
    setRecipe(nextRecipe)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => onUpdateRecipe(nextRecipe), 500)
  }

  return (
    <div className="page flow-page">
      <button className="back-button" onClick={onBack}>
        ←   All projects
      </button>
      <section className="page-heading detail-heading">
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
                <strong>{projectImage ? "Replace image" : "Add image"}</strong>
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
          <button
            className={isEditingDetails ? "primary-button" : "outline-button"}
            onClick={() => {
              if (isEditingDetails && projectName.trim())
                onUpdateDetails(projectName.trim(), projectCategory, projectImage)
              setIsEditingDetails((current) => !current)
            }}
          >
            {isEditingDetails ? "Save details" : "Edit details"}
          </button>
        )}
      </section>

      <div className="detail-layout">
        <div>
          <section className="detail-card recipe-card">
            <div className="section-heading">
              <div>
                <h2>Bead recipe</h2>
                <p>Colours and quantities for this project.</p>
              </div>
              <strong>
                {recipe.reduce((total, row) => total + row.count, 0)} beads
              </strong>
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
              <button className="primary-button" onClick={onCheckStock}>
                Check stock
              </button>
            </section>
          )}
        </div>
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
          {project.status === "Not started" && (
            <button className="primary-button" onClick={onStart}>
              <Icon name="check" /> Start project
            </button>
          )}
          {project.status === "On-going" && (
            <button className="primary-button" onClick={onComplete}>
              <Icon name="check" /> Project completed
            </button>
          )}
        </aside>
      </div>
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

function StockCheckPage({
  projects,
  onBack,
}: {
  projects: Project[]
  onBack: () => void
}) {
  const [stockRows, setStockRows] = useState<{ code: string; colour: string; need: number; stock: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const required = projects.reduce((total, project) => total + project.beads, 0);
  const sufficient = stockRows.length > 0 && stockRows.every((row) => row.stock >= row.need);

  useEffect(() => {
    let cancelled = false;
    async function loadStockCheck() {
      try {
        setLoading(true);
        setError(null);
        const { data: colors, error: colorError } = await supabase
          .from("color").select("id, color_code, hex_code");
        if (colorError) throw colorError;
        const { data: inventory, error: inventoryError } = await supabase
          .from("inventory").select("color_id, quantity");
        if (inventoryError) throw inventoryError;
        const requirements = new Map<string, number>();
        projects.forEach((project) => (project.recipe ?? []).forEach((row) =>
          requirements.set(row.code, (requirements.get(row.code) ?? 0) + row.count)));
        const result = Array.from(requirements.entries()).map(([code, need]) => {
          const color = (colors ?? []).find((item) => item.color_code === code);
          const stockRow = (inventory ?? []).find((item) => item.color_id === color?.id);
          return { code, colour: color?.hex_code ?? "#cccccc", need, stock: Number(stockRow?.quantity ?? 0) };
        }).sort((a, b) => {
          // Colours that are short on stock come first, then natural code order.
          const aShort = a.stock < a.need ? 0 : 1;
          const bShort = b.stock < b.need ? 0 : 1;
          return aShort - bShort || compareCodes(a.code, b.code);
        });
        if (!cancelled) setStockRows(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not check stock.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadStockCheck();
    return () => { cancelled = true; };
  }, [projects]);

  const shortages = stockRows.filter((row) => row.stock < row.need);
  return (
    <div className="page flow-page">
      <button className="back-button" onClick={onBack}>← Back to projects</button>
      <section className="page-heading"><div><h1>A stock check, before you start.</h1><p>Requirements are calculated from the selected projects and compared with live Supabase inventory.</p></div></section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={`check-result ${!loading && !error && sufficient ? "check-result--good" : "check-result--short"}`}>
        <div><strong>{loading ? "Checking stock…" : error ? "Stock check failed." : sufficient ? "Sufficient — your selected projects are ready." : "Insufficient stock for some colours."}</strong>
          <p>{loading ? "Reading colour inventory from Supabase." : error ? error : sufficient ? "Every required colour has enough stock." : shortages.map((row) => `${row.code}: ${row.need - row.stock} short`).join(" · ")}</p>
        </div>
      </div>
      <div className="stock-layout"><section className="detail-card">
        <div className="section-heading"><div><h2>Combined colour requirements</h2><p>{projects.length} selected projects · {required.toLocaleString()} total beads</p></div></div>
        {loading ? <p>Loading stock…</p> : stockRows.length ? stockRows.map((row) => (
          <div className={`stock-row ${row.stock < row.need ? "stock-row--short" : ""}`} key={row.code}>
            <strong>{row.code}</strong><span className="colour-dot" style={{ backgroundColor: row.colour }} />
            <span>{row.need.toLocaleString()} required</span><span>{row.stock.toLocaleString()} in stock</span>
            <strong>{row.stock >= row.need ? "✓" : `${(row.need - row.stock).toLocaleString()} short`}</strong>
          </div>
        )) : !error && <p>No recipe colours are saved for the selected projects.</p>}
      </section></div>
    </div>
  );
}

type PageName = "projects" | "inventory" | "add" | "detail" | "stock"

type PendingConfirmation = {
  title: string
  message: string
  action: () => void
}

// Natural order: letters first (A, B, C...), then the number as a number (A1, A2, A10).
function compareCodes(a: string | null | undefined, b: string | null | undefined) {
  const pa = splitCode(a ?? "")
  const pb = splitCode(b ?? "")
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix)
  const na = parseInt(pa.number, 10)
  const nb = parseInt(pb.number, 10)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return pa.number.localeCompare(pb.number, undefined, { numeric: true })
}

function splitCode(code: string) {
  const m = code.match(/^([A-Za-z]+)(.*)$/);
  return { prefix: m?.[1] ?? "", number: m?.[2] ?? "" };
}

const keyOf = (project: Project) => project.id ?? project.name

function normalizeStatus(raw: string | null): Project["status"] {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "completed": return "Completed";
    case "ongoing": return "On-going";
    case "not_started":
    default: return "Not started";
  }
}

const DB_STATUS: Record<Project["status"], string> = {
  "Not started": "not_started",
  "On-going": "ongoing",
  "Completed": "completed",
};

function toDbStatus(status: Project["status"]): string {
  return DB_STATUS[status];
}

async function fetchAllProjectColors() {
  const pageSize = 1000;
  const all: { project_id: number; color_id: number; quantity: number | null }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("project_color")
      .select("project_id, color_id, quantity")
      .order("project_id")
      .order("color_id")
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return { data: all, error: null };
}

function App() {
  const [currentPage, setCurrentPage] = useState<PageName>("projects")
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] =
    useState<"All projects" | Project["status"]>("All projects")
  const [selectedKeys, setSelectedKeys] = useState<Array<number | string>>([])
  const [activeProject, setActiveProject] = useState<Project>({ name: "", category: "", pattern: "default", status: "Not started", beads: 0 })
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("All categories")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [notice, setNotice] = useState(true)
  const [showCategories, setShowCategories] = useState(false)
  const [categoryItems, setCategoryItems] = useState<{ id?: number; label: string; count: number; originalLabel?: string }[]>([])
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null)


  useEffect(() => {
    // true = also pick the default status tab (first load / refresh only)
    loadProjects(true);
  }, []);
  const filtered = useMemo(
    () =>
      projects.filter((project) => {
        const matchesQuery = project.name
          .toLowerCase()
          .includes(query.toLowerCase())
        const matchesCategory =
          category === "All categories" || project.category === category
        const matchesStatus =
          statusFilter === "All projects" || project.status === statusFilter
        return matchesQuery && matchesCategory && matchesStatus
      }),
    [query, category, projects, statusFilter],
  )

  const selectedProjects = projects.filter(
    (project) =>
      project.status !== "Completed" && selectedKeys.includes(keyOf(project)),
  )
  const selectableFiltered = filtered.filter(
    (project) => project.status !== "Completed",
  )
  const allVisibleSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((project) => selectedKeys.includes(keyOf(project)))


  async function getOrCreateCategoryId(categoryName: string): Promise<number> {
    const { data: found, error: findError } = await supabase
      .from("category").select("id").eq("name", categoryName).maybeSingle();
    if (findError) throw findError;
    if (found) return Number(found.id);
    const { data: created, error: createError } = await supabase
      .from("category").insert({ name: categoryName }).select("id").single();
    if (createError) throw createError;
    return Number(created.id);
  }

  async function saveProjectRecipe(projectId: number, recipe: RecipeRow[]) {
    // Compare codes ignoring leading zeros and case, so "A02" and "A2" match.
    const norm = (code: string) => {
      const m = code.trim().toUpperCase().match(/^([A-Z]+)0*(\d+)$/);
      return m ? `${m[1]}${m[2]}` : code.trim().toUpperCase();
    };

    // Rows that already carry a colour id need no lookup; only the rest are matched by code.
    const idByCode = new Map<string, number>();
    if (recipe.some((item) => item.colorId == null)) {
      const { data: colors, error: colorsError } = await supabase.from("color").select("id, color_code");
      if (colorsError) throw colorsError;
      for (const c of colors ?? []) idByCode.set(norm(c.color_code ?? ""), Number(c.id));
    }

    const missing: string[] = [];
    const countByColorId = new Map<number, number>();
    for (const item of recipe) {
      const colorId = item.colorId ?? idByCode.get(norm(item.code));
      if (colorId == null) { missing.push(item.code); continue; }
      countByColorId.set(colorId, (countByColorId.get(colorId) ?? 0) + item.count);
    }
    if (missing.length) throw new Error(`These recipe colours are missing from Supabase: ${missing.join(", ")}. Add them in Colour inventory first.`);

    const rows = [...countByColorId].map(([color_id, quantity]) => ({
      project_id: projectId,
      color_id,
      quantity,
    }));

    if (rows.length) {
      const { error: upsertError } = await supabase
        .from("project_color").upsert(rows, { onConflict: "project_id,color_id" });
      if (upsertError) throw upsertError;
    }

    let removal = supabase.from("project_color").delete().eq("project_id", projectId);
    if (rows.length) removal = removal.not("color_id", "in", `(${rows.map((r) => r.color_id).join(",")})`);
    const { error: deleteError } = await removal;
    if (deleteError) throw deleteError;
  }

  async function createProject(project: Project) {
    try {
      const categoryId = await getOrCreateCategoryId(project.category);
      const { data: row, error } = await supabase.from("project").insert({
        name: project.name,
        category_id: categoryId,
        status: toDbStatus(project.status),
        image_url: project.image || null,
      }).select("id").single();
      if (error) throw error;
      const savedProject: Project = { ...project, id: Number(row.id) };
      try {
        await saveProjectRecipe(savedProject.id!, project.recipe ?? []);
      } catch (recipeError) {
        await supabase.from("project").delete().eq("id", savedProject.id);
        throw recipeError;
      }
      setProjects((current) => [savedProject, ...current]);
      setActiveProject(savedProject);
      setCategoryItems((current) => current.some((item) => item.label === project.category)
        ? current : [...current, { label: project.category, count: 0 }]);
      setCurrentPage("detail");
    } catch (err) {
      console.error("Failed to save project:", err);
      window.alert(err instanceof Error ? err.message : "Could not save project to Supabase.");
    }
  }

  async function deleteProject(project: Project) {
    if (!project.id) {
      window.alert("This project has no Supabase ID, so it cannot be deleted from the database.");
      return;
    }
    const { error } = await supabase.from("project").delete().eq("id", project.id);
    if (error) {
      window.alert(`Could not delete project: ${error.message}`);
      return;
    }
    setProjects((current) => current.filter((item) => item.id !== project.id));
    setSelectedKeys((current) => current.filter((key) => key !== keyOf(project)));
    if (activeProject.id === project.id) setCurrentPage("projects");
  }

  async function updateProjectStatus(status: Project["status"]) {
    if (!activeProject.id) return;
    const { error } = await supabase.from("project").update({ status: toDbStatus(status) }).eq("id", activeProject.id);
    if (error) {
      window.alert(`Could not update project status: ${error.message}`);
      return;
    }
    setProjects((current) => current.map((item) => item.id === activeProject.id ? { ...item, status } : item));
    setSelectedKeys((current) => status === "Completed" ? current.filter((key) => key !== keyOf(activeProject)) : current);
    setActiveProject((current) => ({ ...current, status }));
  }

  async function completeProject() {
    if (!activeProject.id || activeProject.status === "Completed") return;
    try {
      const { data: recipeRows, error: recipeError } = await supabase
        .from("project_color").select("color_id, quantity").eq("project_id", activeProject.id);
      if (recipeError) throw recipeError;

      const needs = (recipeRows ?? [])
        .map((r) => ({ colorId: Number(r.color_id), need: Number(r.quantity ?? 0) }))
        .filter((r) => r.need > 0);

      if (needs.length) {
        const ids = needs.map((n) => n.colorId);
        const [{ data: stockRows, error: stockError }, { data: colorRows, error: colorError }] =
          await Promise.all([
            supabase.from("inventory").select("id, color_id, quantity").in("color_id", ids),
            supabase.from("color").select("id, color_code").in("id", ids),
          ]);
        if (stockError) throw stockError;
        if (colorError) throw colorError;

        type StockRow = { id: number; color_id: number; quantity: number | null };
        const stockByColor = new Map<number, StockRow>(
          (stockRows ?? []).map((s: StockRow) => [Number(s.color_id), s] as [number, StockRow]),
        );
        const codeById = new Map<number, string | null>(
          (colorRows ?? []).map((c: { id: number; color_code: string | null }) => [Number(c.id), c.color_code] as [number, string | null]),
        );

        const short = needs.filter((n) => Number(stockByColor.get(n.colorId)?.quantity ?? 0) < n.need);
        if (short.length) {
          window.alert(
            "Not enough stock to complete this project:\n" +
            short.map((n) =>
              `${codeById.get(n.colorId)}: need ${n.need}, have ${Number(stockByColor.get(n.colorId)?.quantity ?? 0)}`,
            ).join("\n"),
          );
          return;
        }

        const results = await Promise.all(needs.map((n) => {
          const stock = stockByColor.get(n.colorId)!;
          return supabase.from("inventory")
            .update({ quantity: Number(stock.quantity) - n.need }).eq("id", stock.id);
        }));
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      }

      await updateProjectStatus("Completed");
    } catch (err) {
      window.alert(("Could not complete project."));
    }
  }

  async function loadProjects(applyDefaultTab = false) {
    setProjectsLoading(true);
    setProjectsError(null);
    const { data: projectRows, error: projectError } = await supabase
      .from("project")
      .select("*")
      .order("created_at", { ascending: false });

    if (projectError) {
      console.error("Failed to load projects:", projectError.message);
      setProjectsError(`Failed to load projects from Supabase: ${projectError.message}`);
      setProjects([]);
      setProjectsLoading(false);
      return;
    }

    const { data: categoryRows, error: categoryError } = await supabase
      .from("category")
      .select("*");

    if (categoryError) {
      console.error("Failed to load categories:", categoryError.message);
      setProjectsError(`Failed to load categories from Supabase: ${categoryError.message}`);
      setProjectsLoading(false);
      return;
    }
    setCategoryItems((categoryRows ?? []).map((item) => ({
      id: Number(item.id), label: item.name, originalLabel: item.name,
      count: (projectRows ?? []).filter((project) => project.category_id === item.id).length,
    })));

    const { data: recipeRows, error: recipeError } = await fetchAllProjectColors();

    if (recipeError) {
      console.error("Failed to load project colours:", recipeError.message);
      window.alert(`Failed to load project recipes from Supabase: ${recipeError.message}`);
      return;
    }

    const { data: colorRows, error: colorError } = await supabase
      .from("color")
      .select("*");

    console.log("project rows:", projectRows?.length);
    console.log("project_color rows:", recipeRows?.length, recipeRows?.slice(0, 3));

    if (colorError) {
      console.error("Failed to load colours:", colorError.message);
      setProjectsError(`Failed to load colours from Supabase: ${colorError.message}`);
      setProjectsLoading(false);
      return;
    }


    const mappedProjects: Project[] = (projectRows ?? []).map((row) => {
      const categoryName =
        categoryRows?.find((category) => category.id === row.category_id)
          ?.name ?? "Uncategorised";

      const recipe: RecipeRow[] = (recipeRows ?? [])
        .filter((item) => item.project_id === row.id)
        .map((item) => {
          const color = colorRows?.find(
            (color) => color.id === item.color_id
          );

          return {
            code: color?.color_code ?? "",
            colour: color?.hex_code ?? "#cccccc",
            count: Number(item.quantity ?? 0),
            colorId: Number(item.color_id),
          };
        });

      return {
        id: Number(row.id),
        name: row.name ?? "Untitled project",
        category: categoryName,
        pattern: "default",
        status: normalizeStatus(row.status),
        beads: recipe.reduce((total, item) => total + item.count, 0),
        image: row.image_url ?? undefined,
        recipe,
      };
    });
    setProjects(mappedProjects);

    // On first load / refresh: open the On-going tab if there is any ongoing project,
    // otherwise the Not started tab, otherwise fall back to All projects.
    if (applyDefaultTab) {
      const hasOngoing = mappedProjects.some((p) => p.status === "On-going");
      const hasNotStarted = mappedProjects.some((p) => p.status === "Not started");
      setStatusFilter(hasOngoing ? "On-going" : hasNotStarted ? "Not started" : "All projects");
    }

    if (mappedProjects.length > 0) {
      setActiveProject(mappedProjects[0]);
    }
    setProjectsLoading(false);
  }

  async function saveCategoryChanges() {
    try {
      for (const item of categoryItems) {
        if (!item.id) continue;
        const name = item.label.trim();
        if (!name) throw new Error("Category names cannot be empty.");
        if (name !== item.originalLabel) {
          const { error } = await supabase.from("category").update({ name }).eq("id", item.id);
          if (error) throw error;
        }
      }
      setCategoryItems((current) => current.map((item) => ({ ...item, originalLabel: item.label.trim() })));
      await loadProjects();
      setShowCategories(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save categories.");
    }
  }

  async function addCategory() {
    const name = `New category ${categoryItems.length + 1}`;
    try {
      const { data, error } = await supabase.from("category").insert({ name }).select("id").single();
      if (error) throw error;
      setCategoryItems((current) => [...current, { id: Number(data.id), label: name, originalLabel: name, count: 0 }]);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not add category.");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>BeadRoom</span>
        </div>

        <div className="sidebar-section">
          <nav aria-label="Primary navigation">
            <button
              className={`nav-item ${currentPage !== "inventory" ? "nav-item--active" : ""
                }`}
              onClick={() => setCurrentPage("projects")}
            >
              <Icon name="grid" />
              <span>All projects</span>
            </button>
            <button
              className={`nav-item ${currentPage === "inventory" ? "nav-item--active" : ""
                }`}
              onClick={() => setCurrentPage("inventory")}
            >
              <Icon name="palette" />
              <span>Colour inventory</span>
            </button>
          </nav>
        </div>
      </aside>

      <main>
        <div
          className={`page ${currentPage !== "projects" ? "page--hidden" : ""}`}
        >
          <section className="page-heading">
            <div>
              <h1>All projects</h1>
              <p>
                A home for your bead ideas, from the first bead to the final
                press.
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => setCurrentPage("add")}
            >
              <Icon name="plus" />
              New project
            </button>
          </section>

          <section className="toolbar">
            <label className="search-field">
              <Icon name="search" />
              <input
                aria-label="Search projects"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects..."
                value={query}
              />
            </label>
            <label className="select-field">
              <select
                aria-label="Filter by category"
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                <option>All categories</option>
                {categoryItems.map((item) => <option key={item.id ?? item.label}>{item.label}</option>)}
              </select>
              <Icon name="chevron" size={14} />
            </label>
            <span className="results-count">
              Showing {filtered.length} of {projects.length} projects
            </span>
            <button
              className="manage-button"
              onClick={() => setShowCategories(true)}
            >
              Manage categories
            </button>
          </section>

          {projectsError && <p className="form-error" role="alert">{projectsError}</p>}
          {projectsLoading && <p role="status">Loading projects from Supabase…</p>}
          <div className="project-subnav">
            <div>
              {([
                "All projects",
                "Not started",
                "On-going",
                "Completed",
              ] as const).map((status) => (
                <button
                  className={`tab ${statusFilter === status ? "tab--active" : ""
                    }`}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="project-tools">
              <button
                className="select-all-button"
                disabled={!selectableFiltered.length}
                onClick={() => {
                  setSelectedKeys((current) =>
                    allVisibleSelected
                      ? current.filter(
                        (key) =>
                          !selectableFiltered.some(
                            (project) => keyOf(project) === key,
                          ),
                      )
                      : Array.from(
                        new Set([
                          ...current,
                          ...selectableFiltered.map(
                            (project) => keyOf(project),
                          ),
                        ]),
                      ),
                  )
                  setNotice(true)
                }}
              >
                {allVisibleSelected ? "Uncheck all" : "Check all"}
              </button>
              <div className="view-switch" aria-label="View style">
                <button
                  aria-label="Grid view"
                  className={view === "grid" ? "active" : ""}
                  onClick={() => setView("grid")}
                >
                  <Icon name="grid" size={14} />
                </button>
                <button
                  aria-label="List view"
                  className={view === "list" ? "active" : ""}
                  onClick={() => setView("list")}
                >
                  <Icon name="list" size={15} />
                </button>
              </div>
            </div>
          </div>

          {notice && selectedProjects.length > 0 && (
            <div className="stock-banner">
              <span className="stock-banner-icon">
                <Icon name="box" />
              </span>
              <div>
                <strong>
                  {selectedProjects.length} projects selected ·{" "}
                  {selectedProjects
                    .reduce((total, project) => total + project.beads, 0)
                    .toLocaleString()}{" "}
                  beads
                </strong>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setSelectedKeys([])
                  setNotice(false)
                }}
              >
                Clear selection
              </button>
              <button
                className="secondary-button"
                onClick={() => setCurrentPage("stock")}
              >
                <Icon name="check" />
                Check combined stock
              </button>
            </div>
          )}

          {filtered.length ? (
            <section
              className={`project-grid project-grid--${view}`}
              aria-label="Projects"
            >
              {filtered.map((project, index) => (
                <article
                  className={`project-card ${selectedKeys.includes(keyOf(project))
                    ? "project-card--selected"
                    : ""
                    } ${project.status === "Completed"
                      ? "project-card--completed"
                      : ""
                    }`}
                  key={project.id ?? project.name}
                  onClick={() => {
                    if (project.status === "Completed") return
                    setActiveProject(project)
                    setCurrentPage("detail")
                  }}
                >
                  <div className={`art-panel art-panel--${project.pattern}`}>
                    {project.status !== "Completed" && (
                      <label
                        className="project-check"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          checked={selectedKeys.includes(keyOf(project))}
                          onChange={() => {
                            setNotice(true)
                            setSelectedKeys((current) =>
                              current.includes(keyOf(project))
                                ? current.filter(
                                  (key) => key !== keyOf(project),
                                )
                                : [...current, keyOf(project)],
                            )
                          }}
                          onClick={(event) => event.stopPropagation()}
                          type="checkbox"
                        />
                        <span>
                          <Icon name="check" size={11} />
                        </span>
                      </label>
                    )}
                    <button
                      className="more-button"
                      aria-label={`More options for ${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setPendingConfirmation({
                          title: "Delete project?",
                          message: `Delete “${project.name}”? This cannot be undone.`,
                          action: () => { void deleteProject(project); },
                        })
                      }}
                    >
                      <Icon name="close" />
                    </button>
                    {project.image ? (
                      <img
                        className="project-uploaded-image"
                        alt=""
                        src={project.image}
                      />
                    ) : (
                      <div className="project-image-placeholder" aria-label="No project image uploaded">
                        <Icon name="palette" size={28} />
                        <span>No image</span>
                      </div>
                    )}
                  </div>
                  <div className="card-body">
                    <div className="card-kicker">
                      <span>{project.category}</span>
                      <span
                        className={`status status--${project.status.toLowerCase().replace(/ /g, "-")}`}
                      >
                        {project.status}
                      </span>
                    </div>
                    <h2>{project.name}</h2>
                    <p>{project.beads} beads</p>
                  </div>
                </article>
              ))}
            </section>
          ) : !projectsLoading && !projectsError ? (
            <div className="empty-state">
              <Icon name="search" size={24} />
              <strong>No projects found</strong>
              <p>Try another search or choose a different category.</p>
            </div>
          ) : null}
        </div>
        {currentPage === "inventory" && <InventoryPage />}
        {currentPage === "add" && (
          <AddProjectPage
            onBack={() => setCurrentPage("projects")}
            onCreate={createProject}
          />
        )}
        {currentPage === "detail" && (
          <ProjectDetailPage
            onBack={() => setCurrentPage("projects")}
            onCheckStock={() => {
              setSelectedKeys([keyOf(activeProject)])
              setCurrentPage("stock")
            }}
            onComplete={completeProject}
            onStart={() => { void updateProjectStatus("On-going"); }}
            onUpdateDetails={async (name, category, image) => {
              if (!activeProject.id) return;
              try {
                const categoryId = await getOrCreateCategoryId(category);
                const { error } = await supabase.from("project")
                  .update({ name, category_id: categoryId, image_url: image || null })
                  .eq("id", activeProject.id);
                if (error) throw error;
                const nextImage = image || undefined;
                setProjects((current) => current.map((project) =>
                  project.id === activeProject.id ? { ...project, name, category, image: nextImage } : project));
                setActiveProject((project) => ({ ...project, name, category, image: nextImage }));
              } catch (err) {
                window.alert(err instanceof Error ? err.message : "Could not update project details.");
              }
            }}
            onUpdateRecipe={async (recipe) => {
              if (!activeProject.id) return;
              try {
                await saveProjectRecipe(activeProject.id, recipe);
                const beads = recipe.reduce((total, row) => total + row.count, 0);
                setProjects((current) => current.map((project) =>
                  project.id === activeProject.id ? { ...project, recipe, beads } : project));
                setActiveProject((project) => ({ ...project, recipe, beads }));
              } catch (err) {
                window.alert(err instanceof Error ? err.message : "Could not save recipe.");
              }
            }}
            project={activeProject}
          />
        )}
        {currentPage === "stock" && (
          <StockCheckPage
            onBack={() => setCurrentPage("projects")}
            projects={
              selectedProjects.length ? selectedProjects : projects.slice(0, 1)
            }
          />
        )}
      </main>
      {showCategories && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowCategories(false)}
        >
          <section
            className="modal category-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setShowCategories(false)}
            >
              <Icon name="close" />
            </button>
            <h2 id="category-title">Manage categories</h2>
            <p>
              Organise project categories and add a new place for your ideas.
            </p>
            <div className="category-modal-list">
              {categoryItems.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <input
                    aria-label="Category name"
                    onChange={(event) =>
                      setCategoryItems((current) =>
                        current.map((category, categoryIndex) =>
                          categoryIndex === index
                            ? { ...category, label: event.target.value }
                            : category,
                        ),
                      )
                    }
                    value={item.label}
                  />
                  <span>{item.count} projects</span>
                  <button
                    aria-label={`Delete ${item.label}`}
                    onClick={() => {
                      setPendingConfirmation({
                        title: "Delete category?",
                        message: `Delete the “${item.label}” category? Projects will keep their current category label.`,
                        action: async () => {
                          if (item.id) {
                            const { error } = await supabase.from("category").delete().eq("id", item.id);
                            if (error) {
                              window.alert(`Could not delete category: ${error.message}`);
                              return;
                            }
                          }
                          setCategoryItems((current) => current.filter((_, categoryIndex) => categoryIndex !== index));
                          await loadProjects();
                        },
                      })
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="outline-button"
              onClick={() => { void addCategory(); }}
            >
              <Icon name="plus" /> Add category
            </button>
            <div className="modal-actions">
              <button
                className="primary-button"
                onClick={() => { void saveCategoryChanges(); }}
              >
                Save categories
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingConfirmation && (
        <ConfirmDialog
          title={pendingConfirmation.title}
          message={pendingConfirmation.message}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => {
            pendingConfirmation.action()
            setPendingConfirmation(null)
          }}
        />
      )}
    </div>
  )
}

export default App
