# Notion clipboard case: sources and scope

The case uses Notion Desktop 7.6.1's shipped JavaScript, a fresh REA inspection
of its tab preload, and separately recorded probes of cached web-editor modules.
The public page contains selected result fields, small code excerpts and generic
example data. Original packages, complete analysis results and captured local
state are not website assets.

## Fresh REA result

The published npm REA 4.1.0 package inspected the saved tab preload on
7 October 2026, using Node.js 24.18.0. An independent source build of public
checkpoint [`810fe53e`](https://github.com/morluto/rea/tree/810fe53e) returned the
same API and invoke findings. The page uses the published-package result.

The successful `analyze_javascript_application` request inspected the extracted
directory `.webpack/renderer/tab_browser_view`. Its only file was `preload.js`:
24,579 bytes, one parsed JavaScript file and no parse failures or truncated
scopes. The result's relevant observations were:

| Finding        | Selected fields                                                                            | Source range                              |
| -------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Context bridge | `api_key: "__electronApi"`, `api_status: "dynamic"`, `members: []`, `unknown_members: 1`   | `preload.js`, line 1, columns 22764–22828 |
| Renderer IPC   | `operation: "invoke"`, `channel_expression: "e"`, `channel: null`, `resolution: "dynamic"` | `preload.js`, line 1, columns 6486–6522   |

These are `ast-static-analysis` observations. Lines are one-based and columns
zero-based, in the original decoded source. The page's two result panels are a
readable projection of these fields, not a complete or replayable Evidence
object.

The focused result locates the exposed bridge and IPC wrapper. Reading the
packaged API object supplies the `clipboard.write` member and its literal
`notion:clipboard:write` argument. Reading the main-process wrapper and receiver
connects that channel to Electron's clipboard call. The four-step figure
summarizes this source reading; it is not an automatically paired IPC graph or
a captured desktop execution.

Additional feature traces reused the focused result:

- API seed `__electronApi`, exact match: one seed, partial coverage, 17 nodes,
  16 edges and no terminal paths.
- Channel seed `notion:clipboard:write`, exact match: no graph match. Its
  propagation through the wrappers was unresolved in that graph.

Neither trace establishes a complete clipboard feature graph. The page therefore
uses the directly observed API/invoke source ranges and the separately inspected
wrapper code, rather than presenting those trace counts as the clipboard route.

## Packaged bridge excerpts

Artifact: Notion Desktop 7.6.1 Windows `app.asar`, 8,903,750 bytes.
SHA-256: `97c41bc14fc0ea8c91cd34f502660963dfdf294d5eb35165ccac9d30963069d4`.

| Relative packaged file                          | Relevant source anchors                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.webpack/renderer/tab_browser_view/preload.js` | Clipboard API member around character 8274; invoke helpers around 6105/6460; context bridge exposure around 22764                                              |
| `.webpack/main/index.js`                        | Handler wrapper around character 313027; clipboard receiver around 726249; sender-check adapter around 750262; underlying `isNotionWebContents` around 1281553 |

Character anchors refer to decoded JavaScript, counted from the start of each
file. They are distinct from REA's line/column ranges above.

Source digests:

- Tab preload: `c209b1222cd15721bf1988f88c3e57e187d11306edb5eddb13eca441feb6e337`.
- Main bundle: `7d06e97721281403e7cf221389de22c6e40d800030a87511231b5390df1452ea`.

The HTML excerpts expand minified variable names and omit unrelated members.
The API-member excerpt illustrates the relevant member; it does not reproduce
the entire assembled API object. The sender-check expression expands the
adapter to its underlying `isNotionWebContents` call. The meaningful operations
are preserved: bind the literal channel, invoke it, register its receiver,
check the sender and call `clipboard.write(data)`.

## Separately cached web-editor code

The web examples come from a 13 July 2026 cache, build
`swv2-23.13.20260713.0259`. This is a separate artifact identity from the desktop
ASAR. Corresponding API names help explain the two sides; no same-version live
copy/paste session was captured for this case.

The clipboard examples use:

- Module `747001`: copy-payload construction, private MIME storage and virtual
  clipboard handling.
- Module `58169`: marker encoding and decoding.
- Module `736810`: desktop clipboard routing, including the
  `electronApi.clipboard.write` call.

The routing helper's asset,
`clipboard-817bda3acae9bf1e__be64437d1c0e.js`, has SHA-256
`be64437d1c0eba9c74b48f4307c5936790c59e85aa2ce845e22016a101c2ff7f`.

Saved Node/JSDOM probes used extracted modules, faithful lifted helpers and
stubbed environment APIs. The marker helper is extracted code; the virtual
clipboard reader includes a lifted implementation. A matching-ID specimen
recovered private formats; a stale local entry retained ordinary text and HTML.
This supports the recovered matching policy, rather than proof of OS clipboard
hydration or fidelity of a complex block in the running app.

The figure's “Project notes” and `<copy-id>` are generic illustrations.
`<copy-id>` stands for the generated marker ID; it is not a literal runtime UUID.

## Markdown specimen

The table uses the saved extracted-module probe of structured Markdown parser
`422457`. Input:

```markdown
| A   | B   |
| --- | --- |
| 1   | 2   |
```

In the structured sample record, `/samples/table/raw/blocks/0` is a table with
`headerRow: true`, two `table_row` children, and cell text `A`/`B` followed by
`1`/`2`. The corresponding page and chat filtered outputs preserve those rows
and cells. The public tree is an outline of these fields, not an unmodified
JSON object or a persisted Notion page.

The broader historical harness included stubs and several parser variants.
This specimen comes from the intact structured-parser result, rather than a
legacy table-creation record affected by a synthetic ID collision. Historical
module probes are attributed to that harness; REA's new role in this page is
the separately verified preload analysis.

## SQLite follow-up

The short expandable follow-up is based on the same desktop package. Its
`getSqliteMeta` path transfers `MessageChannelMain` ports between the renderer
and a SQLite utility process. Later statement batches and results use that
port. Relevant files are the tab preload, main bundle and `SqliteServer.js`.
The page explains the source-level handoff without claiming a captured SQL
session.
