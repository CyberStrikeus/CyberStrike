import type { Locator, Page } from "playwright-core";

import {
  SAVED_URL_PLACEHOLDER,
  type BrowserScenarioAction,
  type BrowserScenarioValue,
} from "../domain/browserScenarioValues.js";
import type { BrowserScenarioSecrets } from "./BrowserScenarioSecrets.js";
import {
  awaitSavedResponse,
  performScenarioRequest,
  withSavedPlaceholders,
  type SavedResponseWait,
} from "./PlaywrightScenarioRequest.js";

type ScenarioLocator = Extract<
  BrowserScenarioAction,
  { readonly locator: unknown }
>["locator"];

const resolveLocator = (page: Page, locator: ScenarioLocator): Locator => {
  switch (locator.kind) {
    case "test_id":
      return page.getByTestId(locator.value);
    case "role":
      return page.getByRole(locator.role, {
        name: locator.name,
        exact: true,
      });
    case "css":
      return page.locator(locator.selector);
  }
};

const resolveValue = (
  value: BrowserScenarioValue,
  secrets: BrowserScenarioSecrets,
): string => secrets.value(value);

interface PerformActionInput {
  readonly page: Page;
  readonly action: BrowserScenarioAction;
  readonly secrets: BrowserScenarioSecrets;
  /** Origin of the scenario's start URL, the only origin a request step may address. */
  readonly startOrigin: string;
  /** Cancellation of the step; a request step that sees it before sending sends nothing. */
  readonly signal?: AbortSignal | undefined;
  readonly onOpaqueRedirect?: () => void;
}

/** Watch the response selector before the UI action; matching does not prove action causality. */
const savingResponse = (
  input: PerformActionInput,
  action: Extract<BrowserScenarioAction, { action: "click" | "press" }>,
  timeout: number | undefined,
): SavedResponseWait | undefined =>
  action.save_response === undefined
    ? undefined
    : awaitSavedResponse(input.page, {
        stepId: action.step_id,
        spec: action.save_response,
        startOrigin: input.startOrigin,
        timeout,
        secrets: input.secrets,
        signal: input.signal,
      });

/** Execute one admitted declarative action; a request step sends one declared request through the page's own fetch, and no action runs caller-supplied code. */
export const performPlaywrightScenarioAction = async (
  input: PerformActionInput,
): Promise<void> => {
  const { page, action, secrets, startOrigin, signal } = input;
  const timeout = "timeout_ms" in action ? action.timeout_ms : undefined;
  const options = timeout === undefined ? {} : { timeout };
  switch (action.action) {
    case "goto":
      // Placeholders fill the URL as written, before structured query values join it.
      await page.goto(
        secrets.url({
          ...action.destination,
          url: withSavedPlaceholders(
            action.destination.url,
            secrets,
            SAVED_URL_PLACEHOLDER,
          ),
        }),
        { ...options, waitUntil: action.wait_until },
      );
      return;
    case "click": {
      const saving = savingResponse(input, action, timeout);
      try {
        await resolveLocator(page, action.locator).click({
          ...options,
          button: action.button,
          clickCount: action.click_count,
        });
        await saving?.saved();
      } finally {
        saving?.stop();
      }
      return;
    }
    case "fill":
      await resolveLocator(page, action.locator).fill(
        resolveValue(action.value, secrets),
        options,
      );
      return;
    case "press": {
      const saving = savingResponse(input, action, timeout);
      try {
        await resolveLocator(page, action.locator).press(action.key, options);
        await saving?.saved();
      } finally {
        saving?.stop();
      }
      return;
    }
    case "select_option":
      await resolveLocator(page, action.locator).selectOption(
        resolveValue(action.value, secrets),
        options,
      );
      return;
    case "check":
      await resolveLocator(page, action.locator).check(options);
      return;
    case "uncheck":
      await resolveLocator(page, action.locator).uncheck(options);
      return;
    case "wait_for":
      await resolveLocator(page, action.locator).waitFor({
        ...options,
        state: action.state,
      });
      return;
    case "wait_for_timeout":
      await page.waitForTimeout(action.duration_ms);
      return;
    case "request":
      await performScenarioRequest({
        page,
        action,
        secrets,
        startOrigin,
        signal,
        onOpaqueRedirect: input.onOpaqueRedirect,
      });
      return;
    default: {
      const unhandled: never = action;
      throw new Error(`Unhandled browser scenario action ${String(unhandled)}`);
    }
  }
};
