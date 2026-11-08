"use client"

import { useState } from "react"

/**
 * Number box for columns / rows: only digits can be typed (number keypad on phones and iPads).
 * The grid preview updates as you type; an empty or out-of-range value goes back on leaving the box.
 */
export function SizeInput({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)
  const [before, setBefore] = useState(value)
  const shown = editing ? draft : String(value)
  const commit = () => {
    const n = Number(draft)
    onChange(draft !== "" && n >= 2 && n <= 300 ? n : before) // empty / out of range → back to what it was
    setEditing(false)
  }
  return (
    <input
      aria-label={label}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      value={shown}
      onFocus={(e) => { setDraft(String(value)); setBefore(value); setEditing(true); e.currentTarget.select() }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 3)
        setDraft(digits)
        const n = Number(digits)
        if (digits !== "" && n >= 2 && n <= 300) onChange(n)
      }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
    />
  )
}
