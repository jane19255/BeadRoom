"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, type ReactNode } from "react"
import { Icon } from "@/components/icon"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { supabase } from "@/lib/supabase/client"

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const onInventory = pathname.startsWith("/inventory")
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" style={{ color: "inherit", textDecoration: "none" }}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>BeadRoom</span>
        </Link>

        <div className="sidebar-section">
          <nav aria-label="Primary navigation">
            <Link
              className={`nav-item ${!onInventory ? "nav-item--active" : ""}`}
              href="/"
              aria-current={!onInventory ? "page" : undefined}
            >
              <Icon name="grid" />
              <span>All projects</span>
            </Link>
            <Link
              className={`nav-item ${onInventory ? "nav-item--active" : ""}`}
              href="/inventory"
              aria-current={onInventory ? "page" : undefined}
            >
              <Icon name="palette" />
              <span>Colour inventory</span>
            </Link>
          </nav>
        </div>

        <div className="sidebar-footer">
          <button className="nav-item nav-item--signout" onClick={() => setConfirmSignOut(true)} title="Sign out" aria-label="Sign out" type="button">
            <Icon name="logout" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <main>{children}</main>

      {confirmSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need your email and password to get back in."
          confirmLabel="Sign out"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => { setConfirmSignOut(false); void supabase.auth.signOut() }}
        />
      )}
    </div>
  )
}
