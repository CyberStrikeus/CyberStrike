import {
  classifyBrowserCompleteness,
  type BrowserCompleteness,
  type BrowserDroppedEventKind,
  type BrowserDroppedEvents,
  type BrowserExclusion,
  type BrowserExclusionReason,
  type BrowserSection,
} from "../domain/browserCompleteness.js";

const EVENT_SECTIONS: Readonly<
  Record<BrowserDroppedEventKind, BrowserSection>
> = {
  scripts: "scripts",
  network_requests: "network_requests",
  console_events: "console_events",
  websocket_connections: "websocket_connections",
  websocket_frames: "websocket_frames",
  webmcp_tools: "webmcp_tools",
  timeline_events: "timeline",
};

const POLICY_REASONS = new Set<BrowserExclusionReason>([
  "disallowed_origin",
  "unsupported_url",
  "unattributed_origin",
  "not_approved",
  "out_of_target_scope",
]);

/** Mutable adapter ledger projected into immutable, canonical completeness v2. */
export class CdpCaptureCompleteness {
  readonly #initialAttachLimited: readonly BrowserSection[];
  readonly #policyFiltered = new Set<BrowserSection>();
  readonly #attachLimited = new Set<BrowserSection>();
  readonly #truncated = new Set<BrowserSection>();
  readonly #unavailable = new Set<BrowserSection>();
  readonly #excluded = new Map<string, BrowserExclusion>();
  readonly #dropped: Omit<BrowserDroppedEvents, "total"> = emptyDropped();

  constructor(initialAttachLimited: readonly BrowserSection[] = []) {
    this.#initialAttachLimited = [...initialAttachLimited];
    this.reset();
  }

  reset(): void {
    this.#policyFiltered.clear();
    this.#attachLimited.clear();
    this.#truncated.clear();
    this.#unavailable.clear();
    this.#excluded.clear();
    Object.assign(this.#dropped, emptyDropped());
    for (const section of this.#initialAttachLimited)
      this.#attachLimited.add(section);
  }

  exclude(
    section: BrowserSection,
    reason: BrowserExclusionReason,
    count: number | null = 1,
  ): void {
    if (POLICY_REASONS.has(reason)) this.#policyFiltered.add(section);
    if (
      reason === "provider_unavailable" ||
      reason === "unattributed_target" ||
      reason === "invalid_protocol_value" ||
      reason === "unknown_target_relationship"
    )
      this.#unavailable.add(section);
    if (reason === "resource_budget_exhausted") this.#truncated.add(section);
    const key = `${section}\0${reason}`;
    const existing = this.#excluded.get(key);
    const combined =
      count === null || existing?.count === null
        ? null
        : (existing?.count ?? 0) + count;
    this.#excluded.set(key, { section, reason, count: combined });
  }

  attachLimited(section: BrowserSection): void {
    this.#attachLimited.add(section);
  }

  unavailable(section: BrowserSection): void {
    this.#unavailable.add(section);
    this.exclude(section, "provider_unavailable", null);
  }

  truncate(section: BrowserSection): void {
    this.#truncated.add(section);
  }

  drop(kind: BrowserDroppedEventKind, count = 1): void {
    this.#dropped[kind] += count;
    this.#truncated.add(EVENT_SECTIONS[kind]);
  }

  get droppedTotal(): number {
    return Object.values(this.#dropped).reduce((sum, count) => sum + count, 0);
  }

  snapshot(): BrowserCompleteness {
    return classifyBrowserCompleteness({
      policyFilteredSections: this.#policyFiltered,
      attachLimitedSections: this.#attachLimited,
      truncatedSections: this.#truncated,
      unavailableSections: this.#unavailable,
      excluded: [...this.#excluded.values()],
      droppedEvents: this.#dropped,
    });
  }
}

const emptyDropped = (): Omit<BrowserDroppedEvents, "total"> => ({
  scripts: 0,
  network_requests: 0,
  console_events: 0,
  websocket_connections: 0,
  websocket_frames: 0,
  webmcp_tools: 0,
  timeline_events: 0,
});
