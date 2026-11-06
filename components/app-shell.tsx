"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import { Icon } from "@/components/icon"

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const onInventory = pathname.startsWith("/inventory")

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
      </aside>

      <main>{children}</main>
    </div>
  )
}
