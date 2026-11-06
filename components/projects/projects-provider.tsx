"use client"

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import { supabase } from "@/lib/supabase/client"
import { getOrCreateCategoryId, getProjects, saveProjectRecipe } from "@/lib/supabase/data"
import { keyOf, toDbStatus, totalBeads } from "@/lib/beads"
import { errorMessage, toast } from "@/components/feedback"
import type { CategoryItem, Project, ProjectStatus, RecipeRow } from "@/lib/types"

export type StatusFilter = "All projects" | ProjectStatus

const RLS_HINT = "The database did not save the change (check your Supabase RLS policies)."

/**
 * Holds the project list and every action that changes it, shared by all pages.
 * It lives in the root layout, so data loads once and the list's filters,
 * tab and selection are kept while you move between pages.
 */
function useProjectsStore() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryItems, setCategoryItems] = useState<CategoryItem[]>([])

  // Projects page UI state (kept here so it survives navigating away and back)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All projects")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("All categories")
  const [view, setView] = useState<"grid" | "list">("grid")
  const [selectedKeys, setSelectedKeys] = useState<Array<number | string>>([])
  const [notice, setNotice] = useState(true)

  useEffect(() => {
    // true = also pick the default status tab (first load / refresh only)
    void loadProjects(true)
  }, [])

  function patchProject(id: number | undefined, changes: Partial<Project>) {
    setProjects((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)))
  }

  async function loadProjects(applyDefaultTab = false) {
    setLoading(true)
    setError(null)
    try {
      const result = await getProjects()
      setProjects(result.projects)
      setCategoryItems(result.categories)
      // On first load / refresh: open the On-going tab if there is any ongoing project,
      // otherwise the Not started tab, otherwise fall back to All projects.
      if (applyDefaultTab) {
        const hasOngoing = result.projects.some((p) => p.status === "On-going")
        const hasNotStarted = result.projects.some((p) => p.status === "Not started")
        setStatusFilter(hasOngoing ? "On-going" : hasNotStarted ? "Not started" : "All projects")
      }
    } catch (err) {
      console.error(err)
      setError(errorMessage(err, "Failed to load projects."))
      setProjects([])
    } finally {
      setLoading(false)
    }
  }

  /** Returns the saved project (with its new id), or null if it failed. */
  async function createProject(project: Project): Promise<Project | null> {
    try {
      const categoryId = await getOrCreateCategoryId(project.category)
      const { data: row, error } = await supabase.from("project").insert({
        name: project.name,
        category_id: categoryId,
        status: toDbStatus(project.status),
        image_url: project.image || null,
      }).select("id").single()
      if (error) throw error
      const savedProject: Project = { ...project, id: Number(row.id) }
      try {
        await saveProjectRecipe(savedProject.id!, project.recipe ?? [])
      } catch (recipeError) {
        await supabase.from("project").delete().eq("id", savedProject.id)
        throw recipeError
      }
      setProjects((current) => [savedProject, ...current])
      setCategoryItems((current) => current.some((item) => item.label === project.category)
        ? current.map((item) => item.label === project.category ? { ...item, count: item.count + 1 } : item)
        : [...current, { id: categoryId, label: project.category, originalLabel: project.category, count: 1 }])
      toast.success("Project created", { description: project.name })
      return savedProject
    } catch (err) {
      console.error("Failed to save project:", err)
      toast.error("Couldn't create project", { description: errorMessage(err, "Could not save project to Supabase.") })
      return null
    }
  }

  async function deleteProject(project: Project): Promise<boolean> {
    if (!project.id) {
      toast.error("Couldn't delete project", { description: "This project has no Supabase ID." })
      return false
    }
    const { data: deleted, error } = await supabase.from("project").delete().eq("id", project.id).select("id")
    if (error || !deleted?.length) {
      toast.error("Couldn't delete project", { description: error?.message ?? RLS_HINT })
      return false
    }
    setProjects((current) => current.filter((item) => item.id !== project.id))
    setSelectedKeys((current) => current.filter((key) => key !== keyOf(project)))
    toast.success("Project deleted", { description: project.name })
    return true
  }

  async function updateProjectStatus(project: Project, status: ProjectStatus): Promise<boolean> {
    if (!project.id) return false
    const { data: updated, error } = await supabase.from("project")
      .update({ status: toDbStatus(status) }).eq("id", project.id).select("id").maybeSingle()
    if (error || !updated) {
      toast.error("Couldn't update project status", { description: error?.message ?? RLS_HINT })
      return false
    }
    patchProject(project.id, { status })
    if (status === "Completed") setSelectedKeys((current) => current.filter((key) => key !== keyOf(project)))
    toast.success(status === "Completed" ? "Project completed 🎉" : `Project marked ${status}`, {
      description: status === "Completed" ? "Beads used have been taken out of your inventory." : undefined,
    })
    return true
  }

  /** Checks stock, takes the recipe's beads out of inventory, then marks the project completed. */
  async function completeProject(project: Project) {
    if (!project.id || project.status === "Completed") return
    try {
      const { data: recipeRows, error: recipeError } = await supabase
        .from("project_color").select("color_id, quantity").eq("project_id", project.id)
      if (recipeError) throw recipeError

      const needs = (recipeRows ?? [])
        .map((r) => ({ colorId: Number(r.color_id), need: Number(r.quantity ?? 0) }))
        .filter((r) => r.need > 0)

      if (needs.length) {
        const ids = needs.map((n) => n.colorId)
        const [{ data: stockRows, error: stockError }, { data: colorRows, error: colorError }] =
          await Promise.all([
            supabase.from("inventory").select("id, color_id, quantity").in("color_id", ids),
            supabase.from("color").select("id, color_code").in("id", ids),
          ])
        if (stockError) throw stockError
        if (colorError) throw colorError

        type StockRow = { id: number; color_id: number; quantity: number | null }
        const stockByColor = new Map<number, StockRow>(
          (stockRows ?? []).map((s: StockRow) => [Number(s.color_id), s] as [number, StockRow]),
        )
        const codeById = new Map<number, string | null>(
          (colorRows ?? []).map((c: { id: number; color_code: string | null }) => [Number(c.id), c.color_code] as [number, string | null]),
        )

        const short = needs.filter((n) => Number(stockByColor.get(n.colorId)?.quantity ?? 0) < n.need)
        if (short.length) {
          toast.error("Not enough stock to complete this project", {
            description: short.map((n) =>
              `${codeById.get(n.colorId)}: need ${n.need}, have ${Number(stockByColor.get(n.colorId)?.quantity ?? 0)}`,
            ).join("\n"),
          })
          return
        }

        const results = await Promise.all(needs.map((n) => {
          const stock = stockByColor.get(n.colorId)!
          return supabase.from("inventory")
            .update({ quantity: Number(stock.quantity) - n.need }).eq("id", stock.id).select("id")
        }))
        const failed = results.find((r) => r.error || !r.data?.length)
        if (failed) throw failed.error ?? new Error(RLS_HINT)
      }

      await updateProjectStatus(project, "Completed")
    } catch (err) {
      toast.error("Couldn't complete project", { description: errorMessage(err) })
    }
  }

  async function updateProjectDetails(project: Project, name: string, categoryName: string, image: string): Promise<boolean> {
    if (!project.id) return false
    try {
      const categoryId = await getOrCreateCategoryId(categoryName)
      const { data: updated, error } = await supabase.from("project")
        .update({ name, category_id: categoryId, image_url: image || null })
        .eq("id", project.id)
        .select("id")
        .maybeSingle()
      if (error) throw error
      if (!updated) throw new Error(RLS_HINT)
      patchProject(project.id, { name, category: categoryName, image: image || undefined })
      toast.success("Project details saved")
      return true
    } catch (err) {
      toast.error("Couldn't save project details", { description: errorMessage(err, "Could not update project details.") })
      return false
    }
  }

  async function updateProjectRecipe(project: Project, recipe: RecipeRow[]): Promise<boolean> {
    if (!project.id) return false
    try {
      await saveProjectRecipe(project.id, recipe)
      patchProject(project.id, { recipe, beads: totalBeads(recipe) })
      return true
    } catch (err) {
      toast.error("Couldn't save recipe", { description: errorMessage(err, "Could not save recipe.") })
      return false
    }
  }

  async function saveCategoryChanges(): Promise<boolean> {
    try {
      for (const item of categoryItems) {
        if (!item.id) continue
        const name = item.label.trim()
        if (!name) throw new Error("Category names cannot be empty.")
        if (name !== item.originalLabel) {
          const { error } = await supabase.from("category").update({ name }).eq("id", item.id)
          if (error) throw error
        }
      }
      setCategoryItems((current) => current.map((item) => ({ ...item, originalLabel: item.label.trim() })))
      await loadProjects()
      toast.success("Categories saved")
      return true
    } catch (err) {
      toast.error("Couldn't save categories", { description: errorMessage(err) })
      return false
    }
  }

  async function addCategory() {
    const name = `New category ${categoryItems.length + 1}`
    try {
      const { data, error } = await supabase.from("category").insert({ name }).select("id").single()
      if (error) throw error
      setCategoryItems((current) => [...current, { id: Number(data.id), label: name, originalLabel: name, count: 0 }])
    } catch (err) {
      toast.error("Couldn't add category", { description: errorMessage(err) })
    }
  }

  async function deleteCategory(item: CategoryItem, index: number) {
    if (item.id) {
      const { error } = await supabase.from("category").delete().eq("id", item.id)
      if (error) {
        toast.error("Couldn't delete category", { description: error.message })
        return
      }
      toast.success("Category deleted", { description: item.label })
    }
    setCategoryItems((current) => current.filter((_, categoryIndex) => categoryIndex !== index))
    await loadProjects()
  }

  return {
    projects, loading, error, loadProjects,
    categoryItems, setCategoryItems: setCategoryItems as Dispatch<SetStateAction<CategoryItem[]>>,
    statusFilter, setStatusFilter, query, setQuery, category, setCategory,
    view, setView, selectedKeys, setSelectedKeys, notice, setNotice,
    createProject, deleteProject, updateProjectStatus, completeProject,
    updateProjectDetails, updateProjectRecipe,
    saveCategoryChanges, addCategory, deleteCategory,
  }
}

type ProjectsStore = ReturnType<typeof useProjectsStore>

const ProjectsContext = createContext<ProjectsStore | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const store = useProjectsStore()
  return <ProjectsContext.Provider value={store}>{children}</ProjectsContext.Provider>
}

export function useProjects() {
  const store = useContext(ProjectsContext)
  if (!store) throw new Error("useProjects must be used inside <ProjectsProvider>")
  return store
}
