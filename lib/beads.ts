import type { Project, ProjectStatus, RecipeRow } from "@/lib/types"

// Turns "D4;836,C7;229,..." into recipe rows by matching each code to the colour table.
export function parseRecipeText(text: string, palette: RecipeRow[]) {
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

// Natural order: letters first (A, B, C...), then the number as a number (A1, A2, A10).
export function compareCodes(a: string | null | undefined, b: string | null | undefined) {
  const pa = splitCode(a ?? "")
  const pb = splitCode(b ?? "")
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix)
  const na = parseInt(pa.number, 10)
  const nb = parseInt(pb.number, 10)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return pa.number.localeCompare(pb.number, undefined, { numeric: true })
}

export function splitCode(code: string) {
  const m = code.match(/^([A-Za-z]+)(.*)$/);
  return { prefix: m?.[1] ?? "", number: m?.[2] ?? "" };
}

/** Key used to track selected projects (id once saved, name before). */
export const keyOf = (project: Project) => project.id ?? project.name

export const totalBeads = (recipe: RecipeRow[]) => recipe.reduce((total, row) => total + row.count, 0)

export function normalizeStatus(raw: string | null): ProjectStatus {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "completed": return "Completed";
    case "ongoing": return "On-going";
    case "not_started":
    default: return "Not started";
  }
}

const DB_STATUS: Record<ProjectStatus, string> = {
  "Not started": "not_started",
  "On-going": "ongoing",
  "Completed": "completed",
};

export function toDbStatus(status: ProjectStatus): string {
  return DB_STATUS[status];
}
