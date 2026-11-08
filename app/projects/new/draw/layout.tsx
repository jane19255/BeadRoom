import type { Metadata } from "next"

export const metadata: Metadata = { title: "Draw a pattern" }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
