# Documentation Assets

Source files for the generated images used in the docs. **Edit the sources here, then regenerate** — never hand-edit the output files under `public/docs/images/`.

## Layout

```
docs/
├── assets/
│   ├── diagrams/*.mmd|*.mermaid   ← Mermaid sources  →  SVG
│   ├── tapes/*.tape               ← VHS sources      →  GIF (+ optional PNG stills)
│   ├── mermaid.config.json        ← Mermaid theme (Cyberstrike palette)
│   └── puppeteer.json             ← headless-chrome args for mmdc
├── scripts/gen-assets.sh          ← generator
└── public/docs/images/
    ├── diagrams/*.svg             ← GENERATED (do not edit)
    ├── gifs/*.gif                 ← GENERATED (do not edit)
    └── screenshots/*.png|*.jpg    ← screenshots (manual or VHS `Screenshot`)
```

## Tools

| Asset | Tool | Install |
|-------|------|---------|
| SVG diagrams | [`mmdc`](https://github.com/mermaid-js/mermaid-cli) | `npm i -D @mermaid-js/mermaid-cli` (or the script falls back to `npx`) |
| GIF demos | [`vhs`](https://github.com/charmbracelet/vhs) | `brew install vhs` (already installed) |
| GIF optimize | `gifsicle` | `brew install gifsicle` (optional) |

## Generate

```bash
npm run assets            # everything
npm run assets:diagrams   # only Mermaid → SVG
npm run assets:gifs       # only VHS → GIF
# a single asset by basename:
scripts/gen-assets.sh diagrams config-priority
```

## Adding a diagram (SVG)

1. Create `assets/diagrams/<name>.mmd` (Mermaid `flowchart`, `sequenceDiagram`, …).
2. `npm run assets:diagrams` → produces `public/docs/images/diagrams/<name>.svg`.
3. Replace the placeholder in the `.mdx` page with:
   ```mdx
   <img src="/docs/images/diagrams/<name>.svg" alt="…" className="my-6" />
   ```

## Adding a GIF demo

1. Create `assets/tapes/<name>.tape`. Its first line MUST set the output path:
   `Output public/docs/images/gifs/<name>.gif`
2. `npm run assets:gifs` → records the terminal script into a GIF (optimized if `gifsicle` is present).
3. Replace the placeholder with:
   ```mdx
   <img src="/docs/images/gifs/<name>.gif" alt="…" className="rounded-lg shadow-lg my-6" />
   ```

> GIF tapes that drive the real `cyberstrike` TUI need the CLI on `PATH` and a configured provider. Keep demos short and deterministic; target ≤ 5 MB / ≤ 800 px wide (see the brand notes below).

## Brand

- Dark-first, transparent background where possible.
- Palette: `#00ff88` primary, `#00d4ff` accent, `#ff4444` danger, `#0b1220` background.
- Terminal font: JetBrains Mono / Fira Code.

The old asset checklist and placeholder inventory lives in `public/docs/PLACEHOLDERS.md`.
