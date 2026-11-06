"use client"

import { useRef, type PointerEvent as ReactPointerEvent } from "react"
import type { GridBox } from "@/lib/pattern/decode"

type Props = {
  src: string
  width: number
  height: number
  box: GridBox
  cols: number
  rows: number
  /** Called while dragging a corner. Omit to hide the handles. */
  onBoxChange?: (box: GridBox) => void
  /** When set, tapping the image reports the tapped point (image pixels) instead. */
  onPick?: (x: number, y: number) => void
}

/** The screenshot with the grid drawn over it, and two draggable corners to line it up. */
export function GridAligner({ src, width, height, box, cols, rows, onBoxChange, onPick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<"tl" | "br" | null>(null)

  function toImage(e: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(width, ((e.clientX - rect.left) / rect.width) * width)),
      y: Math.max(0, Math.min(height, ((e.clientY - rect.top) / rect.height) * height)),
    }
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!dragging.current || !onBoxChange) return
    const p = toImage(e)
    const min = 10
    if (dragging.current === "tl") onBoxChange({ ...box, x0: Math.min(p.x, box.x1 - min), y0: Math.min(p.y, box.y1 - min) })
    else onBoxChange({ ...box, x1: Math.max(p.x, box.x0 + min), y1: Math.max(p.y, box.y0 + min) })
  }

  const cw = (box.x1 - box.x0) / cols
  const ch = (box.y1 - box.y0) / rows
  const unit = Math.max(width, height) / 400 // keeps lines/handles a sensible size on any image
  const lines: string[] = []
  for (let c = 1; c < cols; c++) lines.push(`M${box.x0 + c * cw} ${box.y0}V${box.y1}`)
  for (let r = 1; r < rows; r++) lines.push(`M${box.x0} ${box.y0 + r * ch}H${box.x1}`)

  return (
    <div className={`grid-aligner ${onPick ? "grid-aligner--picking" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Pattern screenshot" draggable={false} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onPointerMove={onMove}
        onPointerUp={() => { dragging.current = null }}
        onPointerCancel={() => { dragging.current = null }}
        onClick={(e) => {
          if (!onPick) return
          const p = toImage(e)
          onPick(p.x, p.y)
        }}
      >
        {!onPick && (
          <>
            <path d={lines.join("")} stroke="#ff2d55" strokeOpacity={0.55} strokeWidth={unit * 0.35} fill="none" />
            <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="none" stroke="#ff2d55" strokeWidth={unit * 0.9} />
          </>
        )}
        {onBoxChange && !onPick && (["tl", "br"] as const).map((corner) => (
          <circle
            key={corner}
            cx={corner === "tl" ? box.x0 : box.x1}
            cy={corner === "tl" ? box.y0 : box.y1}
            r={unit * 7}
            fill="#ff2d55"
            fillOpacity={0.85}
            stroke="#fff"
            strokeWidth={unit * 1.2}
            style={{ cursor: "move", touchAction: "none" }}
            onPointerDown={(e) => {
              e.preventDefault()
              svgRef.current?.setPointerCapture(e.pointerId)
              dragging.current = corner
            }}
          />
        ))}
      </svg>
    </div>
  )
}
