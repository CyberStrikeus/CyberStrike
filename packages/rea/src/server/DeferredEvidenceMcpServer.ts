import type {
  RegisteredTool,
  RegisteredPrompt,
  StandardSchemaWithJSON,
  ToolCallback,
  PromptCallback,
} from "@modelcontextprotocol/server";
import type { PromptCompletionSource } from "./promptCompletion.js";
import type { RecordedMcpCatalog } from "../recordedMcpCatalog.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";
import {
  EvidenceMcpServerCore,
  currentMcpRequestSignal,
  type StandardToolRegistration,
} from "./EvidenceMcpServerCore.js";
import { promptArgumentsSchema } from "./promptArguments.js";
import { SERVER_START_FAILED } from "../main/messages.js";

type ToolConfig = StandardToolRegistration;
type InputCallback = ToolCallback<StandardSchemaWithJSON>;
interface DeferredTool {
  readonly registered: RegisteredTool;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown> | undefined;
  callback?: InputCallback;
}
interface DeferredPrompt {
  readonly registered: RegisteredPrompt;
  callback?: PromptCallback<StandardSchemaWithJSON>;
}

/** Borrow the build-owned wire projection while retaining the canonical parser. */
const recordedProjection = (
  schema: StandardSchemaWithJSON,
  projection: Record<string, unknown>,
): StandardSchemaWithJSON => ({
  "~standard": {
    ...schema["~standard"],
    jsonSchema: { input: () => projection, output: () => projection },
  },
});

/** One SDK server, with async canonical validation installed on first use. */
export class DeferredEvidenceMcpServer extends EvidenceMcpServerCore {
  private readonly tools = new Map<string, DeferredTool>();
  private readonly prompts = new Map<string, DeferredPrompt>();
  private loading: Promise<void> | undefined;
  private closing = false;
  private closeAttempt: Promise<void> | undefined;
  private protocolClosed = false;
  private runtimeClosed = false;
  private runtimeCleanup: (() => Promise<void>) | undefined;
  private partialClose: (() => Promise<void>) | undefined;
  private materializing = false;
  private readonly protocolClose = () => super.close();

  constructor(
    catalog: RecordedMcpCatalog,
    delivery: ToolResultDelivery,
    private readonly initialize: (
      server: DeferredEvidenceMcpServer,
    ) => Promise<void>,
    maximumInputElements?: number,
  ) {
    super(
      catalog.info,
      {
        capabilities: catalog.capabilities,
        instructions: catalog.instructions,
        ...(maximumInputElements === undefined
          ? {}
          : { maxToolInputElements: maximumInputElements }),
      },
      undefined,
      delivery,
      undefined,
      // `main.ts` only defers the exact full advertisement catalog.
      "full",
      catalog.identity,
    );
    for (const tool of catalog.tools) {
      const { name, inputSchema, outputSchema, ...metadata } = tool;
      let binding: DeferredTool;
      const input: StandardSchemaWithJSON = {
        "~standard": {
          version: 1,
          vendor: "rea",
          jsonSchema: { input: () => inputSchema, output: () => inputSchema },
          validate: async (value) => {
            await this.ensureRuntime();
            const canonical = binding.registered.inputSchema;
            if (canonical === undefined || canonical === input)
              throw new Error(SERVER_START_FAILED);
            return canonical["~standard"].validate(value);
          },
        },
      };
      const output: StandardSchemaWithJSON | undefined =
        outputSchema === undefined
          ? undefined
          : {
              "~standard": {
                version: 1,
                vendor: "rea",
                jsonSchema: {
                  input: () => outputSchema,
                  output: () => outputSchema,
                },
                validate: async (value) => {
                  await this.ensureRuntime();
                  const canonical = binding.registered.outputSchema;
                  if (canonical === undefined || canonical === output)
                    throw new Error(SERVER_START_FAILED);
                  return canonical["~standard"].validate(value);
                },
              },
            };
      const registered = super.bindTool(
        name,
        {
          ...metadata,
          inputSchema: input,
          ...(output === undefined ? {} : { outputSchema: output }),
        } as StandardToolRegistration,
        (async (args, ctx) => {
          await this.ensureRuntime();
          ctx.mcpReq.signal.throwIfAborted();
          if (binding.callback === undefined)
            throw new Error(SERVER_START_FAILED);
          return binding.callback(args, ctx);
        }) as InputCallback,
      );
      binding = { registered, input: inputSchema, output: outputSchema };
      this.tools.set(name, binding);
    }
    const completion = {
      complete: async (
        ...args: Parameters<
          NonNullable<typeof this.promptCompletion>["complete"]
        >
      ) => {
        await this.ensureRuntime();
        currentMcpRequestSignal()?.throwIfAborted();
        if (this.promptCompletion === undefined)
          throw new Error(SERVER_START_FAILED);
        return this.promptCompletion.complete(...args);
      },
    };
    for (const prompt of catalog.prompts) {
      const { name, parameters, title, description } = prompt;
      let binding: DeferredPrompt;
      const argsSchema = promptArgumentsSchema(
        { arguments: parameters },
        completion,
      );
      const registered = super.registerCanonicalPrompt(
        name,
        {
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
          argsSchema,
        },
        async (args, ctx) => {
          await this.ensureRuntime();
          ctx.mcpReq.signal.throwIfAborted();
          if (binding.callback === undefined)
            throw new Error(SERVER_START_FAILED);
          return binding.callback(args, ctx);
        },
      );
      binding = { registered };
      this.prompts.set(name, binding);
    }
  }

  ensureRuntime(): Promise<void> {
    if (this.closing)
      return Promise.reject(new Error("MCP connection is closed"));
    this.loading ??= Promise.resolve()
      .then(() => this.initialize(this))
      .catch(() => {
        throw new Error(SERVER_START_FAILED);
      });
    return this.loading;
  }

  /** Register an awaitable cleanup capability before runtime startup can fail. */
  ownRuntimeCleanup(close: () => Promise<void>): void {
    this.runtimeCleanup = close;
  }

  /** Canonical composition may wrap close; retain that exact cleanup capability. */
  materialize(build: () => void): void {
    const ownedClose = this.close.bind(this);
    this.materializing = true;
    this.close = this.protocolClose;
    try {
      build();
      if (this.tools.size !== 0 || this.prompts.size !== 0)
        throw new Error("MCP catalog does not match runtime registrations");
    } finally {
      this.partialClose = this.close.bind(this);
      this.close = ownedClose;
      this.materializing = false;
    }
  }

  closePartialRuntime(): Promise<void> {
    return this.partialClose?.() ?? Promise.resolve();
  }

  protected override bindTool(
    name: string,
    config: ToolConfig,
    callback: ToolCallback<StandardSchemaWithJSON | undefined>,
  ): RegisteredTool {
    const binding = this.tools.get(name);
    if (
      !this.materializing ||
      binding === undefined ||
      config.inputSchema === undefined ||
      (config.outputSchema === undefined) !== (binding.output === undefined)
    )
      throw new Error("Unexpected MCP runtime registration");
    const canonical = callback as InputCallback;
    const guarded: InputCallback = async (args, ctx) => {
      ctx.mcpReq.signal.throwIfAborted();
      await this.ensureRuntime();
      ctx.mcpReq.signal.throwIfAborted();
      return canonical(args, ctx);
    };
    binding.callback = guarded;
    const { inputSchema: _input, outputSchema: _output, ...metadata } = config;
    binding.registered.update({
      ...metadata,
      paramsSchema: recordedProjection(config.inputSchema, binding.input),
      ...(config.outputSchema === undefined || binding.output === undefined
        ? {}
        : {
            outputSchema: recordedProjection(
              config.outputSchema,
              binding.output,
            ),
          }),
      callback: guarded,
    });
    this.tools.delete(name);
    return binding.registered;
  }

  override registerCanonicalPrompt<Args extends StandardSchemaWithJSON>(
    name: string,
    config: { title?: string; description?: string; argsSchema: Args },
    callback: PromptCallback<Args>,
  ): RegisteredPrompt {
    const binding = this.prompts.get(name);
    if (!this.materializing || binding === undefined)
      throw new Error("Unexpected MCP runtime prompt");
    const canonical = callback as PromptCallback<StandardSchemaWithJSON>;
    binding.callback = async (args, ctx) => {
      ctx.mcpReq.signal.throwIfAborted();
      await this.ensureRuntime();
      ctx.mcpReq.signal.throwIfAborted();
      return canonical(args, ctx);
    };
    binding.registered.update<StandardSchemaWithJSON>({
      ...config,
      callback: binding.callback,
    });
    this.prompts.delete(name);
    return binding.registered;
  }

  override bindPromptCompletion(
    completion: PromptCompletionSource,
  ): PromptCompletionSource {
    return super.bindPromptCompletion({
      complete: async (...args) => {
        await this.ensureRuntime();
        currentMcpRequestSignal()?.throwIfAborted();
        return completion.complete(...args);
      },
    });
  }

  override sendToolListChanged(): void {
    if (!this.materializing) super.sendToolListChanged();
  }
  override sendPromptListChanged(): void {
    if (!this.materializing) super.sendPromptListChanged();
  }

  override close(): Promise<void> {
    this.closing = true;
    this.closeAttempt ??= Promise.resolve()
      .then(() => this.finishClose())
      .catch((cause) => {
        this.closeAttempt = undefined;
        throw cause;
      });
    return this.closeAttempt;
  }

  private async finishClose(): Promise<void> {
    const errors: unknown[] = [];
    if (!this.protocolClosed) {
      try {
        await this.protocolClose();
        this.protocolClosed = true;
      } catch (cause) {
        errors.push(cause);
      }
    }
    await this.loading?.catch(() => undefined);
    if (!this.runtimeClosed && this.runtimeCleanup !== undefined) {
      try {
        await this.runtimeCleanup();
        this.runtimeClosed = true;
      } catch (cause) {
        errors.push(cause);
      }
    }
    if (errors.length > 0)
      throw new AggregateError(errors, "MCP runtime cleanup failed");
  }
}
