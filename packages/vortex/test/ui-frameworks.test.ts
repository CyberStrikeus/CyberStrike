import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, uiFrameworkRules } from "../src/index"

const rules = compileRules(uiFrameworkRules)
function tx(body: string): Transaction {
  return {
    id: "t",
    source: "browser",
    host: "app.test",
    request: { method: "GET", url: "https://app.test/", headers: [] },
    response: { status: 200, headers: [], body },
  }
}
const fired = (body: string) => rules.flatMap((r) => r.evaluate(tx(body))).map((s) => s.ruleId)
const css = (href: string) => `<link rel="stylesheet" href="${href}">`
const js = (src: string) => `<script src="${src}"></script>`

const samples: [string, string][] = [
  ["tech-ui-bootstrap", css("/css/bootstrap.min.css")],
  ["tech-ui-tailwind", '<style>.x{--tw-ring-color:red}</style>'],
  ["tech-ui-radix", js("/node_modules/@radix-ui/react-dialog/dist/index.js")],
  ["tech-ui-shadcn", '<!-- built with shadcn/ui --><div>shadcn</div>'],
  ["tech-ui-mui", '<button class="MuiButton-root MuiButton-contained"></button>'],
  ["tech-ui-animate-css", '<div class="animate__animated animate__fadeIn"></div>'],
  ["tech-ui-foundation", css("/css/foundation.min.css")],
  ["tech-ui-uikit", css("/css/uikit.min.css")],
  ["tech-ui-element-ui", '<button class="el-button"></button><script src="/element-ui/lib/index.js"></script>'],
  ["tech-ui-headlessui", js("/node_modules/@headlessui/react/dist/index.js")],
  ["tech-ui-base-ui", js("/node_modules/@base-ui-components/react/index.js")],
  ["tech-ui-antd", '<button class="ant-btn ant-btn-primary"></button>'],
  ["tech-ui-sveltekit", '<link href="/_app/immutable/entry/start.js" data-sveltekit-preload>'],
  ["tech-ui-vuetify", css("/vuetify/dist/vuetify.min.css")],
  ["tech-ui-kendo", css("/kendo/styles/kendo.all.min.css")],
  ["tech-ui-chakra", js("/node_modules/@chakra-ui/react/dist/index.js")],
  ["tech-ui-unocss", '<style>/* unocss */</style><script src="/@unocss/runtime"></script>'],
  ["tech-ui-layui", css("/layui/css/layui.css")],
  ["tech-ui-flutter", js("/flutter.js")],
  ["tech-ui-mdl", '<button class="mdl-button mdl-js-button"></button>'],
  ["tech-ui-angular-material", '<button class="mat-mdc-button"></button>'],
  ["tech-ui-w3css", css("/w3.css")],
  ["tech-ui-purecss", css("/css/pure-min.css")],
  ["tech-ui-semantic", css("/css/semantic.min.css")],
  ["tech-ui-mdbootstrap", css("/css/mdb.min.css")],
  ["tech-ui-panda-css", '<script>import "@pandacss/dev";</script>'],
  ["tech-ui-normalize", css("/css/normalize.min.css")],
  ["tech-ui-materialize", css("/css/materialize.min.css")],
  ["tech-ui-bulma", css("/css/bulma.min.css")],
  ["tech-ui-telerik-aspnet", '<script>Telerik.Web.UI.RadScriptManager;</script>'],
  ["tech-ui-aura", js("/auraFW/javascript/aura.js")],
  ["tech-ui-primevue", js("/node_modules/primevue/button/button.js")],
  ["tech-ui-mantine", js("/node_modules/@mantine/core/index.js")],
  ["tech-ui-daisyui", '<!-- daisyui --><button class="btn"></button><style>/* daisyui */</style>'],
  ["tech-ui-formalize", css("/css/formalize.css")],
  ["tech-ui-naive", js("/node_modules/naive-ui/dist/index.js")],
  ["tech-ui-devextreme", js("/js/dx.all.js")],
  ["tech-ui-mudblazor", '<div class="mud-container"><!-- MudBlazor --></div>'],
  ["tech-ui-nuxt-ui", js("/node_modules/@nuxt/ui/dist/index.js")],
  ["tech-ui-flowbite", js("/js/flowbite.min.js")],
  ["tech-ui-clarity", js("/node_modules/@clr/ui/index.js")],
  ["tech-ui-uswds", css("/css/uswds.min.css")],
  ["tech-ui-easyui", js("/js/jquery.easyui.min.js")],
  ["tech-ui-coreui", css("/node_modules/@coreui/coreui/dist/css/coreui.min.css")],
  ["tech-ui-shoelace", js("/node_modules/@shoelace-style/shoelace/dist/shoelace.js")],
  ["tech-ui-preline", js("/node_modules/preline/dist/preline.js")],
  ["tech-ui-tdesign", js("/node_modules/tdesign-vue/dist/tdesign.js")],
  ["tech-ui-dsfr", css("/css/dsfr.min.css")],
  ["tech-ui-automatic-css", css("/css/automatic.css")],
  ["tech-ui-marko", js("/node_modules/marko/dist/index.js")],
  ["tech-ui-pico", css("/css/pico.min.css")],
  ["tech-ui-arco", js("/node_modules/@arco-design/web-vue/index.js")],
  ["tech-ui-heroui", js("/node_modules/@heroui/react/index.js")],
  ["tech-ui-primereact", js("/node_modules/primereact/button/button.js")],
  ["tech-ui-flat-ui", css("/css/flat-ui.min.css")],
  ["tech-ui-tachyons", css("/css/tachyons.min.css")],
  ["tech-ui-nsw-ds", css("/css/nsw-design-system.css")],
  ["tech-ui-shadcn-svelte", js("/node_modules/bits-ui/dist/index.js")],
  ["tech-ui-govuk-frontend", '<button class="govuk-button">Continue</button>'],
  ["tech-ui-vant", js("/node_modules/vant/lib/index.js")],
  ["tech-ui-milligram", css("/css/milligram.min.css")],
  ["tech-ui-webawesome", js("/node_modules/webawesome/dist/index.js")],
  ["tech-ui-dorik", js("https://dorik.io/embed.js")],
  ["tech-ui-carbon", '<button class="bx--btn bx--btn--primary"></button>'],
  ["tech-ui-mdui", css("/css/mdui.min.css")],
  ["tech-ui-govuk-template", css("/govuk_template/style.css")],
  ["tech-ui-metroui", css("/css/metro.min.css")],
  ["tech-ui-kobalte", js("/node_modules/@kobalte/core/index.js")],
  ["tech-ui-govuk-toolkit", css("/govuk-toolkit/style.css")],
  ["tech-ui-sprig", js("/js/sprig.min.js")],
  ["tech-ui-simple-css", css("/css/simple.min.css")],
  ["tech-ui-storefront-ui", js("/node_modules/@storefront-ui/vue/index.js")],
  ["tech-ui-dioxus", '<script>window.__dioxus = {};</script>'],
  ["tech-ui-open-props", css("/css/open-props.min.css")],
  ["tech-ui-vkui", js("/node_modules/@vkontakte/vkui/dist/index.js")],
  ["tech-ui-civictheme", css("/themes/civictheme/style.css")],
  ["tech-ui-oat-ui", js("/js/oat-ui.js")],
  ["tech-ui-augmented", '<div data-augmented-ui="tl-clip br-clip both"></div>'],
  ["tech-ui-magic-ui", js("/node_modules/@magicui/react/index.js")],
  ["tech-ui-flyvi", js("https://flyvi.io/embed.js")],
  ["tech-ui-devup", js("/node_modules/@devup-ui/react/index.js")],
  ["tech-ui-dockview", js("/node_modules/dockview-core/dist/index.js")],
  ["tech-ui-xtrixui", js("/js/xtrixui.js")],
  ["tech-ui-spatie-media", js("/js/media-library-pro.js")],
  ["tech-ui-new-ui", css("/css/newui.min.css")],
  ["tech-ui-shapecss", css("/css/shapecss.css")],
  ["tech-ui-yamada", js("/node_modules/@yamada-ui/react/index.js")],
]

describe("UI framework fingerprint rules", () => {
  test("every rule has a sample and the sample fires it", () => {
    const ids = new Set(uiFrameworkRules.map((r) => r.id))
    const sampled = new Set(samples.map(([id]) => id))
    for (const id of ids) expect(sampled.has(id)).toBe(true)
    for (const [id, body] of samples) expect(fired(body)).toContain(id)
  })

  test("a plain page triggers no UI framework rules", () => {
    expect(fired("<html><body>Hello world</body></html>")).toHaveLength(0)
  })

  test("all rule IDs start with tech-ui-", () => {
    for (const r of uiFrameworkRules) expect(r.id).toMatch(/^tech-ui-/)
  })

  test("all rules have ui-framework tag", () => {
    for (const r of uiFrameworkRules) expect(r.tags).toContain("ui-framework")
  })

  test("rule count is 87", () => {
    expect(uiFrameworkRules.length).toBe(87)
  })
})
