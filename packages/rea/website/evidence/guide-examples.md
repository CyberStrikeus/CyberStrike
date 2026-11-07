# Guide example evidence

The native guide reuses the recorded DX-Ball observations in
[dx-ball-sound-pan.md](dx-ball-sound-pan.md). No new native-provider claim is
introduced by this iteration.

## Notes Electron example

This six-file, source-owned teaching fixture is in
`website/public/examples/notes-electron/`. It is a static analysis target, not
an installed Electron distribution. Its graph was obtained using the released
`rea-agents` 4.1.0 package, Node.js 24.18.0 on Linux x64, on 7 October 2026:

```sh
rea analyze-javascript-application \
  /absolute/path/to/website/public/examples/notes-electron --json
```

- Evidence ID: `ev_a7e68cbdbd52ee15a959047774d1164d385e3e5ceb704084395639d97fee093d`.
- Root artifact SHA-256: `dae5292f341b4f0dfd5be0846d4cfa0d4821f3e062e970cc1cd568c18c3fb37c`.
- Four JavaScript files parsed, zero parse failures.
- One exposed API member, one literal IPC channel, one renderer invocation,
  one main-process handler, one paired invocation, zero ambiguous invocations.
- The guide's result excerpt comes from `normalized_result.summary.ipc`.
- The `exposes`, `invokes` and `handles` graph edges retain their static
  inference authority and source locations. The guide's end-to-end explanation
  also uses the visible source in `renderer.js`, `main.js` and `csv.js`; it does
  not claim that the complete button-to-file path was observed executing.

The source was formatted before this result was recorded. Re-run analysis
when the example files change.

The guide's `examples/notes-example.zip` is generated from exactly these six
source files, under the `notes-example/` folder. Packaging changes no file
contents. Website verification compares every ZIP entry to its source file and
rejects extra entries. The recorded digests below identify the original analysis
checkpoint; subsequent metadata changes and checks are recorded separately.

## First-investigation formatter check

The first-investigation page reuses the unchanged Electron fixture and recorded
static findings above. On 9 October 2026, its generated ZIP was unpacked and the
page's formatter command was run with Node.js 24.18.0. The input
`[{ id: 1, title: 'Hello, "REA"' }]` produced:

```csv
id,title
1,"Hello, ""REA"""
```

That check executes `toCsv` from the unzipped `csv.js`. It checks formatting;
the export destination remains a conclusion from `main.js`. No Electron app
launch or new native analysis was needed for this website revision.

## Notes browser example

The three-file browser app is in `website/public/examples/notes-web/`.
A dedicated headless Chrome profile opened it at
`http://127.0.0.1:4173/examples/notes-web/`. REA 4.1.0 passively inspected that
existing page with an 8-second window, accessibility text and JSON body shapes.
A separate Playwright controller clicked the button during the capture and
saved the resulting CSV; REA did not perform the click.

- Evidence ID: `ev_7df243651c257e41f525e4225cbca5427467cf1e7b4b5b624ab41ab5717fe9c6`.
- Window: `2026-10-07T09:38:43.492Z` to
  `2026-10-07T09:38:51.531Z`.
- One observed `GET` to `/examples/notes-web/notes.json`.
- Status `200`, MIME type `application/json`, script initiator `export.js`.
- Body shape: `/notes` array, `/notes/*/id` number, `/notes/*/title` string.
- The independent browser run downloaded `notes.csv` and displayed
  “Exported 2 notes to notes.csv.” CSV construction is explained from source,
  not inferred solely from the request capture.

The CLI guide uses a 10-second window to give the reader time to perform the
action. Capture only covers requests after attachment. The example request
path differs under a project prefix such as `/rea/`, while the relative fetch
and export behavior stay the same.

The guide's follow-up CLI commands were also exercised against the real page:
`list-browser-targets` returned its exact page target, and
`inspect-web-page --include-script-sources` returned the loaded `export.js`
source. Discovery Evidence: `ev_31abb33e7707d47625ac909ab9256c705d03a31ee6bcd643fa96730e72469162`. Script capture
Evidence: `ev_aeb777df405c09dc1bbdd4c185a5af2452abaa3cb493683c296c5afa97efbc11`.

## SEO metadata check — 9 October 2026

Both Notes HTML heads gained descriptions and `noindex` directives. The Electron
fixture was analyzed again with `rea-agents` 4.1.0 and Node.js 24.18.0 on Linux
x64. REA still reports four parsed JavaScript files, zero parse failures, one
exposed API member, one literal IPC channel, one renderer transmission, one main
handler and one paired transmission, with zero ambiguous transmissions.

- Evidence ID: `ev_3958d870ecd27c202e5decc97161f2ea19db8cc88f9f39ed0449bf1581df2f2a`.
- Root artifact SHA-256: `0ee325d4eaf7f94b62b2962044995fe1efe9f1d31411eb035118b19b1f56f7bb`.
- Current Electron HTML SHA-256: `457b22543aa956fe2cd005fc6bda42d2798eb05040b75c4cb4957e3b66d0ea09`.
- Current browser HTML SHA-256: `3b24b3307ded48055ce5a48f907544195bfde3285f82df919c54a6415ac11070`.

The JavaScript and data files retain their original digests. The generated ZIP
contains the updated HTML and the same JavaScript. Local browser checks exercise
the Notes CSV download at both root and `/rea/` paths.

Full local outputs and the browser verification harness are under
`/tmp/rea-website-guides/` in the development environment, not website assets.

## Example source digests

These digests identify the files used for the recorded analyses. The browser
page later gained the site's shared `↑ Top` navigation; its `export.js` and
`notes.json` retain the versions below.

| File                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `examples/notes-electron/csv.js`       | `6875aeecc1d3e6c1ff5b888a199c26b377d812d5b10e5fb4025e192a206b0018` |
| `examples/notes-electron/index.html`   | `a31df9b29eb9d479f913c7806364609019eedd1d19cda386cc24706d5068082d` |
| `examples/notes-electron/main.js`      | `cc5b00911bfe428754d94ca40e8c0f354cfaae86f716873423aa5a62b9e0379a` |
| `examples/notes-electron/package.json` | `bfef2a7cba39a989715f56e304ca2578807159f28bdb040b75893bb341caaee7` |
| `examples/notes-electron/preload.js`   | `3cb814f2a0822c2fef437ba722374a2eabf6c6795905f41656d9c33fe8d5d9c4` |
| `examples/notes-electron/renderer.js`  | `b24aa22ed969c0849dd9da1102935a6b36b96bae46870234bdea10039dd9a5a0` |
| `examples/notes-web/export.js`         | `66f5c2501bfca72eb743a1fffbdce9a58d295e69ca66f19562e9b0fa9fc189a6` |
| `examples/notes-web/index.html`        | `97bb4729dcd838de8adae7a00eb49df0dbe8a7b73becc1c7d2a6662825013064` |
| `examples/notes-web/notes.json`        | `9fc1155e251cfbed09dadca6b195507072fffe3f602564812d644ab27c422282` |
