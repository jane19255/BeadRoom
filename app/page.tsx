"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { LoadingOverlay } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { CategoryManager } from "@/components/projects/category-manager"
import { useProjects } from "@/components/projects/projects-provider"
import { keyOf } from "@/lib/beads"
import type { Project } from "@/lib/types"

export default function ProjectsPage() {
  const router = useRouter()
  const {
    projects, loading: projectsLoading, error: projectsError, categoryItems,
    statusFilter, setStatusFilter, query, setQuery, category, setCategory,
    view, setView, selectedKeys, setSelectedKeys, notice, setNotice, setStockCheck,
    deleteProject,
  } = useProjects()
  const [showCategories, setShowCategories] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)

  const filtered = useMemo(
    () =>
      projects.filter((project) => {
        const matchesQuery = project.name.toLowerCase().includes(query.toLowerCase())
        const matchesCategory = category === "All categories" || project.category === category
        const matchesStatus = statusFilter === "All projects" || project.status === statusFilter
        return matchesQuery && matchesCategory && matchesStatus
      }),
    [query, category, projects, statusFilter],
  )

  const selectedProjects = projects.filter(
    (project) => project.status !== "Completed" && selectedKeys.includes(keyOf(project)),
  )
  const selectableFiltered = filtered.filter((project) => project.status !== "Completed")
  const allVisibleSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((project) => selectedKeys.includes(keyOf(project)))

  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <h1>All projects</h1>
          <p>
            A home for your bead ideas, from the first bead to the final
            press.
          </p>
        </div>
        <div className="page-heading__actions">
          <Link className="outline-button" href="/projects/new/draw">
            <Icon name="grid" />
            Draw pattern
          </Link>
          <Link className="primary-button" href="/projects/new">
            <Icon name="plus" />
            New project
          </Link>
        </div>
      </section>

      <section className="toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            aria-label="Search projects"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects..."
            value={query}
          />
        </label>
        <label className="select-field">
          <select
            aria-label="Filter by category"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option>All categories</option>
            {categoryItems.map((item) => <option key={item.id ?? item.label}>{item.label}</option>)}
          </select>
          <Icon name="chevron" size={14} />
        </label>
        <span className="results-count">
          Showing {filtered.length} of {projects.length} projects
        </span>
        <button
          className="manage-button"
          onClick={() => setShowCategories(true)}
        >
          Manage categories
        </button>
      </section>

      {projectsError && <p className="form-error" role="alert">{projectsError}</p>}
      {projectsLoading && <LoadingOverlay message="Loading your projects…" />}
      <div className="project-subnav">
        <div>
          {([
            "All projects",
            "Not started",
            "On-going",
            "Completed",
          ] as const).map((status) => (
            <button
              className={`tab ${statusFilter === status ? "tab--active" : ""
                }`}
              key={status}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="project-tools">
          <button
            className="select-all-button"
            disabled={!selectableFiltered.length}
            onClick={() => {
              setSelectedKeys((current) =>
                allVisibleSelected
                  ? current.filter(
                    (key) =>
                      !selectableFiltered.some(
                        (project) => keyOf(project) === key,
                      ),
                  )
                  : Array.from(
                    new Set([
                      ...current,
                      ...selectableFiltered.map(
                        (project) => keyOf(project),
                      ),
                    ]),
                  ),
              )
              setNotice(true)
            }}
          >
            {allVisibleSelected ? "Uncheck all" : "Check all"}
          </button>
          <div className="view-switch" aria-label="View style">
            <button
              aria-label="Grid view"
              className={view === "grid" ? "active" : ""}
              onClick={() => setView("grid")}
            >
              <Icon name="grid" size={14} />
            </button>
            <button
              aria-label="List view"
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              <Icon name="list" size={15} />
            </button>
          </div>
        </div>
      </div>

      {notice && selectedProjects.length > 0 && (
        <div className="stock-banner">
          <span className="stock-banner-icon">
            <Icon name="box" />
          </span>
          <div>
            <strong>
              {selectedProjects.length} projects selected ·{" "}
              {selectedProjects
                .reduce((total, project) => total + project.beads, 0)
                .toLocaleString()}{" "}
              beads
            </strong>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setSelectedKeys([])
              setNotice(false)
            }}
          >
            Clear selection
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setStockCheck({ keys: selectedProjects.map(keyOf), back: { href: "/", label: "Back to projects" } })
              setSelectedKeys([]) // don't leave projects ticked when coming back
              router.push("/stock")
            }}
          >
            <Icon name="check" />
            Check combined stock
          </button>
        </div>
      )}

      {filtered.length ? (
        <section
          className={`project-grid project-grid--${view}`}
          aria-label="Projects"
        >
          {filtered.map((project, index) => (
            <article
              className={`project-card ${selectedKeys.includes(keyOf(project))
                ? "project-card--selected"
                : ""
                } ${project.status === "Completed"
                  ? "project-card--completed"
                  : ""
                }`}
              key={project.id ?? project.name}
              onClick={() => {
                if (!project.id) return
                router.push(`/projects/${project.id}`) // completed projects open view only
              }}
            >
              <div className={`art-panel art-panel--${project.pattern}`}>
                {project.status !== "Completed" && (
                  <label
                    className="project-check"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      checked={selectedKeys.includes(keyOf(project))}
                      onChange={() => {
                        setNotice(true)
                        setSelectedKeys((current) =>
                          current.includes(keyOf(project))
                            ? current.filter(
                              (key) => key !== keyOf(project),
                            )
                            : [...current, keyOf(project)],
                        )
                      }}
                      onClick={(event) => event.stopPropagation()}
                      type="checkbox"
                    />
                    <span>
                      <Icon name="check" size={11} />
                    </span>
                  </label>
                )}
                <button
                  className="more-button"
                  aria-label={`More options for ${project.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setPendingDelete(project)
                  }}
                >
                  <Icon name="close" />
                </button>
                {project.thumb || project.image ? (
                  <img
                    className="project-uploaded-image"
                    alt=""
                    loading="lazy"
                    src={project.thumb ?? project.image}
                  />
                ) : project.hasImage ? (
                  <div className="project-image-placeholder" aria-label="Picture loading">
                    <span className="spinner" />
                    <span>Loading picture…</span>
                  </div>
                ) : (
                  <div className="project-image-placeholder" aria-label="No project image uploaded">
                    <Icon name="palette" size={28} />
                    <span>No image</span>
                  </div>
                )}
              </div>
              <div className="card-body">
                <div className="card-kicker">
                  <span>{project.category}</span>
                  <span
                    className={`status status--${project.status.toLowerCase().replace(/ /g, "-")}`}
                  >
                    {project.status}
                  </span>
                </div>
                <h2>{project.name}</h2>
                <p>{project.beads} beads</p>
              </div>
            </article>
          ))}
        </section>
      ) : !projectsLoading && !projectsError ? (
        <div className="empty-state">
          <Icon name="search" size={24} />
          <strong>No projects found</strong>
          <p>Try another search or choose a different category.</p>
        </div>
      ) : null}

      {showCategories && <CategoryManager onClose={() => setShowCategories(false)} />}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={`Delete “${pendingDelete.name}”? This cannot be undone.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void deleteProject(pendingDelete)
            setPendingDelete(null)
          }}
        />
      )}
    </div>
  )
}
