import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, securityRules } from "../src/index"

const rules = compileRules(securityRules)
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

describe("security & bot-management fingerprint rules", () => {
  // --- CAPTCHAs ---
  test("reCAPTCHA", () => {
    expect(fired(tx({ body: '<script src="https://www.google.com/recaptcha/api.js"></script>' }))).toContain("tech-recaptcha")
    expect(fired(tx({ body: '<div class="g-recaptcha" data-sitekey="abc">' }))).toContain("tech-recaptcha")
  })

  test("hCaptcha", () => {
    expect(fired(tx({ body: '<script src="https://hcaptcha.com/1/api.js"></script>' }))).toContain("tech-hcaptcha")
  })

  test("Cloudflare Turnstile", () => {
    expect(fired(tx({ body: '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>' }))).toContain("tech-cf-turnstile")
    expect(fired(tx({ body: '<div class="cf-turnstile" data-sitekey="0x4">' }))).toContain("tech-cf-turnstile")
  })

  test("Friendly Captcha", () => {
    expect(fired(tx({ body: '<div class="frc-captcha" data-sitekey="abc">' }))).toContain("tech-friendly-captcha")
  })

  test("Yandex SmartCaptcha", () => {
    expect(fired(tx({ body: '<script src="https://smartcaptcha.yandexcloud.net/captcha.js"></script>' }))).toContain("tech-yandex-smartcaptcha")
  })

  test("Altcha", () => {
    expect(fired(tx({ body: "<altcha-widget challengeurl='https://example.com'></altcha-widget>" }))).toContain("tech-altcha")
  })

  test("GeeTest", () => {
    expect(fired(tx({ body: "initGeetest({ product: 'bind' })" }))).toContain("tech-geetest")
  })

  test("Arkose Labs (FunCaptcha)", () => {
    expect(fired(tx({ body: '<script src="https://client-api.arkoselabs.com/v2/api.js">' }))).toContain("tech-arkose-labs")
  })

  test("CleanTalk", () => {
    expect(fired(tx({ body: '<script src="https://moderate.cleantalk.org/ct-check.js"></script>' }))).toContain("tech-cleantalk")
  })

  test("Basic Captcha", () => {
    expect(fired(tx({ body: '<script src="https://basiccaptcha.com/widget.js">' }))).toContain("tech-basic-captcha")
  })

  // --- CDN / Edge WAFs ---
  test("Cloudflare Bot Management via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "__cf_bm=abc123; Path=/"]] }))).toContain("tech-cf-bot-mgmt")
  })

  test("Cloudflare Bot Management via cf-ray header", () => {
    expect(fired(tx({ respHeaders: [["cf-ray", "abc123-IAD"]] }))).toContain("tech-cf-bot-mgmt")
  })

  test("Akamai Bot Manager via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "_abck=abc123; Path=/"]] }))).toContain("tech-akamai-bot-mgr")
  })

  test("Akamai WAP via header", () => {
    expect(fired(tx({ respHeaders: [["server", "AkamaiGHost"]] }))).toContain("tech-akamai-wap")
  })

  test("Imperva/Incapsula via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "incap_ses_123=abc; Path=/"]] }))).toContain("tech-imperva")
  })

  test("DDoS-Guard via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "ddos-guard"]] }))).toContain("tech-ddos-guard")
  })

  test("DataDome via body", () => {
    expect(fired(tx({ body: '<script src="https://js.datadome.co/tags.js"></script>' }))).toContain("tech-datadome")
  })

  test("PerimeterX via cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "_pxhd=abc123; Path=/"]] }))).toContain("tech-perimeterx")
  })

  test("Kasada via header", () => {
    expect(fired(tx({ respHeaders: [["x-kpsdk-ct", "abc123"]] }))).toContain("tech-kasada")
  })

  // --- WordPress Security ---
  test("Wordfence", () => {
    expect(fired(tx({ body: '<script src="/wp-content/plugins/wordfence/js/wf-scan-monitor.js">' }))).toContain("tech-wordfence")
  })

  test("Wordfence Login Security", () => {
    expect(fired(tx({ body: '<script src="/wp-content/plugins/wordfence-login-security/js/wfls-main.js">' }))).toContain("tech-wordfence-login")
  })

  test("Sucuri", () => {
    expect(fired(tx({ respHeaders: [["x-sucuri-id", "abc"]] }))).toContain("tech-sucuri")
  })

  test("iThemes Security", () => {
    expect(fired(tx({ body: '<link rel="stylesheet" href="/wp-content/plugins/better-wp-security/core/modules/file-change/css/admin.css">' }))).toContain("tech-ithemes-security")
  })

  test("SiteLock", () => {
    expect(fired(tx({ body: '<script src="https://shield.sitelock.com/shield/app.test"></script>' }))).toContain("tech-sitelock")
  })

  // --- Fraud Prevention ---
  test("Sift", () => {
    expect(fired(tx({ body: '<script src="https://cdn.sift.com/s.js"></script>' }))).toContain("tech-sift")
  })

  test("Forter", () => {
    expect(fired(tx({ body: '<script src="https://cdn.forter.com/script.js"></script>' }))).toContain("tech-forter")
  })

  test("Signifyd", () => {
    expect(fired(tx({ body: '<script src="https://cdn-scripts.signifyd.com/api/script-tag.js"></script>' }))).toContain("tech-signifyd")
  })

  test("ClickCease", () => {
    expect(fired(tx({ body: '<script src="https://monitor.clickcease.com/tracker/tracker.js"></script>' }))).toContain("tech-clickcease")
  })

  test("Fraud Blocker", () => {
    expect(fired(tx({ body: '<script src="https://cdn.fraudblocker.com/primary.js"></script>' }))).toContain("tech-fraud-blocker")
  })

  test("TruValidate (iovation)", () => {
    expect(fired(tx({ body: '<script src="https://mpsnare.iesnare.com/iojs/js/iojs.js"></script>' }))).toContain("tech-truvalidate")
  })

  test("Botfaqtor", () => {
    expect(fired(tx({ body: '<script src="https://botfaqtor.com/detect.js"></script>' }))).toContain("tech-botfaqtor")
  })

  // --- Privacy / Security Scanning ---
  test("Confiant", () => {
    expect(fired(tx({ body: '<script src="https://cdn.confiant-integrations.net/confiant.js"></script>' }))).toContain("tech-confiant")
  })

  test("Very Good Security", () => {
    expect(fired(tx({ body: '<script src="https://js.verygoodvault.com/vgs-collect/2.0/vgs-collect.js"></script>' }))).toContain("tech-vgs")
  })

  test("Securiti", () => {
    expect(fired(tx({ body: '<script src="https://cdn.securiti.ai/consent/cookie-consent-sdk-loader.js"></script>' }))).toContain("tech-securiti")
  })

  test("DataGrail", () => {
    expect(fired(tx({ body: '<script src="https://cdn.datagrail.io/sdk/dg.js"></script>' }))).toContain("tech-datagrail")
  })

  test("Detectify", () => {
    expect(fired(tx({ respHeaders: [["x-detectify-id", "abc"]] }))).toContain("tech-detectify")
  })

  test("ComplyAuto", () => {
    expect(fired(tx({ body: '<script src="https://cdn.complyauto.com/widget.js"></script>' }))).toContain("tech-complyauto")
  })

  // --- Misc Bot Protection ---
  test("Blankshield", () => {
    expect(fired(tx({ body: '<script src="/js/blankshield.min.js"></script>' }))).toContain("tech-blankshield")
  })

  test("Anubis (PoW challenge)", () => {
    expect(fired(tx({ body: "Anubis is checking your browser. Proof of Work challenge" }))).toContain("tech-anubis")
  })

  test("Variti", () => {
    expect(fired(tx({ respHeaders: [["server", "variti"]] }))).toContain("tech-variti")
  })

  test("Keybase verification", () => {
    expect(fired(tx({ body: '<link rel="me" href="https://keybase.io/verify?user=testuser">' }))).toContain("tech-keybase")
  })

  // --- Structural ---
  test("a plain page triggers no security rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-", () => {
    for (const r of securityRules) expect(r.id).toMatch(/^tech-/)
  })

  test("all rules have security tag", () => {
    for (const r of securityRules) expect(r.tags).toContain("security")
  })

  test("rule count is 40", () => {
    expect(securityRules.length).toBe(40)
  })
})
