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

  // --- Fraud / Risk (continued) ---
  test("Riskified", () => {
    expect(fired(tx({ body: '<script src="https://beacon.riskified.com/beacon.js"></script>' }))).toContain("tech-riskified")
  })

  test("NoFraud", () => {
    expect(fired(tx({ body: '<script src="https://cdn.nofraud.com/js/nf.js"></script>' }))).toContain("tech-nofraud")
  })

  test("Seon", () => {
    expect(fired(tx({ body: '<script src="https://cdn.seon.io/js/seon-sdk.js"></script>' }))).toContain("tech-seon")
  })

  test("ThreatMetrix", () => {
    expect(fired(tx({ body: '<script src="https://h.online-metrix.net/fp/tags.js"></script>' }))).toContain("tech-threatmetrix")
  })

  test("Konduto", () => {
    expect(fired(tx({ body: "Konduto.init({ publicKey: 'abc' })" }))).toContain("tech-konduto")
  })

  test("Kount", () => {
    expect(fired(tx({ body: '<script src="https://ka.kount.net/collect/sdk.js"></script>' }))).toContain("tech-kount")
  })

  test("Sardine", () => {
    expect(fired(tx({ body: '<script src="https://cdn.sardine.ai/sdk.js"></script>' }))).toContain("tech-sardine")
  })

  test("BuySafe", () => {
    expect(fired(tx({ body: '<script src="https://seal.buysafe.com/guarantee.js"></script>' }))).toContain("tech-buysafe")
  })

  test("FraudLabs Pro", () => {
    expect(fired(tx({ body: '<script src="https://cdn.fraudlabspro.com/s.js"></script>' }))).toContain("tech-fraudlabs-pro")
  })

  test("Covery", () => {
    expect(fired(tx({ body: '<script src="https://cdn.covery.ai/covery-sdk.js"></script>' }))).toContain("tech-covery")
  })

  test("Accertify", () => {
    expect(fired(tx({ body: '<script src="https://cdn.accertify.com/accertify-sdk.js"></script>' }))).toContain("tech-accertify")
  })

  test("SecureMetrics", () => {
    expect(fired(tx({ body: '<script src="https://cdn.securemetrics.com/sm.js"></script>' }))).toContain("tech-securemetrics")
  })

  test("Norton Shopping Guarantee", () => {
    expect(fired(tx({ body: '<script src="https://norton.com/shopping-guarantee/seal.js"></script>' }))).toContain("tech-norton-shopping")
  })

  // --- CAPTCHAs (continued) ---
  test("Slider Captcha", () => {
    expect(fired(tx({ body: '<script src="/js/slidercaptcha.js"></script>' }))).toContain("tech-slider-captcha")
  })

  test("AWS WAF Captcha via body", () => {
    expect(fired(tx({ body: '<script src="https://awswaf.com/captcha/challenge.js"></script>' }))).toContain("tech-aws-waf-captcha")
  })

  test("AWS WAF Captcha via header", () => {
    expect(fired(tx({ respHeaders: [["x-amzn-waf-action", "captcha"]] }))).toContain("tech-aws-waf-captcha")
  })

  test("MTCaptcha", () => {
    expect(fired(tx({ body: '<script src="https://service.mtcaptcha.com/mtcaptcha.min.js"></script>' }))).toContain("tech-mtcaptcha")
  })

  test("Tencent Captcha", () => {
    expect(fired(tx({ body: '<script src="https://ssl.captcha.qq.com/TCaptcha.js"></script>' }))).toContain("tech-tencent-captcha")
  })

  test("Alibaba Captcha", () => {
    expect(fired(tx({ body: '<script src="https://g.alicdn.com/sd/nvc/1.1.112/guide.js"></script>' }))).toContain("tech-alibaba-captcha")
  })

  test("ARCaptcha", () => {
    expect(fired(tx({ body: '<script src="https://arcaptcha.ir/widget.js"></script>' }))).toContain("tech-arcaptcha")
  })

  test("VAPTCHA", () => {
    expect(fired(tx({ body: '<script src="https://cdn.vaptcha.com/v3.js"></script>' }))).toContain("tech-vaptcha")
  })

  // --- WAFs / Server Security ---
  test("Fortinet FortiGate via server header", () => {
    expect(fired(tx({ respHeaders: [["server", "FortiGate"]] }))).toContain("tech-fortinet-fortigate")
  })

  test("Fortinet FortiGate via x-fortigate-id header", () => {
    expect(fired(tx({ respHeaders: [["x-fortigate-id", "FGT60F123"]] }))).toContain("tech-fortinet-fortigate")
  })

  test("Imunify360", () => {
    expect(fired(tx({ body: '<div class="imunify360-captcha">' }))).toContain("tech-imunify360")
  })

  test("Cloud Guard", () => {
    expect(fired(tx({ body: '<script src="https://cloudguard.com/agent.js"></script>' }))).toContain("tech-cloud-guard")
  })

  test("WAR.PE", () => {
    expect(fired(tx({ respHeaders: [["server", "war.pe"]] }))).toContain("tech-war-pe")
  })

  // --- WordPress Security (continued) ---
  test("SiteGuard WP Plugin", () => {
    expect(fired(tx({ body: '<link rel="stylesheet" href="/wp-content/plugins/siteguard/css/login.css">' }))).toContain("tech-siteguard-wp")
  })

  test("Limit Login Attempts Reloaded", () => {
    expect(fired(tx({ body: '<script src="/wp-content/plugins/limit-login-attempts-reloaded/js/main.js"></script>' }))).toContain("tech-limit-login-attempts")
  })

  test("AntiBot.Cloud", () => {
    expect(fired(tx({ body: '<script src="https://antibot.cloud/abc_challenge.js"></script>' }))).toContain("tech-antibot-cloud")
  })

  // --- Auth protocols ---
  test("SPNEGO via WWW-Authenticate", () => {
    expect(fired(tx({ respHeaders: [["www-authenticate", "Negotiate"]] }))).toContain("tech-spnego")
  })

  test("NTLM via WWW-Authenticate", () => {
    expect(fired(tx({ respHeaders: [["www-authenticate", "NTLM"]] }))).toContain("tech-ntlm")
  })

  test("Digest auth via WWW-Authenticate", () => {
    expect(fired(tx({ respHeaders: [["www-authenticate", 'Digest realm="app", nonce="abc"']] }))).toContain("tech-digest-auth")
  })

  // --- JS Protection / Obfuscation ---
  test("Jscrambler", () => {
    expect(fired(tx({ body: '<script src="https://cdn.jscrambler.com/client.js"></script>' }))).toContain("tech-jscrambler")
  })

  test("FUGU", () => {
    expect(fired(tx({ body: '<script src="https://cdn.fugu.io/fugu-beacon.js"></script>' }))).toContain("tech-fugu")
  })

  // --- Misc ---
  test("Blue Triangle", () => {
    expect(fired(tx({ body: '<script src="https://d.btttag.com/btt.js"></script>' }))).toContain("tech-blue-triangle")
  })

  test("SafeBase", () => {
    expect(fired(tx({ body: '<script src="https://cdn.safebase.io/widget.js"></script>' }))).toContain("tech-safebase")
  })

  test("Kiprotect (Klaro)", () => {
    expect(fired(tx({ body: '<script src="https://cdn.kiprotect.com/klaro/latest/klaro.js"></script>' }))).toContain("tech-kiprotect")
  })

  test("Negate", () => {
    expect(fired(tx({ body: '<script src="https://negate.bot/sdk.js"></script>' }))).toContain("tech-negate")
  })

  test("SnapHost", () => {
    expect(fired(tx({ body: '<script src="https://cdn.snaphost.com/snaphost-widget.js"></script>' }))).toContain("tech-snaphost")
  })

  test("Bugcrowd", () => {
    expect(fired(tx({ body: '<script src="https://bugcrowd.com/embed.js"></script>' }))).toContain("tech-bugcrowd")
  })

  test("Proxmox Mail Gateway", () => {
    expect(fired(tx({ respHeaders: [["server", "proxmox"]] }))).toContain("tech-proxmox-mail-gw")
  })

  // --- Privacy / Compliance ---
  test("privIQ", () => {
    expect(fired(tx({ body: '<script src="https://cdn.priviq.com/priviq-consent.js"></script>' }))).toContain("tech-priviq")
  })

  test("Drata", () => {
    expect(fired(tx({ body: '<script src="https://cdn.drata.com/drata-trust.js"></script>' }))).toContain("tech-drata")
  })

  test("Dataships", () => {
    expect(fired(tx({ body: '<script src="https://cdn.dataships.io/dataships-consent.js"></script>' }))).toContain("tech-dataships")
  })

  test("Vanta", () => {
    expect(fired(tx({ body: '<script src="https://cdn.vanta.com/vanta-trust.js"></script>' }))).toContain("tech-vanta")
  })

  test("Skyflow", () => {
    expect(fired(tx({ body: '<script src="https://cdn.skyflow.com/skyflow-sdk.js"></script>' }))).toContain("tech-skyflow")
  })

  // --- Auth / Identity (continued) ---
  test("Hanko", () => {
    expect(fired(tx({ body: "<hanko-auth api=\"https://auth.hanko.io\"></hanko-auth>" }))).toContain("tech-hanko")
  })

  test("Token of Trust", () => {
    expect(fired(tx({ body: '<script src="https://cdn.tokenoftrust.com/token-of-trust.js"></script>' }))).toContain("tech-token-of-trust")
  })

  test("Regula", () => {
    expect(fired(tx({ body: '<script src="https://cdn.regulaforensics.com/regula-sdk.js"></script>' }))).toContain("tech-regula")
  })

  test("Kerberos via WWW-Authenticate", () => {
    expect(fired(tx({ respHeaders: [["www-authenticate", "Kerberos"]] }))).toContain("tech-kerberos")
  })

  // --- CAPTCHAs (continued) ---
  test("Mollom", () => {
    expect(fired(tx({ body: '<div class="mollom-captcha" id="mollom"></div>' }))).toContain("tech-mollom")
  })

  test("adCAPTCHA", () => {
    expect(fired(tx({ body: '<script src="https://cdn.adcaptcha.com/adcaptcha-widget.js"></script>' }))).toContain("tech-adcaptcha")
  })

  test("Solve Media", () => {
    expect(fired(tx({ body: '<script src="https://api.solvemedia.com/papi/challenge.script"></script>' }))).toContain("tech-solve-media")
  })

  test("CoinHive Captcha", () => {
    expect(fired(tx({ body: '<script src="https://authedmine.com/lib/captcha.min.js"></script>' }))).toContain("tech-coinhive-captcha")
  })

  test("Picatcha", () => {
    expect(fired(tx({ body: '<script src="https://cdn.picatcha.com/picatcha-widget.js"></script>' }))).toContain("tech-picatcha")
  })

  // --- WAF / DDoS Protection (continued) ---
  test("RapidSec", () => {
    expect(fired(tx({ body: '<script src="https://cdn.rapidsec.com/rapidsec-csp.js"></script>' }))).toContain("tech-rapidsec")
  })

  test("Preeco", () => {
    expect(fired(tx({ body: '<script src="https://cdn.preeco.io/preeco-shield.js"></script>' }))).toContain("tech-preeco")
  })

  test("TMW Shield", () => {
    expect(fired(tx({ respHeaders: [["server", "tmw-shield"]] }))).toContain("tech-tmw-shield")
  })

  test("Combahton FlowShield", () => {
    expect(fired(tx({ respHeaders: [["server", "flowshield"]] }))).toContain("tech-combahton-flowshield")
  })

  test("BudgetGuard", () => {
    expect(fired(tx({ body: '<script src="https://cdn.budgetguard.io/BudgetGuard.js"></script>' }))).toContain("tech-budgetguard")
  })

  // --- Fraud / Risk (continued) ---
  test("ClickReport", () => {
    expect(fired(tx({ body: '<script src="https://cdn.clickreport.com/cr.js"></script>' }))).toContain("tech-clickreport")
  })

  test("Clear", () => {
    expect(fired(tx({ body: '<script src="https://clear.co/sdk/ClearSDK.js"></script>' }))).toContain("tech-clear")
  })

  test("Apruvd", () => {
    expect(fired(tx({ body: '<script src="https://cdn.apruvd.com/apruvd-sdk.js"></script>' }))).toContain("tech-apruvd")
  })

  test("NorthWhistle", () => {
    expect(fired(tx({ body: '<script src="https://cdn.northwhistle.com/nw.js"></script>' }))).toContain("tech-northwhistle")
  })

  // --- Client-side Security ---
  test("c/side", () => {
    expect(fired(tx({ body: '<script src="https://cdn.c-side.dev/cside-monitor.js"></script>' }))).toContain("tech-cside")
  })

  test("Sqreen via header", () => {
    expect(fired(tx({ respHeaders: [["x-sqreen-id", "abc123"]] }))).toContain("tech-sqreen")
  })

  test("Human Presence", () => {
    expect(fired(tx({ body: '<script src="https://cdn.humanpresence.io/human-presence.js"></script>' }))).toContain("tech-human-presence")
  })

  // --- Hardware / Crypto ---
  test("Trezor Connect", () => {
    expect(fired(tx({ body: '<script src="https://connect.trezor.io/9/trezor-connect.js"></script>' }))).toContain("tech-trezor")
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

  test("rule count is 106", () => {
    expect(securityRules.length).toBe(106)
  })
})
