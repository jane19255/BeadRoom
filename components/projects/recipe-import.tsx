"use client"

import { useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { parseRecipeText } from "@/lib/beads"
import type { RecipeRow } from "@/lib/types"

export function RecipeImport({
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
