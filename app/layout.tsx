import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import "./beadroom.css"
import { AppShell } from "@/components/app-shell"
import { Toaster } from "@/components/feedback"
import { ProjectsProvider } from "@/components/projects/projects-provider"
import { ThemeProvider } from "@/components/theme-provider"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "BeadRoom",
    template: "%s · BeadRoom",
  },
  description: "Plan bead projects, keep bead recipes and track your colour inventory.",
  applicationName: "BeadRoom",
  appleWebApp: {
    capable: true,
    title: "BeadRoom",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  themeColor: "#405d43",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`antialiased font-sans ${fontMono.variable} ${geist.variable}`}
    >
      <body>
        <ThemeProvider>
          <ProjectsProvider>
            <AppShell>{children}</AppShell>
          </ProjectsProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
