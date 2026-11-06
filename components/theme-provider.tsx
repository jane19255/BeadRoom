"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * BeadRoom is designed for light mode only, so the theme is locked to light.
 * (The original template followed the computer's dark-mode setting and switched
 * themes when "D" was pressed, which made the app's background turn black.)
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
