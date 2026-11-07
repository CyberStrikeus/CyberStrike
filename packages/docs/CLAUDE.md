# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Documentation site for CyberStrike (AI-powered penetration testing agent) at docs.cyberstrike.io. Built with Astro v5, Tailwind CSS v4, and MDX content.

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Dev server at localhost:4322
bun run build            # Full production build (clears .astro cache, fetches changelog from GitHub, runs astro build + pagefind)
bun run preview          # Preview production build
bun run lint             # ESLint
bun run format           # ESLint fix + Prettier
```

After a fresh build, copy pagefind index for dev search: `bun run osxsearch` (copies `dist/pagefind` → `public/pagefind`).

## Architecture

### Content System

Documentation is MDX files in `src/docs/data/docs/en/` organized by section (getting-started, agents, tools, cli, etc.). Each MDX file has frontmatter with `title`, `description`, optional `section` (defaults to "main"), and `sidebar` (label, order, badge).

The content collection schema is in `src/content.config.ts` — it dynamically reads section IDs from sidebar nav config, so adding a new sidebar tab automatically makes it a valid `section` value.

### i18n

Two locales: `en` (default, no prefix), `fr` (prefixed). Config must stay in sync across three places:
1. `astro.config.mjs` → `i18n.locales`
2. `src/docs/config/siteSettings.json.ts` → `locales` array
3. `src/docs/config/translationData.json.ts` → data/text/route translations

Per-locale config files live in `src/docs/config/{locale}/` — `siteData.json.ts`, `navData.json.ts`, `sidebarNavData.json.ts`, `testimonialData.json.ts`.

### Routing

Pages use dynamic routes: `src/pages/[docsRoute]/[...slug].astro`. The `docsRoute` param comes from `siteSettings.docsRoute` (default: "docs"). French pages mirror the structure under `src/pages/fr/`.

### MDX Components

Eight components are auto-imported into all MDX files via `astro-auto-import` (configured in `astro.config.mjs`): `Aside`, `Badge`, `Button`, `Steps`, `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger`. No import needed in MDX.

### UI Components

Starwind UI components (accordion, alert, badge, button, card, dialog, tabs, etc.) in `src/docs/components/starwind/`. Config tracked in `starwind.config.json`.

### Build Pipeline

`scripts/fetch-changelog.js` runs during build — fetches GitHub releases from `CyberStrikeus/CyberStrike`, generates `src/docs/data/docs/en/resources/changelog.mdx` and `src/docs/data/latest-version.json`. No auth needed (public repo). Pagefind runs post-build for search indexing.

### Path Aliases

- `@/*` → `src/*`
- `@images/*` → `src/assets/images/*`
- `@videos/*` → `src/assets/videos/*`

## Deployment

Netlify (see `netlify.toml`). Docker build also available via `Dockerfile` (nginx-based, uses pnpm).

## Adding Documentation

1. Create MDX file in `src/docs/data/docs/en/{section}/`
2. Add frontmatter with `title`, `description`, and matching `section` from sidebar config
3. Use `sidebar.order` to control position within section
4. To add a new section: add entry to `sidebarNavData.json.ts` for each locale

## Code Style

- Prettier: 100 char width, double quotes, trailing commas, 2-space indent
- ESLint: `simple-import-sort` for import ordering
- Astro files parsed with astro-parser
