# Cyberstrike Documentation Site

Official documentation for Cyberstrike - AI-Powered Penetration Testing Agent.

Built with Astro v5 and Tailwind CSS v4.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   # or
   bun install
   ```

2. Copy the Pagefind build (for site search) to be available for the dev environment:
   - For Windows: `npm run winsearch`
   - For OSX/Linux: `npm run osxsearch`

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:4322 in your browser.

## Building for Production

```bash
npm run build
```

## Project Structure

```
docs-site/
├── public/              # Static assets
│   ├── favicons/       # Favicon files
│   └── presentations/  # MARP presentations
├── src/
│   ├── docs/           # Documentation system
│   │   ├── components/ # Astro components
│   │   ├── config/     # Site configuration (per locale)
│   │   ├── data/       # Documentation content (MDX)
│   │   ├── layouts/    # Page layouts
│   │   └── styles/     # Documentation styles
│   ├── pages/          # Astro pages
│   └── styles/         # Global styles
└── astro.config.mjs    # Astro configuration
```

## Configuration

### Site Settings
`src/docs/config/siteSettings.json.ts` - View transitions, animations, copy link buttons

### Site Data
`src/docs/config/[language]/siteData.json.ts` - Site title, description, social links

### Navigation
`src/docs/config/[language]/navData.json.ts` - Top navbar links

### Sidebar
`src/docs/config/[language]/sidebarNavData.json.ts` - Documentation section order

## Documentation Content

Documentation pages are located in `src/docs/data/docs/en/`. Each MDX file becomes a documentation page.

### Available Sections

- **Getting Started** - Installation, authentication, first scan
- **Providers** - AI provider configuration (Anthropic, OpenAI, etc.)
- **Agents** - Security agents (web-application, cloud-security, etc.)
- **Tools** - Built-in tools reference
- **CLI** - Command line interface reference
- **Configuration** - Project and global config
- **MCP** - Model Context Protocol integration
- **Hooks** - Plugin and config hooks
- **Permissions** - Permission modes and patterns

## Commands

| Command           | Action                                      |
| :---------------- | :------------------------------------------ |
| `npm install`     | Install dependencies                        |
| `npm run dev`     | Start dev server at `localhost:4322`        |
| `npm run build`   | Build production site to `./dist/`          |
| `npm run preview` | Preview build locally before deploying      |

## Links

- **Main Site**: https://cyberstrike.io
- **Documentation**: https://docs.cyberstrike.io
- **GitHub**: https://github.com/CyberStrikeus/cyberstrike.io
# Force rebuild
