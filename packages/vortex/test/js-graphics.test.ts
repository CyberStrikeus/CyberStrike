import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, jsGraphicsRules } from "../src/index"

const rules = compileRules(jsGraphicsRules)
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

const s = (src: string) => `<script src="${src}"></script>`

describe("JS graphics fingerprint rules", () => {
  test("particles.js", () => {
    expect(fired(tx({ body: s("/js/particles.min.js") }))).toContain("tech-gfx-particlesjs")
  })
  test("anime.js", () => {
    expect(fired(tx({ body: s("/js/anime.min.js") }))).toContain("tech-gfx-animejs")
  })
  test("Three.js", () => {
    expect(fired(tx({ body: s("/js/three.min.js") }))).toContain("tech-gfx-threejs")
  })
  test("Chart.js", () => {
    expect(fired(tx({ body: '<script>new Chart(ctx, config);</script>' }))).toContain("tech-gfx-chartjs")
  })
  test("D3", () => {
    expect(fired(tx({ body: s("https://d3js.org/d3.v7.min.js") }))).toContain("tech-gfx-d3")
  })
  test("ApexCharts.js", () => {
    expect(fired(tx({ body: '<script>var c = new ApexCharts(el, opts);</script>' }))).toContain("tech-gfx-apexcharts")
  })
  test("Highcharts", () => {
    expect(fired(tx({ body: s("https://code.highcharts.com/highcharts.js") }))).toContain("tech-gfx-highcharts")
  })
  test("Raphael", () => {
    expect(fired(tx({ body: s("/js/raphael.min.js") }))).toContain("tech-gfx-raphael")
  })
  test("MathJax", () => {
    expect(fired(tx({ body: s("/mathjax/es5/tex-mml-chtml.js") }))).toContain("tech-gfx-mathjax")
  })
  test("Recharts", () => {
    expect(fired(tx({ body: s("/js/recharts.min.js") }))).toContain("tech-gfx-recharts")
  })
  test("ECharts", () => {
    expect(fired(tx({ body: s("/js/echarts.min.js") }))).toContain("tech-gfx-echarts")
  })
  test("Konva.js", () => {
    expect(fired(tx({ body: s("/js/konva.min.js") }))).toContain("tech-gfx-konva")
  })
  test("KaTeX", () => {
    expect(fired(tx({ body: s("/katex/katex.min.js") }))).toContain("tech-gfx-katex")
  })
  test("amCharts", () => {
    expect(fired(tx({ body: s("https://cdn.amcharts.com/lib/5/index.js") }))).toContain("tech-gfx-amcharts")
  })
  test("NVD3", () => {
    expect(fired(tx({ body: s("/js/nv.d3.min.js") }))).toContain("tech-gfx-nvd3")
  })
  test("jQuery Sparklines", () => {
    expect(fired(tx({ body: s("/js/jquery.sparkline.min.js") }))).toContain("tech-gfx-sparklines")
  })
  test("xCharts", () => {
    expect(fired(tx({ body: s("/js/xcharts.min.js") }))).toContain("tech-gfx-xcharts")
  })
  test("Google Charts", () => {
    expect(fired(tx({ body: '<script>google.charts.load("current", {packages:["corechart"]});</script>' }))).toContain("tech-gfx-google-charts")
  })
  test("PIXIjs", () => {
    expect(fired(tx({ body: s("/js/pixi.min.js") }))).toContain("tech-gfx-pixijs")
  })
  test("Mermaid", () => {
    expect(fired(tx({ body: s("/js/mermaid.min.js") }))).toContain("tech-gfx-mermaid")
  })
  test("Supersized", () => {
    expect(fired(tx({ body: s("/js/supersized.min.js") }))).toContain("tech-gfx-supersized")
  })
  test("CanvasJS", () => {
    expect(fired(tx({ body: s("/js/canvasjs.min.js") }))).toContain("tech-gfx-canvasjs")
  })
  test("Paper.js", () => {
    expect(fired(tx({ body: s("/js/paper-full.js") }))).toContain("tech-gfx-paperjs")
  })
  test("FusionCharts", () => {
    expect(fired(tx({ body: s("/js/fusioncharts.js") }))).toContain("tech-gfx-fusioncharts")
  })
  test("Plotly", () => {
    expect(fired(tx({ body: s("/js/plotly.min.js") }))).toContain("tech-gfx-plotly")
  })
  test("Flot", () => {
    expect(fired(tx({ body: s("/js/jquery.flot.js") }))).toContain("tech-gfx-flot")
  })
  test("AntV G2", () => {
    expect(fired(tx({ body: s("/@antv/g2/dist/g2.min.js") }))).toContain("tech-gfx-antv-g2")
  })
  test("Exhibit", () => {
    expect(fired(tx({ body: s("/api/exhibit-api.js") }))).toContain("tech-gfx-exhibit")
  })
  test("KineticJS", () => {
    expect(fired(tx({ body: s("/js/kinetic.min.js") }))).toContain("tech-gfx-kineticjs")
  })
  test("Bokeh", () => {
    expect(fired(tx({ body: s("/js/bokeh-3.1.0.min.js") }))).toContain("tech-gfx-bokeh")
  })
  test("Visx", () => {
    expect(fired(tx({ body: s("/@visx/shape/dist/index.js") }))).toContain("tech-gfx-visx")
  })
  test("jqPlot", () => {
    expect(fired(tx({ body: s("/js/jquery.jqplot.min.js") }))).toContain("tech-gfx-jqplot")
  })
  test("GoJS", () => {
    expect(fired(tx({ body: '<script>var d = new go.Diagram("myDiagramDiv"); // gojs</script>' }))).toContain("tech-gfx-gojs")
  })
  test("Kibana via header", () => {
    expect(fired(tx({ respHeaders: [["kbn-name", "kibana"]] }))).toContain("tech-gfx-kibana")
  })
  test("Spline", () => {
    expect(fired(tx({ body: s("https://unpkg.com/@splinetool/viewer/build/spline-viewer.js") }))).toContain("tech-gfx-spline")
  })
  test("JavaScript Infovis Toolkit", () => {
    expect(fired(tx({ body: '<script>var st = new $jit.ST(opts); // InfoVis</script>' }))).toContain("tech-gfx-jit")
  })
  test("Rickshaw", () => {
    expect(fired(tx({ body: s("/js/rickshaw.min.js") }))).toContain("tech-gfx-rickshaw")
  })
  test("Rive", () => {
    expect(fired(tx({ body: s("/@rive-app/canvas/rive.js") }))).toContain("tech-gfx-rive")
  })
  test("A-Frame", () => {
    expect(fired(tx({ body: '<a-scene><script src="/aframe.min.js"></script></a-scene>' }))).toContain("tech-gfx-aframe")
  })
  test("TradingView", () => {
    expect(fired(tx({ body: s("https://s3.tradingview.com/tv.js") }))).toContain("tech-gfx-tradingview")
  })
  test("Paths.js", () => {
    expect(fired(tx({ body: '<script>import { Pie } from "pathsjs";</script>' }))).toContain("tech-gfx-pathsjs")
  })
  test("Flourish", () => {
    expect(fired(tx({ body: '<div class="flourish-embed" data-src="visualisation/123"></div><script src="https://public.flourish.studio/resources/embed.js"></script>' }))).toContain("tech-gfx-flourish")
  })
  test("Babylon.js", () => {
    expect(fired(tx({ body: s("/js/babylon.min.js") }))).toContain("tech-gfx-babylonjs")
  })
  test("ZingChart", () => {
    expect(fired(tx({ body: s("/js/zingchart.min.js") }))).toContain("tech-gfx-zingchart")
  })
  test("uPlot", () => {
    expect(fired(tx({ body: s("/js/uPlot.min.js") }))).toContain("tech-gfx-uplot")
  })
  test("shine.js", () => {
    expect(fired(tx({ body: '<script>var shine = new Shine(el);</script>' }))).toContain("tech-gfx-shinejs")
  })
  test("Theatre.js", () => {
    expect(fired(tx({ body: s("/@theatre/core/dist/index.js") }))).toContain("tech-gfx-theatrejs")
  })
  test("Highstock", () => {
    expect(fired(tx({ body: s("https://code.highcharts.com/stock/highstock.js") }))).toContain("tech-gfx-highstock")
  })
  test("JS Charts", () => {
    expect(fired(tx({ body: '<script>var c = new JSChart("chart", "bar");</script>' }))).toContain("tech-gfx-jscharts")
  })
  test("Protovis", () => {
    expect(fired(tx({ body: s("/js/protovis.min.js") }))).toContain("tech-gfx-protovis")
  })
  test("Epoch", () => {
    expect(fired(tx({ body: s("/js/epoch.min.js") }))).toContain("tech-gfx-epoch")
  })
  test("TeeChart", () => {
    expect(fired(tx({ body: s("/js/teechart.js") }))).toContain("tech-gfx-teechart")
  })
  test("AntV G6", () => {
    expect(fired(tx({ body: s("/@antv/g6/dist/g6.min.js") }))).toContain("tech-gfx-antv-g6")
  })
  test("Timeplot", () => {
    expect(fired(tx({ body: s("/api/timeplot-api.js") }))).toContain("tech-gfx-timeplot")
  })
  test("Arbor.js", () => {
    expect(fired(tx({ body: s("/js/arbor.js") }))).toContain("tech-gfx-arborjs")
  })
  test("LocalFocus", () => {
    expect(fired(tx({ body: s("https://flo.localfocus.nl/embed.js") }))).toContain("tech-gfx-localfocus")
  })

  // --- Structural ---
  test("a plain page triggers no graphics rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })
  test("all rule IDs start with tech-gfx-", () => {
    for (const r of jsGraphicsRules) expect(r.id).toMatch(/^tech-gfx-/)
  })
  test("all rules have js-graphics tag", () => {
    for (const r of jsGraphicsRules) expect(r.tags).toContain("js-graphics")
  })
  test("rule count is 56", () => {
    expect(jsGraphicsRules.length).toBe(56)
  })
})
