import type { Metadata } from "next"

export const metadata: Metadata = { title: "Colour inventory" }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
