import { describe, expect, test } from "bun:test"
import { direction } from "./direction"
import { dict as en } from "./en"
import { dict as fa } from "./fa"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { dict as uiEn } from "@cyberstrike-io/ui/i18n/en"
import { dict as uiFa } from "@cyberstrike-io/ui/i18n/fa"

const app: Record<string, string> = en
const appFa: Record<string, string> = fa
const ui: Record<string, string> = uiEn
const uiPersian: Record<string, string> = uiFa

const LOCALES = [
  ["zh", zh],
  ["zht", zht],
  ["ko", ko],
  ["de", de],
  ["es", es],
  ["fr", fr],
  ["da", da],
  ["ja", ja],
  ["pl", pl],
  ["ru", ru],
  ["ar", ar],
  ["no", no],
  ["br", br],
  ["th", th],
  ["bs", bs],
] as const

describe("text direction", () => {
  test("persian is right-to-left", () => {
    expect(direction("fa")).toBe("rtl")
  })

  test("every locale shipped before persian stays left-to-right", () => {
    for (const [name] of LOCALES) expect(direction(name)).toBe("ltr")
    expect(direction("en")).toBe("ltr")
  })

  test("an unknown locale falls back to left-to-right", () => {
    expect(direction("xx")).toBe("ltr")
  })
})

describe("persian translation completeness", () => {
  test("covers every english string in the app dictionary", () => {
    expect(Object.keys(fa)).toEqual(Object.keys(en))
  })

  test("covers every english string in the ui dictionary", () => {
    expect(Object.keys(uiFa)).toEqual(Object.keys(uiEn))
  })

  test("only leaves intentional non-translatable values identical", () => {
    const allowIdentical = [
      /^font\.option\./,
      /^sound\.option\./,
      /^language\./,
      /^ui\.tool\./,
      /^settings\.permissions\.tool\..*\.title$/,
      /^model\.provider\./,
      /^model\.input\./,
      /^command\.category\.mcp$/,
      /^status\.popover\.tab\.(mcp|lsp|bolt)$/,
      /^settings\.mcp\.title$/,
      /^dialog\.mcp\.add\.command$/,
    ]

    const allowExact = new Set([
      "...",
      "MCP",
      "LSP",
      "Bolt",
      "WSL",
      "ESC",
      "mcp",
      "pdf",
      "value",
      "myprovider",
      "model-id",
      "Header-Name",
      "password",
      "cyberstrike",
      "CyberStrike Desktop",
      "{{count}} LSP",
      "https://api.myprovider.com/v1",
      "https://your-tunnel.trycloudflare.com",
      "http://localhost:4096",
      "cyberstrike.io/zen",
    ])

    const identical = Object.keys(app).filter((key) => appFa[key] === app[key])
    const unexpected = identical.filter(
      (key) => !allowIdentical.some((pattern) => pattern.test(key)) && !allowExact.has(app[key]),
    )
    expect(unexpected).toEqual([])
  })

  test("keeps interpolation placeholders intact", () => {
    const placeholders = (value: string) => value.match(/{{.*?}}/g)?.sort() ?? []
    const mismatched = Object.keys(app).filter(
      (key) => placeholders(app[key]).join() !== placeholders(appFa[key] ?? "").join(),
    )
    expect(mismatched).toEqual([])
  })

  test("keeps machine-readable values in their original form", () => {
    expect(appFa["language.en"]).toBe("English")
    expect(appFa["font.option.ibmPlexMono"]).toBe("IBM Plex Mono")
    expect(appFa["sound.option.alert01"]).toBe("Alert 01")
    expect(uiPersian["ui.tool.grep"]).toBe("Grep")
    expect(uiPersian["ui.tool.shell"]).toBe("Shell")
    expect(appFa["settings.permissions.tool.bash.title"]).toBe("Bash")
    expect(appFa["provider.custom.field.baseURL.placeholder"]).toBe("https://api.myprovider.com/v1")
  })
})

describe("persian language label", () => {
  test("is offered in the selector for every locale", () => {
    expect(en["language.fa"]).toBe("فارسی")
    for (const [name, dict] of LOCALES) {
      expect(dict["language.fa"], `${name} is missing language.fa`).toBe("فارسی")
    }
  })

  test("keeps the existing language labels untouched", () => {
    expect(en["language.en"]).toBe("English")
    expect(en["language.ar"]).toBe("العربية")
    expect(en["language.th"]).toBe("ไทย")
  })
})
