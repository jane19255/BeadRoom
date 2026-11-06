"use client"

import { Icon } from "@/components/icon"

export function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
  confirmLabel = "Delete",
  confirmClassName = "danger-button",
}: {
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  confirmClassName?: string
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close"
          onClick={onCancel}
          type="button"
        >
          <Icon name="close" />
        </button>
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="outline-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={confirmClassName} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
