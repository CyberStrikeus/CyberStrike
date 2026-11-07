import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, cdnRules } from "../src/index"

const rules = compileRules(cdnRules)
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

describe("CDN fingerprint rules", () => {
  // --- Major CDNs ---
  test("Cloudflare via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "cloudflare"]] }))).toContain("tech-cdn-cloudflare")
  })

  test("jsDelivr via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.jsdelivr.net/npm/vue@3"></script>' }))).toContain("tech-cdn-jsdelivr")
  })

  test("cdnjs via body", () => {
    expect(fired(tx({ body: '<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>' }))).toContain("tech-cdn-cdnjs")
  })

  test("Google Cloud CDN via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Google Frontend"]] }))).toContain("tech-cdn-google-cloud")
  })

  test("Google Cloud CDN via via header", () => {
    expect(fired(tx({ respHeaders: [["via", "1.1 google"]] }))).toContain("tech-cdn-google-cloud")
  })

  test("Google Hosted Libraries via body", () => {
    expect(fired(tx({ body: '<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>' }))).toContain("tech-cdn-google-hosted-libs")
  })

  test("Amazon CloudFront via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "CloudFront"]] }))).toContain("tech-cdn-cloudfront")
  })

  test("Amazon CloudFront via x-amz-cf-id header", () => {
    expect(fired(tx({ respHeaders: [["x-amz-cf-id", "abc123"]] }))).toContain("tech-cdn-cloudfront")
  })

  test("Amazon S3 via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "AmazonS3"]] }))).toContain("tech-cdn-s3")
  })

  test("Amazon S3 via x-amz-request-id header", () => {
    expect(fired(tx({ respHeaders: [["x-amz-request-id", "abc123"]] }))).toContain("tech-cdn-s3")
  })

  test("Hostinger CDN via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "hostinger"]] }))).toContain("tech-cdn-hostinger")
  })

  test("jQuery CDN via body", () => {
    expect(fired(tx({ body: '<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>' }))).toContain("tech-cdn-jquery")
  })

  test("Unpkg via body", () => {
    expect(fired(tx({ body: '<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>' }))).toContain("tech-cdn-unpkg")
  })

  // --- Mid-tier CDNs ---
  test("Netlify via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Netlify"]] }))).toContain("tech-cdn-netlify")
  })

  test("Netlify via x-nf-request-id header", () => {
    expect(fired(tx({ respHeaders: [["x-nf-request-id", "abc123"]] }))).toContain("tech-cdn-netlify")
  })

  test("Fastly via x-fastly-request-id header", () => {
    expect(fired(tx({ respHeaders: [["x-fastly-request-id", "abc123"]] }))).toContain("tech-cdn-fastly")
  })

  test("Fastly via x-served-by header", () => {
    expect(fired(tx({ respHeaders: [["x-served-by", "cache-iad-kiad7000123"]] }))).toContain("tech-cdn-fastly")
  })

  test("Bunny via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "BunnyCDN"]] }))).toContain("tech-cdn-bunny")
  })

  test("Bunny via cdn-pullzone header", () => {
    expect(fired(tx({ respHeaders: [["cdn-pullzone", "123456"]] }))).toContain("tech-cdn-bunny")
  })

  test("Akamai via x-akamai-transformed header", () => {
    expect(fired(tx({ respHeaders: [["x-akamai-transformed", "9 - 0 pmb=mNONE,1"]] }))).toContain("tech-cdn-akamai")
  })

  test("StackPath via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "NetDNA-cache/2.2"]] }))).toContain("tech-cdn-stackpath")
  })

  test("Cloudinary via body", () => {
    expect(fired(tx({ body: '<img src="https://res.cloudinary.com/demo/image/upload/sample.jpg">' }))).toContain("tech-cdn-cloudinary")
  })

  test("Microsoft Ajax CDN via body", () => {
    expect(fired(tx({ body: '<script src="https://ajax.aspnetcdn.com/ajax/jQuery/jquery-3.7.1.min.js"></script>' }))).toContain("tech-cdn-microsoft-ajax")
  })

  test("ArvanCloud via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "ArvanCloud"]] }))).toContain("tech-cdn-arvancloud")
  })

  test("ArvanCloud via ar-atime header", () => {
    expect(fired(tx({ respHeaders: [["ar-atime", "123"]] }))).toContain("tech-cdn-arvancloud")
  })

  test("Imgix via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "imgix"]] }))).toContain("tech-cdn-imgix")
  })

  test("Alibaba Cloud CDN via server header (Tengine)", () => {
    expect(fired(tx({ respHeaders: [["server", "Tengine/2.3.3"]] }))).toContain("tech-cdn-alibaba")
  })

  test("Alibaba Cloud CDN via eagleid header", () => {
    expect(fired(tx({ respHeaders: [["eagleid", "abc123"]] }))).toContain("tech-cdn-alibaba")
  })

  test("DigitalOcean Spaces via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "DigitalOceanSpaces"]] }))).toContain("tech-cdn-digitalocean-spaces")
  })

  // --- Smaller / Regional CDNs ---
  test("RawGit via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.rawgit.com/user/repo/v1/dist/lib.js"></script>' }))).toContain("tech-cdn-rawgit")
  })

  test("QUIC.cloud via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "QUIC.cloud"]] }))).toContain("tech-cdn-quiccloud")
  })

  test("QUIC.cloud via x-qc-pop header", () => {
    expect(fired(tx({ respHeaders: [["x-qc-pop", "IAD"]] }))).toContain("tech-cdn-quiccloud")
  })

  test("GoCache via x-gocache-status header", () => {
    expect(fired(tx({ respHeaders: [["x-gocache-status", "HIT"]] }))).toContain("tech-cdn-gocache")
  })

  test("Uploadcare via body", () => {
    expect(fired(tx({ body: '<img src="https://ucarecdn.com/abc123/-/resize/800x/">' }))).toContain("tech-cdn-uploadcare")
  })

  test("Section.io via section-io-id header", () => {
    expect(fired(tx({ respHeaders: [["section-io-id", "abc123"]] }))).toContain("tech-cdn-section-io")
  })

  test("Filestack via body", () => {
    expect(fired(tx({ body: '<img src="https://cdn.filestackcontent.com/abc123">' }))).toContain("tech-cdn-filestack")
  })

  test("EdgeOne via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "EdgeOne"]] }))).toContain("tech-cdn-edgeone")
  })

  test("Sotoon via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Sotoon"]] }))).toContain("tech-cdn-sotoon")
  })

  test("Yandex Cloud CDN via body", () => {
    expect(fired(tx({ body: '<script src="https://yastatic.net/s3/cdn/wdio.js"></script>' }))).toContain("tech-cdn-yandex")
  })

  test("CreateJS via body", () => {
    expect(fired(tx({ body: '<script src="https://code.createjs.com/1.0.0/createjs.min.js"></script>' }))).toContain("tech-cdn-createjs")
  })

  test("Cloudimage via body", () => {
    expect(fired(tx({ body: '<img src="https://aaa.cloudimg.io/v7/img.jpg">' }))).toContain("tech-cdn-cloudimage")
  })

  test("CDN77 via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "CDN77-Turbo"]] }))).toContain("tech-cdn-cdn77")
  })

  test("MizbanCloud via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "MizbanCloud"]] }))).toContain("tech-cdn-mizbancloud")
  })

  test("Acquia via x-ah-environment header", () => {
    expect(fired(tx({ respHeaders: [["x-ah-environment", "prod"]] }))).toContain("tech-cdn-acquia")
  })

  test("Statically via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.statically.io/gh/user/repo/main/file.js"></script>' }))).toContain("tech-cdn-statically")
  })

  test("Gcore via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Gcore"]] }))).toContain("tech-cdn-gcore")
  })

  test("TwicPics via body", () => {
    expect(fired(tx({ body: '<img src="https://demo.twicpics.com/img.jpg">' }))).toContain("tech-cdn-twicpics")
  })

  test("Tencent Cloud via x-nws-log-uuid header", () => {
    expect(fired(tx({ respHeaders: [["x-nws-log-uuid", "abc123"]] }))).toContain("tech-cdn-tencent-cloud")
  })

  test("ImageEngine via body", () => {
    expect(fired(tx({ body: '<img src="https://images.imageengine.io/img.jpg">' }))).toContain("tech-cdn-imageengine")
  })

  test("Azion via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Azion"]] }))).toContain("tech-cdn-azion")
  })

  test("CacheFly via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "CacheFly"]] }))).toContain("tech-cdn-cachefly")
  })

  test("Gatsby Image CDN via body", () => {
    expect(fired(tx({ body: '<img src="/_gatsby/image/abc123" data-gatsby-image-cdn>' }))).toContain("tech-cdn-gatsby-image")
  })

  test("Nsin via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Nsin"]] }))).toContain("tech-cdn-nsin")
  })

  test("Azure CDN via x-azure-ref header", () => {
    expect(fired(tx({ respHeaders: [["x-azure-ref", "abc123"]] }))).toContain("tech-cdn-azure")
  })

  test("Fireblade via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Fireblade"]] }))).toContain("tech-cdn-fireblade")
  })

  test("GuardFlame via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "GuardFlame"]] }))).toContain("tech-cdn-guardflame")
  })

  test("Orange CDB via x-cdn header", () => {
    expect(fired(tx({ respHeaders: [["x-cdn", "Orange"]] }))).toContain("tech-cdn-orange")
  })

  test("VergeCloud via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "VergeCloud"]] }))).toContain("tech-cdn-vergecloud")
  })

  test("5centsCDN via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "5centsCDN"]] }))).toContain("tech-cdn-5centscdn")
  })

  test("GotiPath via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "GotiPath"]] }))).toContain("tech-cdn-gotipath")
  })

  test("DERAK.CLOUD via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "DERAK"]] }))).toContain("tech-cdn-derak")
  })

  test("MaxCDN via x-cdn header", () => {
    expect(fired(tx({ respHeaders: [["x-cdn", "MaxCDN"]] }))).toContain("tech-cdn-maxcdn")
  })

  test("Arc via body", () => {
    expect(fired(tx({ body: '<script src="https://cdn.arc.io/widget.js"></script>' }))).toContain("tech-cdn-arc")
  })

  test("DigiCDN via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "DigiCDN"]] }))).toContain("tech-cdn-digicdn")
  })

  test("KuronekoServer via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "KuronekoServer"]] }))).toContain("tech-cdn-kuroneko")
  })

  test("Airee via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Airee"]] }))).toContain("tech-cdn-airee")
  })

  test("Powa via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Powa"]] }))).toContain("tech-cdn-powa")
  })

  test("KelonCloud via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "KelonCloud"]] }))).toContain("tech-cdn-keloncloud")
  })

  test("EdgeCast via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "ECS (iad/1234)"]] }))).toContain("tech-cdn-edgecast")
  })

  test("UpCloud via body", () => {
    expect(fired(tx({ body: '<img src="https://objects.upcloud.com/bucket/img.jpg">' }))).toContain("tech-cdn-upcloud")
  })

  test("Edgio via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "Edgio"]] }))).toContain("tech-cdn-edgio")
  })

  test("Edgio via x-edg-mr header", () => {
    expect(fired(tx({ respHeaders: [["x-edg-mr", "abc"]] }))).toContain("tech-cdn-edgio")
  })

  // --- Structural ---
  test("a plain page triggers no CDN rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-cdn-", () => {
    for (const r of cdnRules) expect(r.id).toMatch(/^tech-cdn-/)
  })

  test("all rules have cdn tag", () => {
    for (const r of cdnRules) expect(r.tags).toContain("cdn")
  })

  test("rule count is 62", () => {
    expect(cdnRules.length).toBe(62)
  })
})
