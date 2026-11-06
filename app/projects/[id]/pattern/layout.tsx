import type { Metadata } from "next"

export const metadata: Metadata = { title: "Bead mode" }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
