"use client"

import { useRef, useState } from "react"

/**
 * Pattern cells with undo/redo. Call checkpoint() once before a change (e.g. at the start of a
 * Pencil stroke, before a fill or a flip); everything until the next checkpoint is one undo step.
 */
export function useCellHistory(initial: number[] = []) {
  const [cells, setCells] = useState<number[]>(initial)
  const current = useRef(cells)
  current.current = cells
  const past = useRef<number[][]>([])
  const future = useRef<number[][]>([])
  const [, rerender] = useState(0)

  function checkpoint() {
    past.current.push(current.current)
    if (past.current.length > 200) past.current.shift()
    future.current = []
    rerender((n) => n + 1)
  }

  /** Change cells without adding an undo step (use checkpoint() first). */
  function change(update: (cells: number[]) => number[]) {
    setCells((prev) => {
      const next = update(prev)
      current.current = next
      return next
    })
  }

  /** Set one cell (cheap no-op if it already has that value). */
  function setCell(index: number, value: number) {
    change((prev) => {
      if (prev[index] === value) return prev
      const next = prev.slice()
      next[index] = value
      return next
    })
  }

  function undo() {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(current.current)
    current.current = prev
    setCells(prev)
  }

  function redo() {
    const next = future.current.pop()
    if (!next) return
    past.current.push(current.current)
    current.current = next
    setCells(next)
  }

  /** Replace everything and forget the history (e.g. a new reading or a new drawing). */
  function reset(next: number[]) {
    past.current = []
    future.current = []
    current.current = next
    setCells(next)
  }

  return {
    cells, checkpoint, change, setCell, undo, redo, reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  }
}
