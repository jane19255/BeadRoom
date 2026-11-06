"use client"

import { useEffect, useState } from "react"

/* ------------------------------------------------------------------ */
/* Loading overlay: dimmed background + spinning circle + message      */
/* ------------------------------------------------------------------ */

export function LoadingOverlay({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="loading-overlay" role="alert" aria-busy="true" aria-live="polite">
      <div className="loading-overlay__card">
        <span className="spinner spinner--lg" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

/* ------------------------------------------------------------------ */
/* Toasts: small pop-up messages in the corner.                        */
/* Call toast.success(...) / toast.error(...) from anywhere and put    */
/* <Toaster /> once in the app.                                        */
/* ------------------------------------------------------------------ */

type ToastKind = "success" | "error" | "loading"
type ToastItem = { id: number; kind: ToastKind; title: string; description?: string }
type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()
const timers = new Map<number, number>()

function emit() {
  for (const listener of listeners) listener(items)
}

function dismiss(id: number) {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  items = items.filter((item) => item.id !== id)
  emit()
}

function show(kind: ToastKind, title: string, options: { description?: string; id?: number } = {}) {
  const id = options.id ?? nextId++
  const item: ToastItem = { id, kind, title, description: options.description }
  items = items.some((t) => t.id === id)
    ? items.map((t) => (t.id === id ? item : t))
    : [...items, item].slice(-4)
  emit()
  window.clearTimeout(timers.get(id))
  // Loading toasts stay until replaced; errors stay longer so they can be read.
  if (kind !== "loading") {
    timers.set(id, window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 2500))
  }
  return id
}

export const toast = {
  success: (title: string, options?: { description?: string; id?: number }) => show("success", title, options),
  error: (title: string, options?: { description?: string; id?: number }) => show("error", title, options),
  loading: (title: string, options?: { description?: string; id?: number }) => show("loading", title, options),
  dismiss,
}

export function errorMessage(err: unknown, fallback = "Something went wrong.") {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message)
  return fallback
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items)
  useEffect(() => {
    listeners.add(setList)
    return () => { listeners.delete(setList) }
  }, [])

  return (
    <div className="toaster" aria-live="polite">
      {list.map((item) => (
        <div className={`toast toast--${item.kind}`} key={item.id} role={item.kind === "error" ? "alert" : "status"}>
          <span className="toast__icon" aria-hidden="true">
            {item.kind === "loading" ? <span className="spinner" /> : item.kind === "success" ? "✓" : "!"}
          </span>
          <div className="toast__body">
            <strong>{item.title}</strong>
            {item.description && <p>{item.description}</p>}
          </div>
          {item.kind !== "loading" && (
            <button className="toast__close" aria-label="Dismiss" onClick={() => dismiss(item.id)}>×</button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Autosave status: "Unsaved changes" → "Saving…" → "✓ All changes    */
/* saved", or "Not saved · Retry" if something failed.                 */
/* ------------------------------------------------------------------ */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error"

export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  if (state === "idle") return null
  return (
    <span className={`save-status save-status--${state}`} role="status">
      {state === "pending" && "Unsaved changes"}
      {state === "saving" && <><Spinner /> Saving…</>}
      {state === "saved" && "✓ All changes saved"}
      {state === "error" && (
        <>
          Not saved
          {onRetry && (
            <>
              {" · "}
              <button className="save-status__retry" onClick={onRetry} type="button">Retry</button>
            </>
          )}
        </>
      )}
    </span>
  )
}

/** Warn before closing or refreshing the tab while `active` is true. */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [active])
}
