# BeadRoom

Plan bead projects, keep bead recipes and track your colour inventory.
Built with Next.js (App Router), React and Supabase.

## Getting started

```bash
npm install
npm run dev
```

Create `.env.local` with your Supabase details:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Pages

| URL | What it shows |
| --- | --- |
| `/` | All projects (search, filter, select for a stock check) |
| `/projects/new` | Create a project |
| `/projects/[id]` | Project details and bead recipe |
| `/inventory` | Colour inventory |
| `/stock` | Combined stock check for the selected projects |
| `/projects/[id]/pattern/import` | Import a bead pattern from a screenshot |
| `/projects/[id]/pattern` | Bead mode: follow the grid, highlight a colour, mark rows done |

## Bead patterns (one-time setup)

Run `supabase/migrations/20261106_project_pattern.sql` in the Supabase SQL editor.
It creates the `project_pattern` table that stores each project's grid and your progress.

How importing works: BeadRoom reads each cell's **colour** (not the printed codes), matches it to the
project's recipe colours, and uses the recipe's bead counts to correct unsure cells. Cells it is less sure
about are outlined in red for you to check. If two similar colours get mixed up everywhere, use **Pick**
next to the colour and tap that colour on the screenshot.

## Project structure

```
app/
  layout.tsx              Root layout: fonts, sidebar shell, shared project data, toasts
  page.tsx                All projects
  projects/new/page.tsx   New project form
  projects/[id]/page.tsx  Project details (loads the project from the URL id)
  projects/[id]/pattern/          Bead mode, and import/ for screenshot import
  inventory/page.tsx      Colour inventory
  stock/page.tsx          Stock check
  manifest.ts             Web app manifest (install as an app)
  icon.svg                Browser tab icon
  apple-icon.png          iPhone / iPad home-screen icon
  globals.css             Tailwind + theme variables
  beadroom.css            BeadRoom styles

components/
  app-shell.tsx           Sidebar + main area
  feedback.tsx            Loading overlay, spinner and toast messages
  icon.tsx                Inline SVG icons
  confirm-dialog.tsx      "Are you sure?" dialog
  theme-provider.tsx      Light/dark theme (press "d" to toggle)
  projects/
    projects-provider.tsx Shared project list + all project/category actions
    project-detail.tsx    Project details screen
    recipe-import.tsx     Quick fill recipe from "D4;836,C7;229"
    category-manager.tsx  Manage categories dialog

  pattern/
    grid-canvas.tsx       Zoomable pattern grid (pinch, drag, tap)
    grid-aligner.tsx      Screenshot with the grid overlay and draggable corners

lib/
  pattern/decode.ts       Reads a pattern grid from screenshot pixels
  pattern/store.ts        Saves patterns and progress to Supabase
  types.ts                Project, RecipeRow, CategoryItem types
  beads.ts                Bead code helpers (sorting, parsing, status mapping)
  supabase/client.ts      Supabase client
  supabase/data.ts        Supabase reads and writes

public/icons/             App icons used by the manifest
```
