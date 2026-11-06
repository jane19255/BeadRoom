import { supabase } from "@/lib/supabase/client";
import { compareCodes, normalizeStatus, totalBeads } from "@/lib/beads";
import type { CategoryItem, Project, RecipeRow } from "@/lib/types";

export type ColorInventoryRow = {
  id: number;
  group: string | null;
  code: string | null;
  hex: string | null;
  quantity: number;
};

export async function getColorsAndInventory(): Promise<ColorInventoryRow[]> {
  const [{ data: colors, error: colorsError }, { data: inventory, error: inventoryError }] =
    await Promise.all([
      supabase.from("color").select("id, letter_group, color_code, hex_code").order("color_code"),
      supabase.from("inventory").select("id, color_id, quantity"),
    ]);

  if (colorsError) throw new Error(`Failed to load colours: ${colorsError.message}`);
  if (inventoryError) throw new Error(`Failed to load inventory: ${inventoryError.message}`);

  const inventoryByColorId = new Map<number, number>();
  for (const row of inventory ?? []) {
    inventoryByColorId.set(Number(row.color_id), Number(row.quantity ?? 0));
  }

  return (colors ?? []).map((color) => ({
    id: Number(color.id),
    group: color.letter_group ?? null,
    code: color.color_code ?? null,
    hex: color.hex_code ?? null,
    quantity: inventoryByColorId.get(Number(color.id)) ?? 0,
  }));
}

/** All colours as recipe options (code + swatch), in natural code order. */
export async function getPalette(): Promise<RecipeRow[]> {
  const { data, error } = await supabase.from("color").select("id, color_code, hex_code").order("color_code");
  if (error) throw new Error(`Could not load colour palette: ${error.message}`);
  return (data ?? [])
    .map((row) => ({ code: row.color_code as string, colour: row.hex_code ?? "#cccccc", count: 0, colorId: Number(row.id) }))
    .sort((a, b) => compareCodes(a.code, b.code));
}

export async function getCategoryNames(): Promise<string[]> {
  const { data, error } = await supabase.from("category").select("name").order("name");
  if (error) throw new Error(`Could not load categories: ${error.message}`);
  return (data ?? []).map((row) => row.name as string);
}

/** project_color can exceed Supabase's 1000-row limit, so read it page by page. */
export async function fetchAllProjectColors() {
  const pageSize = 1000;
  const all: { project_id: number; color_id: number; quantity: number | null }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("project_color")
      .select("project_id, color_id, quantity")
      .order("project_id")
      .order("color_id")
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return { data: all, error: null };
}

// Columns for the project list. Deliberately NOT image_url: full pictures are big, and loading
// all of them at once made this query time out. Cards use the small image_thumb instead.
const PROJECT_LIST_COLUMNS = "id, name, category_id, status, created_at"

type ProjectListRow = {
  id: number
  name: string | null
  category_id: number | null
  status: string | null
  created_at: string | null
  image_thumb?: string | null
}

type ProjectListResult = { data: ProjectListRow[] | null; error: { message: string } | null }

/** Project rows for the list, with a thumbnail if the image_thumb column exists. */
async function getProjectRows(): Promise<ProjectListResult> {
  const withThumb: ProjectListResult = await supabase
    .from("project")
    .select(`${PROJECT_LIST_COLUMNS}, image_thumb`)
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
  if (!withThumb.error || !/image_thumb/.test(withThumb.error.message)) return withThumb
  // image_thumb column not created yet: still load the list, just without thumbnails.
  console.warn("project.image_thumb column is missing. Run supabase/migrations/20261106_project_thumbnails.sql")
  const withoutThumb: ProjectListResult = await supabase
    .from("project")
    .select(PROJECT_LIST_COLUMNS)
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
  return withoutThumb
}

/** The full picture of one project (or undefined if it has none). */
export async function getProjectImage(projectId: number): Promise<string | undefined> {
  const { data, error } = await supabase.from("project").select("image_url").eq("id", projectId).maybeSingle()
  if (error) throw new Error(`Could not load the picture: ${error.message}`)
  return data?.image_url ?? undefined
}

/** Saves a project's thumbnail. Returns false if the image_thumb column doesn't exist yet. */
export async function saveProjectThumb(projectId: number, thumb: string): Promise<boolean> {
  const { error } = await supabase.from("project").update({ image_thumb: thumb }).eq("id", projectId)
  if (error && /image_thumb/.test(error.message)) return false
  if (error) throw new Error(error.message)
  return true
}

/** Loads every project with its category name and recipe. */
export async function getProjects(): Promise<{ projects: Project[]; categories: CategoryItem[] }> {
  // These requests don't depend on each other, so fetch them all at once.
  const [
    { data: projectRows, error: projectError },
    { data: categoryRows, error: categoryError },
    { data: recipeRows, error: recipeError },
    { data: colorRows, error: colorError },
  ] = await Promise.all([
    // Newest first. Projects with no created_at go last (Postgres puts empty values FIRST
    // when sorting newest-first), and id breaks ties between same-time projects.
    getProjectRows(),
    supabase.from("category").select("*"),
    fetchAllProjectColors(),
    supabase.from("color").select("id, color_code, hex_code"),
  ]);
  // Which projects have a picture (cheap: checks for "empty" without downloading the picture).
  const { data: withImage } = await supabase.from("project").select("id").not("image_url", "is", null)
  const hasImage = new Set((withImage ?? []).map((row: { id: number }) => Number(row.id)))

  const loadError = projectError ?? categoryError ?? recipeError ?? colorError;
  if (loadError) throw new Error(`Failed to load projects from Supabase: ${loadError.message}`);

  type ColorRow = { id: number; color_code: string | null; hex_code: string | null };
  type CategoryRow = { id: number; name: string };
  const colorById = new Map<number, ColorRow>((colorRows ?? []).map((color: ColorRow) => [color.id, color]));
  const categoryById = new Map<number, CategoryRow>((categoryRows ?? []).map((category: CategoryRow) => [category.id, category]));

  const projects: Project[] = (projectRows ?? []).map((row) => {
    const recipe: RecipeRow[] = (recipeRows ?? [])
      .filter((item) => item.project_id === row.id)
      .map((item) => {
        const color = colorById.get(item.color_id);
        return {
          code: color?.color_code ?? "",
          colour: color?.hex_code ?? "#cccccc",
          count: Number(item.quantity ?? 0),
          colorId: Number(item.color_id),
        };
      });
    return {
      id: Number(row.id),
      name: row.name ?? "Untitled project",
      category: (row.category_id == null ? undefined : categoryById.get(row.category_id))?.name ?? "Uncategorised",
      pattern: "default",
      status: normalizeStatus(row.status),
      beads: totalBeads(recipe),
      thumb: row.image_thumb ?? undefined,
      hasImage: hasImage.has(Number(row.id)),
      recipe,
    };
  });

  const categories: CategoryItem[] = (categoryRows ?? []).map((item) => ({
    id: Number(item.id),
    label: item.name,
    originalLabel: item.name,
    count: (projectRows ?? []).filter((project) => project.category_id === item.id).length,
  }));

  return { projects, categories };
}

export async function getOrCreateCategoryId(categoryName: string): Promise<number> {
  const { data: found, error: findError } = await supabase
    .from("category").select("id").eq("name", categoryName).maybeSingle();
  if (findError) throw findError;
  if (found) return Number(found.id);
  const { data: created, error: createError } = await supabase
    .from("category").insert({ name: categoryName }).select("id").single();
  if (createError) throw createError;
  return Number(created.id);
}

/** Saves a project recipe: upserts current colours and removes ones no longer in it. */
export async function saveProjectRecipe(projectId: number, recipe: RecipeRow[]) {
  // Compare codes ignoring leading zeros and case, so "A02" and "A2" match.
  const norm = (code: string) => {
    const m = code.trim().toUpperCase().match(/^([A-Z]+)0*(\d+)$/);
    return m ? `${m[1]}${m[2]}` : code.trim().toUpperCase();
  };

  // Rows that already carry a colour id need no lookup; only the rest are matched by code.
  const idByCode = new Map<string, number>();
  if (recipe.some((item) => item.colorId == null)) {
    const { data: colors, error: colorsError } = await supabase.from("color").select("id, color_code");
    if (colorsError) throw colorsError;
    for (const c of colors ?? []) idByCode.set(norm(c.color_code ?? ""), Number(c.id));
  }

  const missing: string[] = [];
  const countByColorId = new Map<number, number>();
  for (const item of recipe) {
    const colorId = item.colorId ?? idByCode.get(norm(item.code));
    if (colorId == null) { missing.push(item.code); continue; }
    countByColorId.set(colorId, (countByColorId.get(colorId) ?? 0) + item.count);
  }
  if (missing.length) throw new Error(`These recipe colours are missing from Supabase: ${missing.join(", ")}. Add them in Colour inventory first.`);

  const rows = [...countByColorId].map(([color_id, quantity]) => ({
    project_id: projectId,
    color_id,
    quantity,
  }));

  if (rows.length) {
    const { data: written, error: upsertError } = await supabase
      .from("project_color").upsert(rows, { onConflict: "project_id,color_id" }).select("color_id");
    if (upsertError) throw upsertError;
    if ((written ?? []).length !== rows.length)
      throw new Error("The database did not save every recipe colour (check your Supabase RLS policies).");
  }

  let removal = supabase.from("project_color").delete().eq("project_id", projectId);
  if (rows.length) removal = removal.not("color_id", "in", `(${rows.map((r) => r.color_id).join(",")})`);
  const { error: deleteError } = await removal;
  if (deleteError) throw deleteError;
}
