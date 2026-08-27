import { existsSync } from "fs"
import { chromium, type Browser, type LaunchOptions, type BrowserContextOptions } from "playwright"
import { Log } from "./log.ts"
import type { NetworkConfig } from "./types.ts"

const log = Log.create({ service: "hackbrowser:stealth" })

const PLATFORM_ARGS =
  process.platform === "linux"
    ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote"]
    : []

const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-first-run",
  // Stability: prevent renderer throttling/death on window drag/resize/minimize
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-component-update",
  ...PLATFORM_ARGS,
]

export function launchOptions(headless: boolean): LaunchOptions {
  // Headful: maximize to the REAL screen instead of forcing a fixed 1920x1080 window, which
  // overflows (and hides the login bar) on any screen smaller than that. Maximized fits every
  // screen and looks natural. Paired with contextOptions' viewport:null so Chrome — not
  // Playwright — owns the window size.
  const args = headless ? LAUNCH_ARGS : [...LAUNCH_ARGS, "--start-maximized"]
  return { headless, args }
}

export function findSystemChrome(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [
            `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"]
  return candidates.find((p) => existsSync(p))
}

export async function connect(opts: { cdp?: string; headless: boolean; network?: NetworkConfig }): Promise<Browser> {
  // Chromium needs the proxy at LAUNCH: --proxy-server is a process-level switch,
  // so setting it here covers every context the crawl later creates (including
  // the per-credential ones in multi-credential mode).
  const proxy = opts.network?.proxy

  if (opts.cdp) {
    // Attaching to a browser someone else already started — its proxy was fixed
    // when that process launched and cannot be changed from here. Say so loudly:
    // silently ignoring it would look like the proxy config simply "doesn't work".
    if (proxy) {
      log.warn("proxy config ignored: connecting to an already-running browser over CDP", {
        server: proxy.server,
        hint: "start that browser with its own --proxy-server, or drop the cdp option to let hackbrowser launch one",
      })
    }
    return chromium.connectOverCDP(opts.cdp)
  }

  const launch: LaunchOptions = { ...launchOptions(opts.headless), ...(proxy ? { proxy } : {}) }
  const chrome = findSystemChrome()
  if (chrome) return chromium.launch({ ...launch, executablePath: chrome })
  return chromium.launch(launch)
}

export function contextOptions(headless = true, network?: NetworkConfig): BrowserContextOptions {
  // Report the REAL Chrome UA (no spoof). A faked Windows UA over the real macOS/Linux
  // navigator.platform is a glaring cross-check mismatch that makes detection easier, not
  // harder; only automation tells are hidden (INIT_SCRIPT). The real host stays consistent.
  return {
    viewport: headless ? { width: 1920, height: 1080 } : null,
    screen: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    // The proxy is repeated here, not just at launch, and that is load-bearing.
    // When clientCertificates are present Playwright inserts its own local
    // interceptor and points the context at it, overriding the launch-level
    // --proxy-server; the interceptor then picks ITS upstream from the CONTEXT
    // proxy. With the proxy only at launch, a crawl that also uses a client
    // certificate connects to targets DIRECTLY while the operator believes it is
    // proxied. Measured: launch-only + cert never reaches the proxy; adding it
    // here restores it (the interceptor CONNECTs through it).
    ...(network?.proxy ? { proxy: network.proxy } : {}),
    // Certificate errors are IGNORED by default. A crawler aimed at staging
    // apps, self-signed dev hosts and traffic behind an intercepting proxy hits
    // untrusted certificates constantly, and refusing to load the page turns a
    // testable target into a blank run. This matches what the replay engine
    // already does (http_replay accepts bad certs unless told otherwise);
    // the browser being the one strict component was the inconsistency.
    // Set network.tls.rejectUnauthorized=true to opt back into strict checking.
    ignoreHTTPSErrors: network?.ignoreHTTPSErrors ?? true,
    ...(network?.clientCertificates?.length ? { clientCertificates: network.clientCertificates } : {}),
  }
}

export const INIT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => false });

for (const key of Object.keys(window)) {
  if (/^cdc_/.test(key)) delete window[key];
}

if (navigator.plugins.length === 0) {
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ],
  });
}

if (!navigator.languages || navigator.languages.length === 0) {
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
}

Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

if (!navigator.connection) {
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      rtt: 50,
      downlink: 10,
      saveData: false,
    }),
  });
}

Object.defineProperty(screen, 'width', { get: () => 1920 });
Object.defineProperty(screen, 'height', { get: () => 1080 });
Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
// NOTE: window.inner/outerWidth/Height are intentionally NOT spoofed. They must reflect
// the REAL window so (a) the crawler's own geometry stays correct — scanner occlusion /
// offscreen / scroll and the injected panel/login-bar clamp all read innerWidth — and
// (b) they stay consistent with the actual rendered viewport (a faked 1920 over a smaller
// real window is itself a detectable fingerprint mismatch). Monitor size is spoofed via
// screen.* above; the window is launched at 1920x1080 (launchOptions/contextOptions) so on
// a normal host innerWidth is already ~1920 with no spoof needed.

// NOTE: WebGL vendor/renderer are intentionally NOT spoofed. The real GPU string is a
// genuine, self-consistent value; a faked 'Intel Iris OpenGL Engine' (an old macOS GPU
// name, in the outdated non-ANGLE format) contradicts both the platform and modern Chrome's
// 'ANGLE (...)' renderer format, which is more detectable than reporting the truth.

// NOTE: canvas toDataURL is intentionally NOT perturbed. The previous per-call XOR of one
// pixel's alpha mutated the canvas on every read, so the same canvas hashed differently each
// time — an unstable canvas is itself a bot signal (a real canvas is stable). Canvas-noise is
// an anti-TRACKING measure, not anti-bot-detection (not what cleared #76); reporting the real,
// stable canvas is the consistent choice, matching the UA/WebGL/window decisions above.

const origQuery = window.Permissions?.prototype?.query;
if (origQuery) {
  window.Permissions.prototype.query = function(params) {
    if (params.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission, onchange: null });
    }
    return origQuery.call(this, params);
  };
}

if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {} };
`
