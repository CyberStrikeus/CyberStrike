import { createHash } from "node:crypto";

import { z } from "zod";
import type { BrowserContext, Page } from "playwright-core";

import type { BrowserScenario } from "../domain/browserScenario.js";
import {
  BROWSER_STORAGE_FINGERPRINT_VERSION,
  browserStepArtifactsSchema,
  type BrowserStepArtifacts,
} from "../domain/browserScenarioCaptureValues.js";
import type { BrowserScenarioSecrets } from "./BrowserScenarioSecrets.js";

const historyValueSchema = z.strictObject({
  length: z.int().min(0),
  navigation_entries: z.array(
    z.strictObject({
      type: z.string(),
      name: z.string(),
    }),
  ),
});

const storageValueSchema = z.strictObject({
  local_storage: z.array(z.tuple([z.string(), z.string()])),
  session_storage: z.array(z.tuple([z.string(), z.string()])),
});

type SnapshotKind = BrowserScenario["capture"]["after_each_step"][number];

const notRequested = () => ({ state: "not_requested" as const });
const missing = (reason: string) => ({ state: "missing" as const, reason });

const textArtifact = (text: string) => {
  const bytes = Buffer.from(text);
  return {
    state: "captured" as const,
    value: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      text,
    },
  };
};

const SCREENSHOT_PRIVACY_REASON =
  "Screenshot withheld because this scenario may display explicitly sensitive values; safe pixel redaction is unavailable.";

const captureScreenshot = async (
  page: Page,
  secrets: BrowserScenarioSecrets,
) => {
  if (secrets.withholdsScreenshots()) return missing(SCREENSHOT_PRIVACY_REASON);
  try {
    const bytes = await page.screenshot({
      type: "png",
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      state: "captured" as const,
      value: {
        sha256,
        bytes: bytes.byteLength,
        media_type: "image/png" as const,
        data_base64: bytes.toString("base64"),
      },
    };
  } catch (cause: unknown) {
    void cause;
    return missing("screenshot capture failed");
  }
};

const captureDom = async (input: {
  readonly page: Page;
  readonly secrets: BrowserScenarioSecrets;
}) => {
  const { page, secrets } = input;
  try {
    return textArtifact(secrets.redact(await page.content()));
  } catch (cause: unknown) {
    void cause;
    return missing("DOM capture failed");
  }
};

const captureAccessibility = async (input: {
  readonly page: Page;
  readonly secrets: BrowserScenarioSecrets;
}) => {
  const { page, secrets } = input;
  try {
    const text = await page.locator("html").ariaSnapshot();
    return textArtifact(secrets.redact(text));
  } catch (cause: unknown) {
    void cause;
    return missing("accessibility capture failed");
  }
};

const navigationType = (
  value: string,
): "navigate" | "reload" | "back_forward" | "prerender" | "unknown" => {
  switch (value) {
    case "navigate":
    case "reload":
    case "back_forward":
    case "prerender":
      return value;
    default:
      return "unknown";
  }
};

const captureHistory = async (page: Page, secrets: BrowserScenarioSecrets) => {
  try {
    const raw = historyValueSchema.parse(
      await page.evaluate(`(() => ({
        length: window.history.length,
        navigation_entries: performance.getEntriesByType("navigation").map(
          entry => ({
            type: typeof entry.type === "string" ? entry.type : "unknown",
            name: entry.name
          })
        )
      }))()`),
    );
    const value = {
      length: raw.length,
      current_url: secrets.sanitizeUrl(page.url()),
      navigation_entries: raw.navigation_entries.map(({ type, name }) => ({
        type: navigationType(type),
        name: secrets.sanitizeUrl(name),
      })),
    };
    return { state: "captured" as const, value };
  } catch (cause: unknown) {
    void cause;
    return missing("history capture failed");
  }
};

const captureStorage = async (input: {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly secrets: BrowserScenarioSecrets;
}) => {
  const { context, page, secrets } = input;
  try {
    const pageUrl = new URL(page.url());
    const cookies =
      pageUrl.protocol === "http:" || pageUrl.protocol === "https:"
        ? await context.cookies(pageUrl.href)
        : [];
    const pageStorage = storageValueSchema.parse(
      await page.evaluate(`(() => ({
        local_storage: Object.entries(window.localStorage),
        session_storage: Object.entries(window.sessionStorage)
      }))()`),
    );
    const value = {
      fingerprint_version: BROWSER_STORAGE_FINGERPRINT_VERSION,
      cookies: cookies.map((cookie) => ({
        name: secrets.redact(cookie.name),
        domain: secrets.redact(cookie.domain),
        path: secrets.redact(cookie.path),
        secure: cookie.secure,
        http_only: cookie.httpOnly,
        same_site: cookie.sameSite,
        ...secrets.fingerprint(cookie.value),
      })),
      local_storage: pageStorage.local_storage.map(([name, value]) => ({
        name: secrets.redact(name),
        ...secrets.fingerprint(value),
      })),
      session_storage: pageStorage.session_storage.map(([name, value]) => ({
        name: secrets.redact(name),
        ...secrets.fingerprint(value),
      })),
    };
    return { state: "captured" as const, value };
  } catch (cause: unknown) {
    void cause;
    return missing("storage capture failed");
  }
};

/** Capture selected step artifacts without retaining data after scope loss. */
export const capturePlaywrightStepArtifacts = async (input: {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly secrets: BrowserScenarioSecrets;
  readonly requested: ReadonlySet<SnapshotKind>;
}): Promise<BrowserStepArtifacts> => {
  const { context, page, secrets, requested } = input;
  const state = <Value>(
    kind: SnapshotKind,
    capture: () => Promise<Value>,
  ): Promise<
    Value | ReturnType<typeof notRequested> | ReturnType<typeof missing>
  > => (!requested.has(kind) ? Promise.resolve(notRequested()) : capture());
  return browserStepArtifactsSchema.parse({
    screenshot: await state("screenshot", () =>
      captureScreenshot(page, secrets),
    ),
    dom: await state("dom", () => captureDom({ page, secrets })),
    accessibility: await state("accessibility", () =>
      captureAccessibility({ page, secrets }),
    ),
    url: await state("url", async () => ({
      state: "captured" as const,
      value: secrets.sanitizeUrl(page.url()),
    })),
    history: await state("history", () => captureHistory(page, secrets)),
    storage: await state("storage", () =>
      captureStorage({ context, page, secrets }),
    ),
  });
};
