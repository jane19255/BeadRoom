"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { LoadingOverlay } from "@/components/feedback"
import { useProjects } from "@/components/projects/projects-provider"
import { compareCodes, keyOf } from "@/lib/beads"
import { supabase } from "@/lib/supabase/client"

export default function StockCheckPage() {
  const { projects: allProjects, selectedKeys, loading: projectsLoading } = useProjects()
  // Selected (not completed) projects; if none are selected, check the first project.
  const projects = useMemo(() => {
    const selected = allProjects.filter(
      (project) => project.status !== "Completed" && selectedKeys.includes(keyOf(project)),
    )
    return selected.length ? selected : allProjects.slice(0, 1)
  }, [allProjects, selectedKeys])
  const [stockRows, setStockRows] = useState<{ code: string; colour: string; need: number; stock: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const required = projects.reduce((total, project) => total + project.beads, 0);
  const sufficient = stockRows.length > 0 && stockRows.every((row) => row.stock >= row.need);

  useEffect(() => {
    let cancelled = false;
    async function loadStockCheck() {
      try {
        setLoading(true);
        setError(null);
        const { data: colors, error: colorError } = await supabase
          .from("color").select("id, color_code, hex_code");
        if (colorError) throw colorError;
        const { data: inventory, error: inventoryError } = await supabase
          .from("inventory").select("color_id, quantity");
        if (inventoryError) throw inventoryError;
        const requirements = new Map<string, number>();
        projects.forEach((project) => (project.recipe ?? []).forEach((row) =>
          requirements.set(row.code, (requirements.get(row.code) ?? 0) + row.count)));
        const result = Array.from(requirements.entries()).map(([code, need]) => {
          const color = (colors ?? []).find((item) => item.color_code === code);
          const stockRow = (inventory ?? []).find((item) => item.color_id === color?.id);
          return { code, colour: color?.hex_code ?? "#cccccc", need, stock: Number(stockRow?.quantity ?? 0) };
        }).sort((a, b) => {
          // Colours that are short on stock come first, then natural code order.
          const aShort = a.stock < a.need ? 0 : 1;
          const bShort = b.stock < b.need ? 0 : 1;
          return aShort - bShort || compareCodes(a.code, b.code);
        });
        if (!cancelled) setStockRows(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not check stock.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadStockCheck();
    return () => { cancelled = true; };
  }, [projects]);

  const shortages = stockRows.filter((row) => row.stock < row.need);
  if (projectsLoading) return <LoadingOverlay message="Loading your projects…" />;
  return (
    <div className="page flow-page">
      <Link className="back-button" href="/">← Back to projects</Link>
      <section className="page-heading"><div><h1>A stock check, before you start.</h1><p>Requirements are calculated from the selected projects and compared with live Supabase inventory.</p></div></section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={`check-result ${!loading && !error && sufficient ? "check-result--good" : "check-result--short"}`}>
        <div><strong>{loading ? "Checking stock…" : error ? "Stock check failed." : sufficient ? "Sufficient — your selected projects are ready." : "Insufficient stock for some colours."}</strong>
          <p>{loading ? "Reading colour inventory from Supabase." : error ? error : sufficient ? "Every required colour has enough stock." : shortages.map((row) => `${row.code}: ${row.need - row.stock} short`).join(" · ")}</p>
        </div>
      </div>
      <div className="stock-layout"><section className="detail-card">
        <div className="section-heading"><div><h2>Combined colour requirements</h2><p>{projects.length} selected projects · {required.toLocaleString()} total beads</p></div></div>
        {loading ? <p>Loading stock…</p> : stockRows.length ? stockRows.map((row) => (
          <div className={`stock-row ${row.stock < row.need ? "stock-row--short" : ""}`} key={row.code}>
            <strong>{row.code}</strong><span className="colour-dot" style={{ backgroundColor: row.colour }} />
            <span>{row.need.toLocaleString()} required</span><span>{row.stock.toLocaleString()} in stock</span>
            <strong>{row.stock >= row.need ? "✓" : `${(row.need - row.stock).toLocaleString()} short`}</strong>
          </div>
        )) : !error && <p>No recipe colours are saved for the selected projects.</p>}
      </section></div>
    </div>
  );
}
