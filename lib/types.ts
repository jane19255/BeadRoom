export type ProjectStatus = "Not started" | "On-going" | "Completed"

export type RecipeRow = {
  code: string
  count: number
  colour: string
  colorId?: number
}

export type Project = {
  id?: number
  name: string
  category: string
  pattern: string
  status: ProjectStatus
  beads: number
  image?: string
  recipe?: RecipeRow[]
}

export type CategoryItem = {
  id?: number
  label: string
  count: number
  originalLabel?: string
}
