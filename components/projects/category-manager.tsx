"use client"

import { useState } from "react"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Spinner } from "@/components/feedback"
import { Icon } from "@/components/icon"
import { useProjects } from "@/components/projects/projects-provider"
import type { CategoryItem } from "@/lib/types"

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { categoryItems, setCategoryItems, addCategory, deleteCategory, saveCategoryChanges } = useProjects()
  const [pendingDelete, setPendingDelete] = useState<{ item: CategoryItem; index: number } | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const ok = await saveCategoryChanges()
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <>
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal category-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
        <h2 id="category-title">Manage categories</h2>
        <p>Organise project categories and add a new place for your ideas.</p>
        <div className="category-modal-list">
          {categoryItems.map((item, index) => (
            <div key={item.id ?? `${item.label}-${index}`}>
              <input
                aria-label="Category name"
                onChange={(event) =>
                  setCategoryItems((current) =>
                    current.map((category, categoryIndex) =>
                      categoryIndex === index ? { ...category, label: event.target.value } : category,
                    ),
                  )
                }
                value={item.label}
              />
              <span>{item.count} projects</span>
              <button aria-label={`Delete ${item.label}`} onClick={() => setPendingDelete({ item, index })}>
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="outline-button" onClick={() => { void addCategory() }}>
          <Icon name="plus" /> Add category
        </button>
        <div className="modal-actions">
          <button className="primary-button" disabled={saving} onClick={() => { void save() }}>
            {saving ? <><Spinner /> Saving…</> : "Save categories"}
          </button>
        </div>
      </section>
    </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete category?"
          message={`Delete the “${pendingDelete.item.label}” category? Projects will keep their current category label.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void deleteCategory(pendingDelete.item, pendingDelete.index)
            setPendingDelete(null)
          }}
        />
      )}
    </>
  )
}
