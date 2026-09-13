import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, jsFrameworkRules } from "../src/index"

const rules = compileRules(jsFrameworkRules)
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

describe("JS framework fingerprint rules", () => {
  // --- Core SPA ---
  test("React", () => {
    expect(fired(tx({ body: '<div id="root" data-reactroot=""></div><script src="/react.production.min.js"></script>' }))).toContain("tech-js-react")
  })

  test("Vue", () => {
    expect(fired(tx({ body: '<div data-v-abc123><script src="/vue.runtime.min.js"></script></div>' }))).toContain("tech-js-vue")
  })

  test("Angular", () => {
    expect(fired(tx({ body: '<app-root ng-version="17.0.0"></app-root>' }))).toContain("tech-js-angular")
  })

  test("AngularJS", () => {
    expect(fired(tx({ body: '<div ng-app="myApp" ng-controller="MainCtrl"></div>' }))).toContain("tech-js-angularjs")
  })

  test("Svelte", () => {
    expect(fired(tx({ body: '<div class="svelte-1a2b3c"><script src="/svelte/internal.js"></script></div>' }))).toContain("tech-js-svelte")
  })

  test("SolidJS", () => {
    expect(fired(tx({ body: '<script>window._$HY = { events: [] };</script>' }))).toContain("tech-js-solidjs")
  })

  test("Alpine.js", () => {
    expect(fired(tx({ body: '<div x-data="{ open: false }" x-init="init()"></div>' }))).toContain("tech-js-alpine")
  })

  test("InfernoJS", () => {
    expect(fired(tx({ body: '<script src="/inferno.min.js"></script>' }))).toContain("tech-js-infernojs")
  })

  test("Mithril.js", () => {
    expect(fired(tx({ body: '<script src="/mithril.min.js"></script>' }))).toContain("tech-js-mithril")
  })

  test("Moon", () => {
    expect(fired(tx({ body: '<script src="/moon.min.js"></script>' }))).toContain("tech-js-moon")
  })

  test("Riot.js", () => {
    expect(fired(tx({ body: '<script src="/riot.min.js"></script>' }))).toContain("tech-js-riot")
  })

  test("ef.js", () => {
    expect(fired(tx({ body: '<script src="/ef.min.js"></script>' }))).toContain("tech-js-efjs")
  })

  // --- Legacy / classic ---
  test("Backbone.js", () => {
    expect(fired(tx({ body: '<script src="/backbone.min.js"></script>' }))).toContain("tech-js-backbone")
  })

  test("Marionette.js", () => {
    expect(fired(tx({ body: '<script src="/backbone.marionette.min.js"></script>' }))).toContain("tech-js-marionette")
  })

  test("Prototype", () => {
    expect(fired(tx({ body: '<script src="/prototype.js"></script>' }))).toContain("tech-js-prototype")
  })

  test("MooTools", () => {
    expect(fired(tx({ body: '<script src="/mootools-core.js"></script>' }))).toContain("tech-js-mootools")
  })

  test("Knockout.js", () => {
    expect(fired(tx({ body: '<div data-bind="text: name"></div><script src="/knockout-3.5.1.js"></script>' }))).toContain("tech-js-knockout")
  })

  test("ExtJS", () => {
    expect(fired(tx({ body: '<script src="/ext-all.js"></script>' }))).toContain("tech-js-extjs")
  })

  test("Ember.js", () => {
    expect(fired(tx({ body: '<div class="ember-application"><script src="/ember.min.js"></script></div>' }))).toContain("tech-js-ember")
  })

  test("CanJS", () => {
    expect(fired(tx({ body: '<script src="/can.min.js"></script>' }))).toContain("tech-js-canjs")
  })

  test("Aurelia", () => {
    expect(fired(tx({ body: '<body aurelia-app="main"><script src="/aurelia-bootstrapper.js"></script></body>' }))).toContain("tech-js-aurelia")
  })

  test("Polymer", () => {
    expect(fired(tx({ body: '<dom-module id="my-el"></dom-module><script src="/polymer.js"></script>' }))).toContain("tech-js-polymer")
  })

  test("Batman.js", () => {
    expect(fired(tx({ body: '<script src="/batman.min.js"></script>' }))).toContain("tech-js-batman")
  })

  test("RightJS", () => {
    expect(fired(tx({ body: '<script src="/right.js"></script>' }))).toContain("tech-js-rightjs")
  })

  test("Enyo", () => {
    expect(fired(tx({ body: '<script src="/enyo.js"></script>' }))).toContain("tech-js-enyo")
  })

  // --- Module loaders / reactive ---
  test("RequireJS", () => {
    expect(fired(tx({ body: '<script data-main="app" src="/require.min.js"></script>' }))).toContain("tech-js-requirejs")
  })

  test("Zone.js", () => {
    expect(fired(tx({ body: '<script src="/zone.min.js"></script>' }))).toContain("tech-js-zonejs")
  })

  test("RxJS", () => {
    expect(fired(tx({ body: '<script src="/rxjs.umd.min.js"></script>' }))).toContain("tech-js-rxjs")
  })

  test("Socket.io", () => {
    expect(fired(tx({ body: '<script src="/socket.io/socket.io.js"></script>' }))).toContain("tech-js-socketio")
  })

  // --- State ---
  test("Redux", () => {
    expect(fired(tx({ body: '<script>window.__REDUX_DEVTOOLS_EXTENSION__ && f();</script>' }))).toContain("tech-js-redux")
  })

  test("React Redux", () => {
    expect(fired(tx({ body: '<script src="/react-redux.min.js"></script>' }))).toContain("tech-js-react-redux")
  })

  // --- React ecosystem / meta-frameworks ---
  test("React Router", () => {
    expect(fired(tx({ body: '<script src="/react-router-dom.min.js"></script>' }))).toContain("tech-js-react-router")
  })

  test("Gatsby", () => {
    expect(fired(tx({ body: '<div id="___gatsby"></div><link href="/page-data/index/page-data.json">' }))).toContain("tech-js-gatsby")
  })

  test("Astro", () => {
    expect(fired(tx({ body: '<astro-island uid="abc"></astro-island><link href="/_astro/index.css">' }))).toContain("tech-js-astro")
  })

  test("Frontity", () => {
    expect(fired(tx({ body: '<script src="/@frontity/core.js"></script>' }))).toContain("tech-js-frontity")
  })

  test("RedwoodJS", () => {
    expect(fired(tx({ body: '<script>window.__REDWOOD__ = {};</script>' }))).toContain("tech-js-redwoodjs")
  })

  test("Hydrogen", () => {
    expect(fired(tx({ body: '<script src="/@shopify/hydrogen/dist/index.js"></script>' }))).toContain("tech-js-hydrogen")
  })

  test("Vike", () => {
    expect(fired(tx({ body: '<script>import("/dist/_default.page.client.js");</script>' }))).toContain("tech-js-vike")
  })

  test("Quasar", () => {
    expect(fired(tx({ body: '<div id="q-app"><script src="/quasar.umd.min.js"></script></div>' }))).toContain("tech-js-quasar")
  })

  test("Meteor", () => {
    expect(fired(tx({ body: '<script>__meteor_runtime_config__ = {};</script>' }))).toContain("tech-js-meteor")
  })

  test("UmiJs", () => {
    expect(fired(tx({ body: '<script src="/umi.7f8a9b.js"></script>' }))).toContain("tech-js-umijs")
  })

  // --- Server-driven / hypermedia ---
  test("Inertia.js via header", () => {
    expect(fired(tx({ respHeaders: [["x-inertia", "true"]] }))).toContain("tech-js-inertia")
  })

  test("Stimulus", () => {
    expect(fired(tx({ body: '<div data-controller="hello"><script src="/@hotwired/stimulus.js"></script></div>' }))).toContain("tech-js-stimulus")
  })

  test("Unpoly", () => {
    expect(fired(tx({ body: '<a up-follow up-target=".content" href="/page">Link</a><script src="/unpoly.min.js"></script>' }))).toContain("tech-js-unpoly")
  })

  test("Datastar", () => {
    expect(fired(tx({ body: '<div data-star-signals="{count: 0}" data-on-click="count++"></div>' }))).toContain("tech-js-datastar")
  })

  // --- Template engines ---
  test("Mustache", () => {
    expect(fired(tx({ body: '<script src="/mustache.min.js"></script>' }))).toContain("tech-js-mustache")
  })

  test("Handlebars", () => {
    expect(fired(tx({ body: '<script src="/handlebars.min.js"></script>' }))).toContain("tech-js-handlebars")
  })

  test("Hogan.js", () => {
    expect(fired(tx({ body: '<script src="/hogan.js"></script>' }))).toContain("tech-js-hogan")
  })

  // --- UI toolkits ---
  test("OpenUI5", () => {
    expect(fired(tx({ body: '<script id="sap-ui-bootstrap" src="/resources/sap-ui-core.js"></script>' }))).toContain("tech-js-openui5")
  })

  test("AlloyUI", () => {
    expect(fired(tx({ body: '<script src="/alloyui/aui-min.js"></script>' }))).toContain("tech-js-alloyui")
  })

  test("Webix", () => {
    expect(fired(tx({ body: '<script src="/webix.min.js"></script>' }))).toContain("tech-js-webix")
  })

  test("Essential JS 2", () => {
    expect(fired(tx({ body: '<script src="/@syncfusion/ej2/dist/ej2.min.js"></script>' }))).toContain("tech-js-essential-js2")
  })

  test("Sencha Touch", () => {
    expect(fired(tx({ body: '<script src="/sencha-touch.js"></script>' }))).toContain("tech-js-sencha-touch")
  })

  test("VueStrap", () => {
    expect(fired(tx({ body: '<script src="/vue-strap.min.js"></script>' }))).toContain("tech-js-vuestrap")
  })

  // --- Animation / presentation / games ---
  test("GSAP", () => {
    expect(fired(tx({ body: '<script src="/gsap.min.js"></script><script>TweenMax.to(el, 1, {});</script>' }))).toContain("tech-js-gsap")
  })

  test("Reveal.js", () => {
    expect(fired(tx({ body: '<script src="/reveal.min.js"></script><script>Reveal.initialize();</script>' }))).toContain("tech-js-reveal")
  })

  test("Phaser", () => {
    expect(fired(tx({ body: '<script>var game = new Phaser.Game(config);</script>' }))).toContain("tech-js-phaser")
  })

  test("Gridster", () => {
    expect(fired(tx({ body: '<script src="/jquery.gridster.min.js"></script>' }))).toContain("tech-js-gridster")
  })

  // --- Notifications ---
  test("toastr", () => {
    expect(fired(tx({ body: '<script src="/toastr.min.js"></script>' }))).toContain("tech-js-toastr")
  })

  test("AlertifyJS", () => {
    expect(fired(tx({ body: '<script src="/alertify.min.js"></script>' }))).toContain("tech-js-alertify")
  })

  // --- AMP / Adobe ---
  test("AMP", () => {
    expect(fired(tx({ body: '<script async src="https://cdn.ampproject.org/v0.js"></script>' }))).toContain("tech-js-amp")
  })

  test("Adobe Client Data Layer", () => {
    expect(fired(tx({ body: '<script>window.adobeDataLayer = window.adobeDataLayer || [];</script>' }))).toContain("tech-js-adobe-cdl")
  })

  // --- Functional / niche ---
  test("Elm", () => {
    expect(fired(tx({ body: '<script>Elm.Main.init({ node: el });</script>' }))).toContain("tech-js-elm")
  })

  test("Twitter Flight", () => {
    expect(fired(tx({ body: '<script src="/flight/lib/component.js"></script>' }))).toContain("tech-js-flight")
  })

  test("Wink", () => {
    expect(fired(tx({ body: '<script src="/wink-toolkit.js"></script>' }))).toContain("tech-js-wink")
  })

  test("Ajax.NET Professional", () => {
    expect(fired(tx({ body: '<script src="/ajaxpro/core.ashx"></script>' }))).toContain("tech-js-ajaxnet")
  })

  test("WeBlocks", () => {
    expect(fired(tx({ body: '<script src="/weblocks.js"></script>' }))).toContain("tech-js-weblocks")
  })

  test("Strapdown.js", () => {
    expect(fired(tx({ body: '<xmp theme="united" style="display:none;"></xmp><script src="/strapdown.js"></script>' }))).toContain("tech-js-strapdown")
  })

  test("Catberry.js", () => {
    expect(fired(tx({ body: '<script src="/catberry.js"></script>' }))).toContain("tech-js-catberry")
  })

  test("Koishi.js", () => {
    expect(fired(tx({ body: '<script src="/koishi.min.js"></script>' }))).toContain("tech-js-koishi")
  })

  test("Ripple", () => {
    expect(fired(tx({ body: '<script src="/ripple.min.js"></script>' }))).toContain("tech-js-ripple")
  })

  test("BEM", () => {
    expect(fired(tx({ body: '<script src="/i-bem.js"></script>' }))).toContain("tech-js-bem")
  })

  test("jComponent", () => {
    expect(fired(tx({ body: '<script src="/jcomponent.js"></script>' }))).toContain("tech-js-jcomponent")
  })

  test("Satus", () => {
    expect(fired(tx({ body: '<script src="/@satus/core.js"></script>' }))).toContain("tech-js-satus")
  })

  test("Booljs", () => {
    expect(fired(tx({ body: '<script src="/bool.min.js"></script>' }))).toContain("tech-js-booljs")
  })

  test("Fluid Framework", () => {
    expect(fired(tx({ body: '<script src="/@fluidframework/container-loader.js"></script>' }))).toContain("tech-js-fluid")
  })

  test("Transifex", () => {
    expect(fired(tx({ body: '<script src="https://cdn.transifex.com/live.js"></script>' }))).toContain("tech-js-transifex")
  })

  // --- Structural ---
  test("a plain page triggers no JS framework rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-js-", () => {
    for (const r of jsFrameworkRules) expect(r.id).toMatch(/^tech-js-/)
  })

  test("all rules have js-framework tag", () => {
    for (const r of jsFrameworkRules) expect(r.tags).toContain("js-framework")
  })

  test("rule count is 77", () => {
    expect(jsFrameworkRules.length).toBe(77)
  })
})
