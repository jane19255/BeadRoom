import type { Project, ProjectStatus, RecipeRow } from "@/lib/types"

/**
 * Reads colour codes and bead counts from pasted text, in almost any layout:
 *   "D4;836,C7;229"                       (the original format)
 *   "C28 877 A25 467 C7 303"              (copied from a picture with Live Text / Google Lens)
 *   "C28\n877\nA25\n467"                  (one item per line)
 *   "C28 A25 C7\n877 467 303"             (all codes first, then all counts)
 * Each count goes to the oldest code still waiting for one. Common copy-from-picture slips
 * are fixed (letter O for zero, l or I for one), and codes are matched ignoring case and
 * leading zeros ("c 07" = "C7").
 */
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

  // Digits that a picture-to-text tool may read as letters.
  const fixDigits = (s: string) => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1")

  // Split into words: letters+digits stay together, everything else separates.
  const words = text
    .replace(/[；;，,、:：=|×]/g, " ")
    .split(/\s+/)
    .flatMap((w) => w.match(/[A-Za-z]+[\dOoIl|]*|\d[\dOoIl|]*/g) ?? [])

  type Token = { kind: "code"; value: string } | { kind: "count"; value: number }
  const tokens: Token[] = []
  for (let k = 0; k < words.length; k++) {
    const w = words[k]
    const code = w.match(/^([A-Za-z]{1,3})([\dOoIl|]{1,3})$/)
    if (code && /\d/.test(code[2] + "0")) {
      const fixed = norm(code[1] + fixDigits(code[2]))
      // Not a real colour but reads as a number once slips are fixed ("l9" = 19)? Then it's a count.
      const looksLikeCount = !byCode.has(fixed) && /^\d+$/.test(fixDigits(w))
      if (/^[A-Z]+\d+$/.test(fixed) && !looksLikeCount) { tokens.push({ kind: "code", value: fixed }); continue }
    }
    // A code split in two ("C" "28"): only joined if that makes a real colour code.
    if (/^[A-Za-z]{1,3}$/.test(w) && k + 1 < words.length && /^\d{1,3}$/.test(words[k + 1]) && byCode.has(norm(w + words[k + 1]))) {
      tokens.push({ kind: "code", value: norm(w + words[k + 1])})
      k++
      continue
    }
    const digits = fixDigits(w)
    if (/^\d+$/.test(digits) && /\d/.test(w)) { tokens.push({ kind: "count", value: Number(digits) }); continue }
    if (!/^[xX]$/.test(w)) invalid.push(w) // "x" as in "D4 x 836" is just a separator
  }

  const waiting: string[] = []
  for (const token of tokens) {
    if (token.kind === "code") { waiting.push(token.value); continue }
    const key = waiting.shift()
    if (key === undefined) { invalid.push(String(token.value)); continue }
    const option = byCode.get(key)
    if (!option) { unknown.push(key); continue }
    const existing = merged.get(key)
    if (existing) existing.count += token.value
    else merged.set(key, { ...option, count: token.value })
  }
  for (const key of waiting) invalid.push(`${key} (no count)`)
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
