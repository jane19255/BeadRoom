import { supabase } from "@/lib/supabase/client"

export type StoredPattern = {
  projectId: number
  cols: number
  rows: number
  /** One colour code per cell, row by row. */
  cells: string[]
  /** One character per cell: "1" = placed. */
  done: string
  currentRow: number
  /** Thicker guide lines every N cells (0 = none). */
  guideSize: number
  /** Cells before the first guide block; null = automatic. */
  guideColOffset: number | null
  guideRowOffset: number | null
  /** Grid line colour (hex); null = default dark. */
  guideColor: string | null
}

/** Spare cells split between both edges, e.g. 52 cells in blocks of 5 → 1 + 5×10 + 1. */
export function autoGuideOffset(cells: number, size: number) {
  return size > 0 ? Math.floor((cells % size) / 2) : 0
}

const RLS_HINT = "The database did not save it (check that you ran the project_pattern SQL and its RLS policy)."

function fromRow(row: Record<string, unknown>): StoredPattern {
  const cols = Number(row.cols), rows = Number(row.rows)
  const done = String(row.done ?? "")
  return {
    projectId: Number(row.project_id),
    cols,
    rows,
    cells: (row.cells as string[]) ?? [],
    done: done.length === cols * rows ? done : "0".repeat(cols * rows),
    currentRow: Number(row.current_row ?? 0),
    guideSize: row.guide_size == null ? 5 : Number(row.guide_size),
    guideColOffset: row.guide_col_offset == null ? null : Number(row.guide_col_offset),
    guideRowOffset: row.guide_row_offset == null ? null : Number(row.guide_row_offset),
    guideColor: typeof row.guide_color === "string" && row.guide_color ? row.guide_color : null,
  }
}

/** The project's pattern, or null if none has been imported yet. */
export async function getPattern(projectId: number): Promise<StoredPattern | null> {
  const { data, error } = await supabase.from("project_pattern").select("*").eq("project_id", projectId).maybeSingle()
  if (error) {
    // Table not created yet → treat as "no pattern" but say why in the console.
    if (error.code === "42P01" || /does not exist/i.test(error.message)) {
      console.warn("project_pattern table is missing. Run supabase/migrations/20261106_project_pattern.sql")
      return null
    }
    throw new Error(`Could not load the pattern: ${error.message}`)
  }
  return data ? fromRow(data) : null
}

/** Saves (or replaces) the pattern. Progress starts again from zero. */
export async function savePattern(projectId: number, cols: number, rows: number, cells: string[]): Promise<StoredPattern> {
  const { data, error } = await supabase
    .from("project_pattern")
    .upsert({
      project_id: projectId,
      cols,
      rows,
      cells,
      done: "0".repeat(cols * rows),
      current_row: 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "project_id" })
    .select("*")
    .maybeSingle()
  if (error) {
    if (error.code === "42P01" || /does not exist/i.test(error.message))
      throw new Error("The project_pattern table doesn't exist yet. Run supabase/migrations/20261106_project_pattern.sql in the Supabase SQL editor.")
    throw new Error(error.message)
  }
  if (!data) throw new Error(RLS_HINT)
  return fromRow(data)
}

/** Saves bead-mode progress (placed cells and the current row). */
export async function saveProgress(projectId: number, done: string, currentRow: number): Promise<void> {
  const { data, error } = await supabase
    .from("project_pattern")
    .update({ done, current_row: currentRow, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .select("project_id")
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(RLS_HINT)
}

/** Saves the grid-line settings (null offsets = automatic, null colour = default). */
export async function saveGuide(projectId: number, size: number, colOffset: number | null, rowOffset: number | null, color: string | null): Promise<void> {
  const { data, error } = await supabase
    .from("project_pattern")
    .update({ guide_size: size, guide_col_offset: colOffset, guide_row_offset: rowOffset, guide_color: color, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .select("project_id")
    .maybeSingle()
  if (error) {
    if (/guide_/.test(error.message)) throw new Error("Run the updated project_pattern SQL in Supabase to save grid-line settings.")
    throw new Error(error.message)
  }
  if (!data) throw new Error(RLS_HINT)
}

/** Saves a changed grid together with its progress (e.g. after flipping the pattern). */
export async function savePatternCells(projectId: number, cells: string[], done: string): Promise<void> {
  const { data, error } = await supabase
    .from("project_pattern")
    .update({ cells, done, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .select("project_id")
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(RLS_HINT)
}
