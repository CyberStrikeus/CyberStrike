import { describe, expect, test } from "bun:test"
import type { Transaction } from "../src/index"
import { compileRules, authProviderRules } from "../src/index"

const rules = compileRules(authProviderRules)
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

describe("auth-provider fingerprint rules", () => {
  // --- Social / OAuth ---
  test("facebook login SDK", () => {
    expect(fired(tx({ body: '<script src="https://connect.facebook.net/en_US/sdk.js"></script>' }))).toContain("tech-facebook-login")
    expect(fired(tx({ body: "window.fbAsyncInit = function() {" }))).toContain("tech-facebook-login")
  })

  test("google sign-in (GIS)", () => {
    expect(fired(tx({ body: '<script src="https://accounts.google.com/gsi/client"></script>' }))).toContain("tech-google-signin")
    expect(fired(tx({ body: '<div id="g_id_onload" data-client_id="abc.apps.googleusercontent.com">' }))).toContain("tech-google-signin")
  })

  test("apple sign-in", () => {
    expect(fired(tx({ body: '<script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js">' }))).toContain("tech-apple-signin")
    expect(fired(tx({ body: '<div id="appleid-signin" data-mode="center-align">' }))).toContain("tech-apple-signin")
  })

  test("linkedin sign-in", () => {
    expect(fired(tx({ body: 'redirect_uri=https://example.com&response_type=code" href="https://linkedin.com/oauth/v2/authorization"' }))).toContain("tech-linkedin-signin")
  })

  test("amazon login", () => {
    expect(fired(tx({ body: '<script src="https://api-cdn.amazon.com/sdk/login1.js"></script>' }))).toContain("tech-amazon-login")
  })

  test("line login", () => {
    expect(fired(tx({ body: 'https://access.line.me/oauth2/v2.1/authorize?client_id=123' }))).toContain("tech-line-login")
  })

  // --- Auth platforms ---
  test("nextauth via set-cookie", () => {
    expect(fired(tx({ respHeaders: [["set-cookie", "next-auth.session-token=abc123; Path=/; HttpOnly"]] }))).toContain("tech-nextauth")
  })

  test("nextauth via body", () => {
    expect(fired(tx({ body: '<a href="/api/auth/signin">Sign in</a>' }))).toContain("tech-nextauth")
  })

  test("okta widget", () => {
    expect(fired(tx({ body: '<script src="https://global.oktacdn.com/okta-signin-widget/5.0/js/okta-sign-in.min.js">' }))).toContain("tech-okta")
    expect(fired(tx({ body: 'new OktaAuth({ issuer: "https://dev-12345.okta.com/oauth2/default" })' }))).toContain("tech-okta")
  })

  test("clerk", () => {
    expect(fired(tx({ body: '<script src="https://cdn.clerk.com/npm/@clerk/clerk-js@latest/dist/clerk.browser.js">' }))).toContain("tech-clerk")
    expect(fired(tx({ respHeaders: [["set-cookie", "__clerk_db_jwt=eyJhbGc; Path=/"]] }))).toContain("tech-clerk")
  })

  test("auth0", () => {
    expect(fired(tx({ body: '<script src="https://cdn.auth0.com/js/auth0/9.18/auth0.min.js">' }))).toContain("tech-auth0")
    expect(fired(tx({ body: "var lock = new Auth0Lock('clientID', 'tenant.auth0.com')" }))).toContain("tech-auth0")
  })

  test("cognito", () => {
    expect(fired(tx({ body: "new CognitoIdentityServiceProvider({ region: 'us-east-1' })" }))).toContain("tech-cognito")
    expect(fired(tx({ body: 'https://cognito-idp.us-east-1.amazonaws.com' }))).toContain("tech-cognito")
  })

  test("azure ad b2c", () => {
    expect(fired(tx({ body: 'https://myapp.b2clogin.com/myapp.onmicrosoft.com/oauth2/v2.0/authorize' }))).toContain("tech-azure-ad-b2c")
  })

  test("microsoft auth (MSAL)", () => {
    expect(fired(tx({ body: '<script src="https://alcdn.msauth.net/browser/2.30.0/js/msal-browser.min.js">' }))).toContain("tech-microsoft-auth")
    expect(fired(tx({ body: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' }))).toContain("tech-microsoft-auth")
  })

  // --- Enterprise SSO ---
  test("simplesamlphp", () => {
    expect(fired(tx({ body: '<a href="/simplesaml/module.php/core/loginuserpass.php">' }))).toContain("tech-simplesamlphp")
    expect(fired(tx({ respHeaders: [["set-cookie", "SimpleSAMLSessionID=abc; Path=/"]] }))).toContain("tech-simplesamlphp")
  })

  test("apereo CAS", () => {
    expect(fired(tx({ body: '<form action="/cas/login?service=https://app.test">' }))).toContain("tech-apereo-cas")
  })

  test("jumpcloud", () => {
    expect(fired(tx({ body: 'https://sso.jumpcloud.com/saml2/myapp' }))).toContain("tech-jumpcloud")
  })

  // --- Identity verification ---
  test("onfido", () => {
    expect(fired(tx({ body: '<script src="https://sdk.onfido.com/v13"></script><script>Onfido.init({' }))).toContain("tech-onfido")
  })

  test("passage (passkey)", () => {
    expect(fired(tx({ body: '<passage-auth app-id="abc123"></passage-auth>' }))).toContain("tech-passage")
  })

  test("loginradius", () => {
    expect(fired(tx({ body: '<script src="https://hub.loginradius.com/include/js/LoginRadiusV2.js">' }))).toContain("tech-loginradius")
  })

  // --- Social aggregators ---
  test("oneall", () => {
    expect(fired(tx({ body: '<div class="oa_social_login"></div>' }))).toContain("tech-oneall")
  })

  test("sap cdc (gigya)", () => {
    expect(fired(tx({ body: '<script src="https://cdn.gigya.com/js/gigya.js?apikey=abc">' }))).toContain("tech-sap-cdc")
  })

  // --- False positive guard ---
  test("a plain page triggers no auth-provider rules", () => {
    expect(fired(tx({ body: "<html><body>Hello world</body></html>" }))).toHaveLength(0)
  })

  test("all rule IDs start with tech-", () => {
    for (const r of authProviderRules) expect(r.id).toMatch(/^tech-/)
  })

  test("all rules have auth-provider tag", () => {
    for (const r of authProviderRules) expect(r.tags).toContain("auth-provider")
  })

  test("rule count matches expected (25 providers)", () => {
    expect(authProviderRules.length).toBe(25)
  })
})
