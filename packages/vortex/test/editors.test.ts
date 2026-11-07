import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, editorRules } from "../src/index"

const rules = compileRules(editorRules)
function tx(over: { body?: string; respHeaders?: [string, string][] }): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: (over.respHeaders ?? []).map(([n, v]) => ({ name: n, value: v })), body: over.body ?? "" },
  }
}
const fired = (t: Transaction) => rules.flatMap((r) => r.evaluate(t)).map((s) => s.ruleId)

describe("editor / authoring-tool fingerprint rules", () => {
  test("CodeMirror", () => {
    expect(fired(tx({ body: '<div class="cm-editor"><div class="cm-content"></div></div>' }))).toContain("tech-ed-codemirror")
  })

  test("Gutenberg", () => {
    expect(fired(tx({ body: '<div class="wp-block-group has-block-gap-support"></div>' }))).toContain("tech-ed-gutenberg")
  })

  test("DreamWeaver", () => {
    expect(fired(tx({ body: '<script>function MM_swapImage() {}</script><!-- Made with Adobe Dreamweaver -->' }))).toContain("tech-ed-dreamweaver")
  })

  test("FrontPage via body", () => {
    expect(fired(tx({ body: '<meta name="GENERATOR" content="Microsoft FrontPage 6.0">' }))).toContain("tech-ed-frontpage")
  })

  test("FrontPage via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Microsoft-FrontPage/5.0"]] }))).toContain("tech-ed-frontpage")
  })

  test("Microsoft Word", () => {
    expect(fired(tx({ body: '<html xmlns:w="urn:schemas-microsoft-com:office:word"><meta name="ProgId" content="Word.Document">' }))).toContain("tech-ed-ms-word")
  })

  test("Summernote", () => {
    expect(fired(tx({ body: '<div class="note-editor"><div class="note-editable"></div></div>' }))).toContain("tech-ed-summernote")
  })

  test("Unbounce via body", () => {
    expect(fired(tx({ body: '<script src="https://d9hhrg4mnvzow.cloudfront.net/unbounce/ubembed.js"></script>' }))).toContain("tech-ed-unbounce")
  })

  test("Unbounce via header", () => {
    expect(fired(tx({ respHeaders: [["x-unbounce-pageid", "abc123"]] }))).toContain("tech-ed-unbounce")
  })

  test("Adobe GoLive", () => {
    expect(fired(tx({ body: '<meta name="generator" content="Adobe GoLive 6">' }))).toContain("tech-ed-golive")
  })

  test("EditPlus", () => {
    expect(fired(tx({ body: '<!-- Created with EditPlus -->' }))).toContain("tech-ed-editplus")
  })

  test("WEBDEV via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "WEBDEV"]] }))).toContain("tech-ed-webdev")
  })

  test("Bluefish", () => {
    expect(fired(tx({ body: '<meta name="GENERATOR" content="Bluefish 2.2.10">' }))).toContain("tech-ed-bluefish")
  })

  test("Microsoft Excel", () => {
    expect(fired(tx({ body: '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><meta name="ProgId" content="Excel.Sheet">' }))).toContain("tech-ed-ms-excel")
  })

  test("iWeb", () => {
    expect(fired(tx({ body: '<meta name="generator" content="iWeb 3.0.4">' }))).toContain("tech-ed-iweb")
  })

  test("Microsoft Publisher", () => {
    expect(fired(tx({ body: '<meta name="ProgId" content="Publisher.Document"><!-- Microsoft Publisher -->' }))).toContain("tech-ed-ms-publisher")
  })

  test("Web Stories for WordPress", () => {
    expect(fired(tx({ body: '<amp-story standalone><link href="/wp-content/plugins/web-stories/style.css"></amp-story>' }))).toContain("tech-ed-web-stories")
  })

  test("Blockly", () => {
    expect(fired(tx({ body: '<script src="/blockly_compressed.js"></script><script>Blockly.inject(el);</script>' }))).toContain("tech-ed-blockly")
  })

  test("AsciiDoc", () => {
    expect(fired(tx({ body: '<meta name="generator" content="Asciidoctor 2.0.18">' }))).toContain("tech-ed-asciidoc")
  })

  test("CodeSandbox", () => {
    expect(fired(tx({ body: '<iframe src="https://codesandbox.io/embed/abc123"></iframe>' }))).toContain("tech-ed-codesandbox")
  })

  test("Amaya", () => {
    expect(fired(tx({ body: '<meta name="generator" content="Amaya, see http://www.w3.org/Amaya/">' }))).toContain("tech-ed-amaya")
  })

  test("Tiptap", () => {
    expect(fired(tx({ body: '<div class="ProseMirror tiptap"><script src="/@tiptap/core.js"></script></div>' }))).toContain("tech-ed-tiptap")
  })

  test("Microsoft PowerPoint", () => {
    expect(fired(tx({ body: '<html xmlns:p="urn:schemas-microsoft-com:office:powerpoint">' }))).toContain("tech-ed-ms-powerpoint")
  })

  test("BannerBoo", () => {
    expect(fired(tx({ body: '<script src="https://bannerboo.com/embed.js"></script>' }))).toContain("tech-ed-bannerboo")
  })

  test("Powtoon", () => {
    expect(fired(tx({ body: '<iframe src="https://www.powtoon.com/embed/abc/"></iframe>' }))).toContain("tech-ed-powtoon")
  })

  test("tlooto", () => {
    expect(fired(tx({ body: '<script src="https://tlooto.com/editor.js"></script>' }))).toContain("tech-ed-tlooto")
  })

  test("Draft.js", () => {
    expect(fired(tx({ body: '<div class="DraftEditor-root"><div class="public-DraftEditorContents"></div></div>' }))).toContain("tech-ed-draftjs")
  })

  // --- Structural ---
  test("a plain page triggers no editor rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-ed-", () => {
    for (const r of editorRules) expect(r.id).toMatch(/^tech-ed-/)
  })

  test("all rules have editor tag", () => {
    for (const r of editorRules) expect(r.tags).toContain("editor")
  })

  test("rule count is 25", () => {
    expect(editorRules.length).toBe(25)
  })
})
