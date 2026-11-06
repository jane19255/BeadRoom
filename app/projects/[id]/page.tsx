"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { LoadingOverlay } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { ProjectDetail } from "@/components/projects/project-detail"
import { useProjects } from "@/components/projects/projects-provider"

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const { projects, loading, error } = useProjects()
  const project = projects.find((item) => String(item.id) === params.id)

  if (loading) return <LoadingOverlay message="Loading your project…" />

  if (!project) {
    return (
      <div className="page flow-page">
        <Link className="back-button" href="/">
          ←   All projects
        </Link>
        <div className="empty-state">
          <Icon name="search" size={24} />
          <strong>{error ? "Couldn't load this project" : "Project not found"}</strong>
          <p>{error ?? "It may have been deleted. Go back to see all your projects."}</p>
        </div>
      </div>
    )
  }

  // key: start fresh (recipe, edit fields) when switching to a different project
  return <ProjectDetail key={project.id} project={project} />
}
