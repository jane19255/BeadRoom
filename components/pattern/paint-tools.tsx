"use client"

export type PaintTool = "move" | "paint" | "fill" | "erase" | "pick"

const TOOLS: { id: PaintTool; label: string; icon: string; hint: string }[] = [
  { id: "move", label: "Move", icon: "✋", hint: "Pan and zoom only" },
  { id: "paint", label: "Paint", icon: "✏️", hint: "Tap or draw to paint cells with the selected colour" },
  { id: "fill", label: "Fill", icon: "🪣", hint: "Fill an area of the same colour" },
  { id: "erase", label: "Erase", icon: "⌫", hint: "Make cells empty (no bead)" },
  { id: "pick", label: "Pick", icon: "💧", hint: "Tap a cell to use its colour" },
]

type Props = {
  tool: PaintTool
  onTool: (tool: PaintTool) => void
  /** Selected colour: swatch + code (null = none yet). */
  brush: { code: string; hex: string } | null
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onFlip: () => void
  /** Smaller version for the floating bar in full screen. */
  compact?: boolean
}

/** Drawing tools shared by "Check the pattern" and "Draw a pattern". */
export function PaintTools({ tool, onTool, brush, canUndo, canRedo, onUndo, onRedo, onFlip, compact }: Props) {
  return (
    <div className={`paint-tools ${compact ? "paint-tools--compact" : ""}`} role="toolbar" aria-label="Drawing tools">
      <span className="paint-tools__brush" title={brush ? `Selected colour ${brush.code}` : "No colour selected"}>
        <i style={{ background: brush?.hex ?? "transparent" }} className={brush ? undefined : "is-none"} />
        {!compact && <strong>{brush?.code ?? "No colour"}</strong>}
      </span>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`paint-tools__tool ${tool === t.id ? "is-on" : ""}`}
          title={t.hint}
          aria-pressed={tool === t.id}
          onClick={() => onTool(t.id)}
          type="button"
        >
          <span aria-hidden="true">{t.icon}</span>
          {!compact && t.label}
        </button>
      ))}
      <span className="paint-tools__sep" aria-hidden="true" />
      <button className="paint-tools__tool" disabled={!canUndo} onClick={onUndo} title="Undo" aria-label="Undo" type="button">↶{!compact && " Undo"}</button>
      <button className="paint-tools__tool" disabled={!canRedo} onClick={onRedo} title="Redo" aria-label="Redo" type="button">↷{!compact && " Redo"}</button>
      <button className="paint-tools__tool" onClick={onFlip} title="Flip the whole pattern left ↔ right" aria-label="Flip horizontally" type="button">⇋{!compact && " Flip"}</button>
    </div>
  )
}
