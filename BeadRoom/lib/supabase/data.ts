import { supabase } from "@/lib/supabase/client";

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
