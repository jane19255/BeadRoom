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
  /** Full picture; loaded only when the project is opened (see loadProjectImage). */
  image?: string
  /** Small picture for project cards. */
  thumb?: string
  /** Whether the project has a picture saved (even if it isn't loaded yet). */
  hasImage?: boolean
  recipe?: RecipeRow[]
}

export type CategoryItem = {
  id?: number
  label: string
  count: number
  originalLabel?: string
}
