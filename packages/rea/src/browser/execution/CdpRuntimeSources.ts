import { createHash } from "node:crypto";
import { z } from "zod";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { sanitizeBrowserUrl } from "../../domain/browserObservation.js";
import { jsonObjectSchema } from "../../domain/jsonValue.js";
import type {
  WebRuntimeSource,
  webRuntimeLocationSchema,
} from "../../domain/webRuntime.js";
import type { CdpEvent } from "../CdpConnection.js";
import type { CdpRuntimeSession } from "./CdpRuntimeSession.js";
import {
  runtimeContextSchema,
  runtimeScriptParsedSchema,
  cdpContextFrameClaim,
  selectCdpScriptFrame,
} from "../CdpScriptContextFacts.js";
import { assertRuntimeRetention } from "./CdpRuntimeRetention.js";

const scriptIdentitySchema = runtimeScriptParsedSchema.pick({ scriptId: true });
const contextIdentitySchema = z.object({
  context: runtimeContextSchema.shape.context.pick({ id: true }),
});

/** Source ownership is proven by execution context/frame metadata, independently of URL aliases. */
export class CdpRuntimeSources {
  readonly scripts = new Map<
    string,
    z.infer<typeof runtimeScriptParsedSchema>
  >();
  readonly #contexts = new Map<
    number,
    z.infer<typeof runtimeContextSchema>["context"]
  >();
  readonly #changed = new Set<string>();
  readonly #changedContexts = new Set<number>();
  readonly #sources = new Map<string, WebRuntimeSource>();
  #retainedBytes = 0;
  #sourceBytes = 0;
  #failure: AnalysisError | undefined;
  constructor(readonly session: CdpRuntimeSession) {}

  /** Subscribe before enabling Debugger; existing uncollected scripts are replayed by the producer. */
  ingest(event: CdpEvent, retainNewMetadata = true): void {
    if (
      event.sessionId !== this.session.transport.sessionId ||
      this.#failure !== undefined
    )
      return;
    try {
      if (event.method === "Runtime.executionContextCreated") {
        this.#retainedBytes += Buffer.byteLength(JSON.stringify(event.params));
        assertRuntimeRetention(
          this.session.operation,
          "metadata",
          this.#retainedBytes,
        );
        const context = runtimeContextSchema.parse(event.params).context;
        const previous = this.#contexts.get(context.id);
        if (
          previous !== undefined &&
          JSON.stringify(previous) !== JSON.stringify(context)
        ) {
          this.#changedContexts.add(context.id);
          for (const item of this.#sources.values())
            if (item.execution_context_id === context.id) this.revalidate(item);
        }
        if (retainNewMetadata) this.#contexts.set(context.id, context);
      } else if (event.method === "Debugger.scriptParsed") {
        this.#retainedBytes += Buffer.byteLength(JSON.stringify(event.params));
        assertRuntimeRetention(
          this.session.operation,
          "metadata",
          this.#retainedBytes,
        );
        const script = runtimeScriptParsedSchema.parse(event.params);
        const previous = this.scripts.get(script.scriptId);
        if (
          previous !== undefined &&
          JSON.stringify(previous) !== JSON.stringify(script)
        ) {
          this.#changed.add(script.scriptId);
          const retained = this.#sources.get(script.scriptId);
          if (retained !== undefined) this.revalidate(retained);
        }
        if (retainNewMetadata) this.scripts.set(script.scriptId, script);
      }
    } catch (cause: unknown) {
      this.#failure =
        cause instanceof AnalysisError
          ? cause
          : new AnalysisOutputError(
              this.session.operation,
              cause instanceof Error ? cause.message : String(cause),
            );
    }
  }

  /** Producer parse/resource failures are surfaced outside the transport event callback. */
  check(): void {
    if (this.#failure !== undefined) throw this.#failure;
  }

  /** Frozen inventories still monitor known identities through asynchronous source reads. */
  verifyKnownIdentity(event: CdpEvent): void {
    if (event.method === "Debugger.scriptParsed") {
      const id = scriptIdentitySchema.safeParse(event.params);
      if (id.success && this.scripts.has(id.data.scriptId))
        this.ingest(event, false);
    } else if (event.method === "Runtime.executionContextCreated") {
      const id = contextIdentitySchema.safeParse(event.params);
      if (id.success && this.#contexts.has(id.data.context.id))
        this.ingest(event, false);
    }
  }

  /** Only proven default worlds of the selected main frame establish website source ownership. */
  belongsToDocument(scriptId: string): boolean {
    const script = this.scripts.get(scriptId);
    if (
      script === undefined ||
      this.#changed.has(scriptId) ||
      this.#changedContexts.has(script.executionContextId)
    )
      return false;
    const scriptContext = script.executionContextAuxData;
    const context = this.#contexts.get(script.executionContextId)?.auxData;
    const worlds = [scriptContext, context];
    if (
      worlds.some(
        (world) =>
          world?.isDefault === false ||
          (world?.type !== undefined && world.type !== "default"),
      ) ||
      !worlds.some(
        (world) => world?.isDefault === true || world?.type === "default",
      )
    )
      return false;
    const frame = selectCdpScriptFrame(
      cdpContextFrameClaim(scriptContext),
      cdpContextFrameClaim(context),
    );
    return (
      !frame.invalid &&
      !frame.conflicting &&
      frame.frameId === this.session.target.frame_id
    );
  }

  /** Retain complete script text and compute a digest distinct from the producer hash. */
  async read(scriptIds: Iterable<string>): Promise<WebRuntimeSource[]> {
    this.check();
    for (const scriptId of new Set(scriptIds)) {
      if (this.#sources.has(scriptId)) continue;
      const script = this.scripts.get(scriptId);
      const owned = this.belongsToDocument(scriptId);
      const context =
        script === undefined
          ? undefined
          : this.#contexts.get(script.executionContextId);
      const item: WebRuntimeSource = {
        script_id: scriptId,
        url: this.sourceUrl(scriptId, script?.url ?? ""),
        execution_context_id: script?.executionContextId ?? null,
        reported_execution_context:
          context === undefined ? null : jsonObjectSchema.parse(context),
        reported_script_context_aux_data:
          script?.executionContextAuxData === undefined
            ? null
            : jsonObjectSchema.parse(script.executionContextAuxData),
        frame_id: owned ? this.session.target.frame_id : null,
        producer_hash: script?.hash ?? null,
        source_map_url: script?.sourceMapURL ?? null,
        has_source_url: script?.hasSourceURL ?? null,
        language: script?.scriptLanguage ?? null,
        resource_start:
          script !== undefined
            ? {
                line_number: script.startLine,
                column_number: script.startColumn,
              }
            : null,
        source: {
          state: "excluded",
          reason: this.#changed.has(scriptId)
            ? "The script changed identity during observation; source attribution is unknown."
            : "Selected main-document default-world ownership was not established.",
        },
      };
      if (owned && script?.scriptLanguage !== "WebAssembly")
        item.source = await this.capture(scriptId);
      else if (owned)
        item.source = {
          state: "excluded",
          reason:
            "WebAssembly bytecode is outside this JavaScript source operation.",
        };
      this.revalidate(item);
      this.#sources.set(scriptId, item);
    }
    this.check();
    return [...this.#sources.values()];
  }

  /** Resolve an exact producer script ID; URL equality is never an identity fallback. */
  location(
    scriptId: string,
    url: string | null,
    line: number,
    column: number | null,
    functionName: string | null = null,
  ): z.infer<typeof webRuntimeLocationSchema> {
    return {
      script_id: scriptId,
      url: url === null ? null : this.sourceUrl(scriptId, url),
      line_number: line,
      column_number: column,
      function_name: functionName,
      source_association: this.belongsToDocument(scriptId)
        ? "script_id"
        : "unknown",
    };
  }

  /** Declared script names are inert evidence; known resource URLs omit transport userinfo. */
  sourceUrl(scriptId: string, url: string): string {
    return !this.#changed.has(scriptId) &&
      this.scripts.get(scriptId)?.hasSourceURL === false
      ? sanitizeBrowserUrl(url).url
      : url;
  }

  private revalidate(item: WebRuntimeSource): void {
    if (item.frame_id === null || this.belongsToDocument(item.script_id))
      return;
    const previous =
      item.source.state === "unavailable"
        ? ` Previous source read failure: ${item.source.reason}`
        : "";
    item.frame_id = null;
    item.source = {
      state: "excluded",
      reason: `The script or context changed identity during source collection; attribution is unknown.${previous}`,
    };
  }

  private async capture(scriptId: string): Promise<WebRuntimeSource["source"]> {
    let raw: unknown;
    try {
      raw = await this.session.command("Debugger.getScriptSource", {
        scriptId,
      });
    } catch (cause: unknown) {
      if (
        this.session.options.signal?.aborted ||
        !(cause instanceof AnalysisError)
      )
        throw cause;
      return {
        state: "unavailable",
        reason: cause.userMessage ?? cause.message,
      };
    }
    const source = z.object({ scriptSource: z.string() }).safeParse(raw);
    if (!source.success)
      throw new AnalysisOutputError(
        this.session.operation,
        "Debugger.getScriptSource returned malformed source text.",
      );
    const text = source.data.scriptSource;
    const bytes = Buffer.byteLength(text);
    this.#sourceBytes += bytes;
    assertRuntimeRetention(
      this.session.operation,
      "sources",
      this.#sourceBytes,
    );
    return {
      state: "captured",
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
      utf8_bytes: bytes,
      utf16_units: text.length,
    };
  }
}
