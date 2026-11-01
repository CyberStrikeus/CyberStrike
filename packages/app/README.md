## Usage

Dependencies for these templates are managed with [pnpm](https://pnpm.io) using `pnpm up -Lri`.

This is the reason you see a `pnpm-lock.yaml`. That said, any package manager will work. This file can safely be removed once you clone a template.

```bash
$ npm install # or pnpm install or yarn install
```

### Learn more on the [Solid Website](https://solidjs.com) and come chat with us on our [Discord](https://discord.com/invite/solidjs)

## Available Scripts

In the project directory, you can run:

### `npm run dev` or `npm start`

Runs the app in the development mode.<br>
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br>

### `npm run build`

Builds the app for production to the `dist` folder.<br>
It correctly bundles Solid in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br>
Your app is ready to be deployed!

## E2E Testing

Playwright starts the Vite dev server automatically via `webServer`, and UI tests need an cyberstrike backend (defaults to `localhost:4096`).
Use the local runner to create a temp sandbox, seed data, and run the tests.

```bash
bunx playwright install
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

Environment options:

- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (backend address, default: `localhost:4096`)
- `PLAYWRIGHT_PORT` (Vite dev server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (override base URL, default: `http://localhost:<PLAYWRIGHT_PORT>`)

## Language

The web UI ships with 17 interface languages. English remains the default; every other
language is opt-in and nothing changes for existing installations.

### Selecting Persian (Farsi)

1. Open **Settings** (`Ctrl`/`⌘` + `,`, or run "Open settings" from the command palette).
2. On the **General** tab, open the **Language** row.
3. Pick **فارسی** (`fa`).

The selection takes effect immediately and is announced with a toast. You can also cycle
languages from the command palette ("Cycle language") or pick one directly
("Use language: …").

### Right-to-left

Persian is a right-to-left language, so selecting it sets `dir="rtl"` on `<html>`.
Choosing any other language sets `dir="ltr"` back and the layout returns to normal.
`lang` and the `cs_locale` cookie are kept in sync with the selection.

### Persistence and fallback

The preference is stored through the app's existing global persistence layer under
`cyberstrike.global.dat:language`, so it survives reloads and restarts without any
configuration change. If the stored value is missing or not a known locale, the UI falls
back to English; if a translation is missing for a particular string, the English text is
used.

Locale codes: `fa` is auto-detected from `fa`, `fa-IR`, `fa-AF`, `fas`, `per`, `pes` and `farsi`.

### Scope

Persian covers the self-hosted web UI (`packages/app`) and the shared component strings it
renders (`packages/ui`). Two other user-facing surfaces are **not** covered:

- **TUI** (`packages/cyberstrike/src/cli/cmd/tui`) — has no localization system at all.
  `packages/cyberstrike/src/util/locale.ts` only formats times, durations and numbers; all
  terminal strings are hardcoded English.
- **Marketing/docs site** (`packages/console`) — has its own separate i18n and its own
  locale-routed pages. It is not driven by the web UI preference.

### Adding another language

Copy `src/i18n/en.ts` to `src/<code>.ts` (and `packages/ui/src/i18n/en.ts` to
`packages/ui/src/i18n/<code>.ts`), translate the values only, then register the code in
`src/context/language.tsx`: the `Locale` union, `LOCALES`, `LABEL_KEY`, `DICT`,
`localeMatchers` and `PARITY_CHECK`, plus a `"language.<code>"` label in every locale file.
Add the code to `RTL_LOCALES` in `src/i18n/direction.ts` if the language is right-to-left.
`src/i18n/persian.test.ts` and `src/i18n/parity.test.ts` guard key parity and placeholders.

## Deployment

You can deploy the `dist` folder to any static host provider (netlify, surge, now, etc.)
