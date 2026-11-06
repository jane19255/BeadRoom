"use client"

import { useEffect, useRef, useState } from "react"
import {
  errorMessage, LoadingOverlay, SaveStatus, Spinner, toast, useUnsavedChangesWarning, type SaveState,
} from "@/components/feedback"
import { Icon } from "@/components/icon"
import { compareCodes } from "@/lib/beads"
import { supabase } from "@/lib/supabase/client"
import { getColorsAndInventory } from "@/lib/supabase/data"

/** At or below this many beads a colour is shown as "Low". */
const LOW_STOCK = 50

export default function InventoryPage() {
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
  // Autosave bookkeeping, per colour id:
  //   drafts  = what's typed in the box but not saved yet (kept as text so the box can be emptied while typing)
  //   saving  = currently being written to Supabase
  //   failed  = last save failed; the typed value is kept so it can be retried
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [hasSaved, setHasSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("X");
  const [number, setNumber] = useState("1");
  const [quantity, setQuantity] = useState("0");
  const [hex, setHex] = useState("#b791ad");

  // The last quantity the database confirmed for each colour. Used to skip
  // saving when nothing changed, and to roll back if a save fails.
  const savedQuantities = useRef(new Map<number, number>());

  async function loadInventory() {
    try {
      setLoading(true);
      setError(null);
      const data = await getColorsAndInventory();
      savedQuantities.current = new Map(data.map((item) => [item.id, item.quantity]));
      setColors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadInventory(); }, []);

  const without = (set: Set<number>, id: number) => { const next = new Set(set); next.delete(id); return next; };
  const withId = (set: Set<number>, id: number) => new Set(set).add(id);
  const clearDraft = (id: number) => setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });

  async function saveQuantity(colorId: number) {
    const draft = drafts[colorId];
    if (draft === undefined) return; // nothing typed, nothing to save
    const code = colors.find((item) => item.id === colorId)?.code ?? "Colour";
    const previous = savedQuantities.current.get(colorId) ?? 0;
    const nextQuantity = draft.trim() === "" ? previous : Number(draft);

    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      clearDraft(colorId);
      toast.error(`${code} not saved`, { description: "Stock must be a whole number of zero or more." });
      return;
    }
    if (nextQuantity === previous) { // changed back to what's saved
      clearDraft(colorId);
      setFailed((current) => without(current, colorId));
      return;
    }

    setSaving((current) => withId(current, colorId));
    try {
      const { data: existing, error: findError } = await supabase
        .from("inventory").select("id").eq("color_id", colorId).maybeSingle();
      if (findError) throw findError;
      // .select() makes Supabase return the row it actually wrote. If a security
      // rule (RLS) blocks the write, there is no error, just no row, so we check.
      const { data: written, error: writeError } = existing
        ? await supabase.from("inventory").update({ quantity: nextQuantity }).eq("id", existing.id).select("quantity").maybeSingle()
        : await supabase.from("inventory").insert({ color_id: colorId, quantity: nextQuantity }).select("quantity").maybeSingle();
      if (writeError) throw writeError;
      if (!written) throw new Error("The database did not save the change (check your Supabase RLS policies).");

      const confirmed = Number(written.quantity);
      savedQuantities.current.set(colorId, confirmed);
      setColors((current) => current.map((item) => item.id === colorId ? { ...item, quantity: confirmed } : item));
      // Only clear the draft if nothing new was typed while saving.
      setDrafts((current) => {
        if (current[colorId] !== draft) return current;
        const next = { ...current }; delete next[colorId]; return next;
      });
      setFailed((current) => without(current, colorId));
      setHasSaved(true);
    } catch (err) {
      // Keep what was typed (shown in red) so nothing is lost and it can be retried.
      setFailed((current) => withId(current, colorId));
      toast.error(`Couldn't save ${code}`, { description: errorMessage(err, "Could not save stock quantity.") });
    } finally {
      setSaving((current) => without(current, colorId));
    }
  }

  function retryFailed() {
    for (const id of failed) void saveQuantity(id);
  }

  const editingIds = Object.keys(drafts).map(Number).filter((id) => !saving.has(id) && !failed.has(id));
  const saveState: SaveState =
    failed.size ? "error" : saving.size ? "saving" : editingIds.length ? "pending" : hasSaved ? "saved" : "idle";
  useUnsavedChangesWarning(saveState === "pending" || saveState === "saving" || saveState === "error");

  const [addingColour, setAddingColour] = useState(false);

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
    setAddingColour(true);
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
      savedQuantities.current.set(Number(color.id), stock);
      setColors((current) => [...current, {
        id: Number(color.id), group: color.letter_group, code: color.color_code,
        hex: color.hex_code, quantity: stock,
      }].sort((a, b) => compareCodes(a.code, b.code)));
      setShowCustomColour(false);
      setPrefix("X"); setNumber("1"); setQuantity("0"); setHex("#b791ad");
      toast.success(`${code} added`, { description: `Starting stock: ${stock} beads` });
    } catch (err) {
      // Keep the dialog open with what was typed so it can be retried.
      toast.error("Couldn't add colour", { description: errorMessage(err, "Could not add colour.") });
    } finally {
      setAddingColour(false);
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
      {loading ? <LoadingOverlay message="Loading your colour inventory…" /> : (
        <>
          <nav className="inventory-index" aria-label="Jump to colour group">
            <span>Jump to</span>
            <div className="inventory-index__letters">
              {Array.from(grouped.keys()).map((letter) => (
                <button
                  key={letter}
                  onClick={() => document.getElementById(`colour-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  type="button"
                >
                  {letter}
                </button>
              ))}
            </div>
            <small><SaveStatus state={saveState} onRetry={retryFailed} /></small>
          </nav>
          <section className="colour-groups" aria-label="Colour inventory">
            {Array.from(grouped.entries()).map(([letter, rows]) => (
              <article className="colour-card" id={`colour-${letter}`} key={letter}>
                <header>
                  <div><strong>{letter}</strong><span>{letter} colours</span></div>
                  <small>
                    {rows.length} colours
                    {rows.some((row) => row.quantity === 0) && ` · ${rows.filter((row) => row.quantity === 0).length} out`}
                  </small>
                </header>
                <div className="colour-table-head"><span>Code</span><span>Preview</span><span>In stock</span></div>
                <div className="colour-rows">{rows.map((row) => {
                  const stock = row.quantity === 0 ? "out" : row.quantity <= LOW_STOCK ? "low" : "ok";
                  const rowClass = [
                    "colour-row",
                    `colour-row--${stock}`,
                    saving.has(row.id) && "colour-row--saving",
                    failed.has(row.id) && "colour-row--failed",
                  ].filter(Boolean).join(" ");
                  return (
                    <div className={rowClass} key={row.id} data-stock={stock === "out" ? "Out" : stock === "low" ? "Low" : undefined}>
                      <strong>{row.code}</strong>
                      <span className="colour-dot" style={{ backgroundColor: row.hex || "#cccccc" }} />
                      <input
                        aria-label={`${row.code} beads in stock`}
                        value={drafts[row.id] ?? String(row.quantity)}
                        inputMode="numeric" min="0" step="1" type="number"
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          if (["e", "E", "+", "-", "."].includes(event.key)) event.preventDefault();
                          if (event.key === "Enter") event.currentTarget.blur(); // Enter saves, like most sites
                          if (event.key === "Escape") clearDraft(row.id); // undo what was typed
                        }}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDrafts((current) => ({ ...current, [row.id]: value }));
                          setFailed((current) => without(current, row.id));
                        }}
                        onBlur={() => void saveQuantity(row.id)}
                      />
                    </div>
                  );
                })}</div>
                <footer>{rows.length} colours from Supabase</footer>
              </article>
            ))}
            {!filtered.length && <p className="no-colours">{colors.length ? "No matching colours." : "No colours found in the Supabase color table."}</p>}
          </section>
        </>
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
          <div className="modal-actions"><button className="outline-button" onClick={() => setShowCustomColour(false)}>Cancel</button><button className="primary-button" disabled={addingColour} onClick={() => void addCustomColor()}>{addingColour ? <><Spinner /> Adding…</> : <><Icon name="plus" /> Add colour</>}</button></div>
        </section>
      </div>}
    </div>
  );
}
