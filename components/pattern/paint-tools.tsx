"use client"

import { Icon, type IconName } from "@/components/icon"

export type PaintTool = "move" | "paint" | "fill" | "erase" | "pick" | "select"

const TOOLS: { id: PaintTool; label: string; icon: IconName; hint: string }[] = [
  { id: "move", label: "Move", icon: "hand", hint: "Pan and zoom only" },
  { id: "paint", label: "Paint", icon: "pencil", hint: "Tap or draw to paint cells with the selected colour" },
  { id: "fill", label: "Fill", icon: "bucket", hint: "Fill an area of the same colour" },
  { id: "erase", label: "Erase", icon: "eraser", hint: "Make cells empty (no bead)" },
  { id: "pick", label: "Pick", icon: "pipette", hint: "Tap a cell to use its colour" },
  { id: "select", label: "Select", icon: "lasso", hint: "Draw a loop around cells, then drag them to move" },
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
  /** Cells currently selected with the Select tool (shows Deselect / Delete). */
  selectedCount?: number
  onDeselect?: () => void
  onDeleteSelection?: () => void
  /** Turn the selected cells a quarter turn (1 = clockwise, -1 = anticlockwise). */
  onRotateSelection?: (dir: 1 | -1) => void
  /** Smaller version for the floating bar in full screen. */
  compact?: boolean
}

/** Drawing tools shared by "Check the pattern" and "Draw a pattern". */
export function PaintTools(props: Props) {
  const { tool, onTool, brush, canUndo, canRedo, onUndo, onRedo, onFlip, selectedCount = 0, onDeselect, onDeleteSelection, onRotateSelection, compact } = props
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
          aria-label={t.label}
          aria-pressed={tool === t.id}
          onClick={() => onTool(t.id)}
          type="button"
        >
          <Icon name={t.icon} size={17} />
          {!compact && <span>{t.label}</span>}
        </button>
      ))}
      <span className="paint-tools__sep" aria-hidden="true" />
      <button className="paint-tools__tool" disabled={!canUndo} onClick={onUndo} title="Undo" aria-label="Undo" type="button">
        <Icon name="undo" size={17} />{!compact && <span>Undo</span>}
      </button>
      <button className="paint-tools__tool" disabled={!canRedo} onClick={onRedo} title="Redo" aria-label="Redo" type="button">
        <Icon name="redo" size={17} />{!compact && <span>Redo</span>}
      </button>
      <button className="paint-tools__tool" onClick={onFlip} title="Flip the whole pattern left ↔ right" aria-label="Flip horizontally" type="button">
        <Icon name="flip" size={17} />{!compact && <span>Flip</span>}
      </button>
      {selectedCount > 0 && (
        <>
          <span className="paint-tools__sep" aria-hidden="true" />
          <span className="paint-tools__selection">{selectedCount} selected</span>
          {onRotateSelection && (
            <>
              <button className="paint-tools__tool" onClick={() => onRotateSelection(-1)} title="Rotate the selection anticlockwise" aria-label="Rotate selection left" type="button">
                <Icon name="rotate-ccw" size={17} />{!compact && <span>Rotate left</span>}
              </button>
              <button className="paint-tools__tool" onClick={() => onRotateSelection(1)} title="Rotate the selection clockwise" aria-label="Rotate selection right" type="button">
                <Icon name="rotate-cw" size={17} />{!compact && <span>Rotate right</span>}
              </button>
            </>
          )}
          {onDeleteSelection && (
            <button className="paint-tools__tool" onClick={onDeleteSelection} title="Remove the selected beads" aria-label="Delete selection" type="button">
              <Icon name="trash" size={17} />{!compact && <span>Delete</span>}
            </button>
          )}
          {onDeselect && (
            <button className="paint-tools__tool" onClick={onDeselect} title="Deselect" aria-label="Deselect" type="button">
              <Icon name="close" size={17} />{!compact && <span>Deselect</span>}
            </button>
          )}
        </>
      )}
    </div>
  )
}
