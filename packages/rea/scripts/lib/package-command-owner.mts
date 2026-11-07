import {
  createVerifierCommands,
  VerifierCommandExitError,
  type VerifierCommands,
  type VerifierCommandsOptions,
  type VerifierCommandOptions,
  type VerifierCommandOutput,
  type VerifierCleanupOwner,
} from "./verifier-command-owner.mjs";
import { npmInvocation } from "./npm-invocation.mjs";

export interface PackageVerifierWorkspace {
  readonly path: string;
  close(): Promise<void>;
}

export interface PackageVerifierCommands extends Pick<
  VerifierCommands,
  "exec"
> {
  execNpm(
    arguments_: readonly string[],
    options?: VerifierCommandOptions,
  ): Promise<VerifierCommandOutput>;
  run(
    command: string,
    arguments_: readonly string[],
    environment?: NodeJS.ProcessEnv,
  ): Promise<string>;
  runWithStatus(
    command: string,
    arguments_: readonly string[],
    environment?: NodeJS.ProcessEnv,
  ): Promise<{ readonly stdout: string; readonly status: number }>;
  adopt(owner: VerifierCleanupOwner, resource?: string): void;
  close(): Promise<void>;
}

/** The same command/workspace capability remains available after failed close. */
export class PackageVerifierCleanupFailure extends Error {
  readonly path: string;
  constructor(
    cause: unknown,
    readonly cleanupOwner: PackageVerifierCommands,
    readonly workspace: PackageVerifierWorkspace,
  ) {
    super(
      `Package verification cleanup incomplete; retained ${workspace.path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "PackageVerifierCleanupFailure";
    this.path = workspace.path;
  }
}

class PackageCommands implements PackageVerifierCommands {
  #workspaceReleaseStarted = false;
  #closing: Promise<void> | undefined;

  constructor(
    readonly workspace: PackageVerifierWorkspace,
    private readonly commands: VerifierCommands,
  ) {}

  exec(
    command: string,
    arguments_: readonly string[],
    options: VerifierCommandOptions = {},
  ): Promise<VerifierCommandOutput> {
    return this.commands.exec(command, arguments_, options);
  }

  execNpm(
    arguments_: readonly string[],
    options: VerifierCommandOptions = {},
  ): Promise<VerifierCommandOutput> {
    const invocation = npmInvocation(arguments_, options.env ?? process.env);
    return this.exec(invocation.command, invocation.arguments, options);
  }

  async run(
    command: string,
    arguments_: readonly string[],
    environment?: NodeJS.ProcessEnv,
  ): Promise<string> {
    return (await this.exec(command, arguments_, { env: environment })).stdout;
  }

  async runWithStatus(
    command: string,
    arguments_: readonly string[],
    environment?: NodeJS.ProcessEnv,
  ): Promise<{ readonly stdout: string; readonly status: number }> {
    try {
      return {
        stdout: await this.run(command, arguments_, environment),
        status: 0,
      };
    } catch (cause: unknown) {
      if (cause instanceof VerifierCommandExitError && cause.code === 1)
        return { stdout: cause.snapshot.stdout.text, status: 1 };
      throw cause;
    }
  }

  adopt(owner: VerifierCleanupOwner, resource = this.workspace.path): void {
    if (this.#workspaceReleaseStarted)
      throw new Error("Package workspace release has started");
    this.commands.adopt(owner, resource);
  }

  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    let attempt: Promise<void>;
    attempt = this.#release().catch((cause: unknown) => {
      if (this.#closing === attempt) this.#closing = undefined;
      throw new PackageVerifierCleanupFailure(cause, this, this.workspace);
    });
    this.#closing = attempt;
    return attempt;
  }

  async #release(): Promise<void> {
    await this.commands.close();
    this.#workspaceReleaseStarted = true;
    await this.workspace.close();
  }
}

/** Remove the package workspace only after its shared command owner releases. */
export async function createPackageVerifierCommands({
  workspace,
  launcher,
}: VerifierCommandsOptions & {
  readonly workspace: PackageVerifierWorkspace;
}): Promise<PackageVerifierCommands> {
  const commands = await createVerifierCommands(
    launcher === undefined ? {} : { launcher },
  );
  return new PackageCommands(workspace, commands);
}
