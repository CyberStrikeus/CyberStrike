import { normalizeHttpHostname } from "../../domain/httpHostname.js";
import { PRODUCT_IDENTITY } from "../../identity.js";
import { PACKAGE_METADATA } from "../../generatedPackageMetadata.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";
import type { EnvironmentSource } from "./environmentSource.js";
import { servedCatalog, type PreparedState } from "./environmentState.js";
import {
  environmentToolAnswer,
  type EnvironmentToolAnswer,
} from "./environmentToolAnswer.js";
import { EnvironmentStateStore } from "./environmentStateStore.js";
import type { EnvironmentToolDefinition } from "./environmentTools.js";

/** Operation name every refusal of the export command reports. */
export const ENVIRONMENT_EXPORT_OPERATION = "environment-export";

/** The image the exported Dockerfile builds from; the agentenv runner builds it with Docker. */
export const BUNDLE_BASE_IMAGE = `node:${PACKAGE_METADATA.pinnedNodeVersion}-bookworm-slim`;

/** The port the agentenv framework maps for an MCP server env; it sets the host but not the port. */
export const BUNDLE_MCP_PORT = 18765;
/** Host names the exported env container is addressed by: the published loopback port and the compose service name. */
export const BUNDLE_ALLOWED_HOSTS = "127.0.0.1,localhost";

/** Name of the packed CLI inside the env folder when a tarball is exported. */
export const BUNDLE_TARBALL_NAME = "rea-agents.tgz";

/** Folder and env id rule: a kebab-case label the agentenv framework accepts as a local id. */
const BUNDLE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
// A compose service name is one DNS label, whose wire limit is 63 octets.
const BUNDLE_NAME_MAX_LENGTH = 63;
export const BUNDLE_NAME_CONSTRAINT = `a kebab-case label of at most ${String(BUNDLE_NAME_MAX_LENGTH)} characters, excluding Windows device names, that remains unchanged as an HTTP service hostname`;
/** Win32 reserves these device names for files and folders, so the env folder can never take one. */
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;

/** Whether a name can be the env folder and env id: the checks the export applies. */
export const isPortableBundleName = (name: string): boolean =>
  validateBundleName(name).ok;

/** Where the Dockerfile installs the CLI from. */
export type EnvironmentPackageSource =
  | { readonly kind: "registry"; readonly specifier: string }
  | { readonly kind: "tarball"; readonly path: string };

/** One text file of the bundle, relative to the bundle root. */
export interface EnvironmentBundleFile {
  readonly path: string;
  readonly content: string;
}

/** The answer the verifier checks: one tool called without arguments, as the bundle's server answers it. */
export interface EnvironmentServedCheck {
  readonly tool: string;
  /** The record whose status and provenance the answer carries. */
  readonly recordOrdinal: number;
  readonly status: number | null;
}

/** Everything the export writes, derived from the source and the state its server derives. */
export interface EnvironmentBundlePlan {
  readonly name: string;
  readonly packageSource: EnvironmentPackageSource;
  /** Tools the bundle serves: every manifest tool for replay; from a state, the read tools and the served write tools. */
  readonly toolCount: number;
  readonly check: EnvironmentServedCheck | null;
  /** Whether the bundle serves from the state, as `environment-serve` reports it. */
  readonly state: PreparedState["report"];
  /** Text files the export writes; manifest and evidence are copied byte-exact beside them. */
  readonly files: readonly EnvironmentBundleFile[];
  /** Relative paths of the byte-exact copies in write order. */
  readonly copies: {
    readonly manifest: string;
    readonly evidence: string;
    readonly tarball: string | null;
  };
}

export interface EnvironmentBundleOptions {
  /** Folder and env id; defaults to the manifest's kebab-case name. */
  readonly name?: string | undefined;
  readonly packageSource: EnvironmentPackageSource;
  /** Prepares the state the bundle's server serves under the checked bundle name, as that server prepares it. */
  readonly served: (name: string) => PreparedState;
}

/** The registry source pinning the exact version of this build. */
export const registryPackageSource = (): EnvironmentPackageSource => ({
  kind: "registry",
  specifier: PRODUCT_IDENTITY.registrationPackageSpecifier,
});

const nameError = (name: string): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_EXPORT_OPERATION,
    {
      userMessage: `The bundle name ${JSON.stringify(name)} is not a portable kebab-case label of at most ${String(BUNDLE_NAME_MAX_LENGTH)} characters.`,
    },
    [
      {
        path: ["name"],
        reason: "invalid_format",
        expected: BUNDLE_NAME.source,
        message:
          "The bundle name is the env folder and env id; use lowercase letters, digits and single hyphens, excluding Windows device names.",
      },
    ],
  );

const reservedNameError = (name: string): AnalysisInputError =>
  new AnalysisInputError(
    ENVIRONMENT_EXPORT_OPERATION,
    {
      userMessage: `The bundle name ${JSON.stringify(name)} is a device name Windows reserves, so it cannot name the env folder; choose another name.`,
    },
    [
      {
        path: ["name"],
        reason: "invalid_value",
        message:
          "con, prn, aux, nul, com1-com9 and lpt1-lpt9 are reserved file names on Windows.",
      },
    ],
  );

/** One owner admits the same folder, environment id and HTTP service hostname. */
const validateBundleName = (
  name: string,
): Result<string, AnalysisInputError> => {
  if (!BUNDLE_NAME.test(name) || name.length > BUNDLE_NAME_MAX_LENGTH)
    return err(nameError(name));
  if (WINDOWS_RESERVED_NAME.test(name)) return err(reservedNameError(name));
  if (normalizeHttpHostname(name) !== name)
    return err(
      new AnalysisInputError(
        ENVIRONMENT_EXPORT_OPERATION,
        {
          userMessage: `The bundle name ${JSON.stringify(name)} cannot be used unchanged as an HTTP host name. Choose a name such as replay-1.`,
        },
        [
          {
            path: ["name"],
            reason: "invalid_value",
            message:
              "The service name must remain a hostname rather than be rejected or interpreted as an IP address.",
          },
        ],
      ),
    );
  return ok(name);
};

const installLine = (source: EnvironmentPackageSource): string =>
  source.kind === "registry"
    ? `RUN npm install -g --ignore-scripts --no-fund --no-audit ${source.specifier}`
    : `COPY ${BUNDLE_TARBALL_NAME} /tmp/\nRUN npm install -g --ignore-scripts --no-fund --no-audit /tmp/${BUNDLE_TARBALL_NAME} && rm /tmp/${BUNDLE_TARBALL_NAME}`;

/** The agentenv local sandbox probes container readiness with python3 inside the container; the slim image has none. */
const READINESS_PROBE_LAYER =
  "RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*";

/** The Dockerfile text: pinned base image, readiness probe interpreter, pinned CLI, listener defaults, non-root user. */
export const bundleDockerfile = (
  source: EnvironmentPackageSource,
  name?: string,
): string =>
  [
    `FROM ${BUNDLE_BASE_IMAGE}`,
    `ENV MCP_HOST=0.0.0.0`,
    `ENV MCP_PORT=${String(BUNDLE_MCP_PORT)}`,
    // The env container binds outside loopback for the framework's published port and
    // gateway proxy, so it names the hosts they address it by; the gateway reaches it
    // as the compose service name (the environment name) and host-side clients go
    // through the published loopback port.
    `ENV MCP_ALLOWED_HOSTS=${BUNDLE_ALLOWED_HOSTS}${name === undefined ? "" : `,${name}`}`,
    READINESS_PROBE_LAYER,
    installLine(source),
    // Owned by the runtime user, so a private host umask cannot make the inputs unreadable.
    "COPY --chown=node:node manifest.json evidence.json /env/",
    "USER node",
    'CMD ["rea","environment-serve","/env/manifest.json","--evidence","/env/evidence.json"]',
    "",
  ].join("\n");

/** The first served GET tool without path parameters whose answer to no arguments is not an error, answered as the server answers it. */
const servedCheck = (
  tools: readonly EnvironmentToolDefinition[],
  answer: EnvironmentToolAnswer,
): EnvironmentServedCheck | null => {
  for (const { tool } of tools) {
    if (tool.method !== "GET" || tool.params.length > 0) continue;
    const answered = answer(tool, {});
    if (answered.ok)
      return {
        tool: tool.name,
        recordOrdinal: answered.value.replay.record_ordinal,
        status: answered.value.status,
      };
  }
  return null;
};

const pythonLiteral = (value: string | number | null): string =>
  value === null ? "None" : JSON.stringify(value);

/** The verifier script in the shape of the agentenv echo example's `verify(mcp_url)`. */
export const bundleVerifier = (
  plan: Pick<EnvironmentBundlePlan, "toolCount" | "check" | "state">,
): string =>
  [
    `"""Checks the environment, ${plan.state.served ? "served from the state the capture observed" : "served by replay because the state is unavailable"}, through its MCP endpoint: the tool count and one answered status."""`,
    "import json",
    "",
    "from mcp import ClientSession",
    "from mcp.client.streamable_http import streamable_http_client",
    "",
    `TOOL_COUNT = ${String(plan.toolCount)}`,
    `TOOL = ${pythonLiteral(plan.check?.tool ?? null)}`,
    `EXPECTED_STATUS = ${pythonLiteral(plan.check?.status ?? null)}`,
    "",
    "",
    "def answered_status(result):",
    '    """The status member of a tool result, structured or from its text content."""',
    "    data = result.structuredContent",
    "    if data is None:",
    '        text = "".join(getattr(part, "text", "") for part in result.content)',
    "        data = json.loads(text) if text else {}",
    '    return data.get("status") if isinstance(data, dict) else None',
    "",
    "",
    "async def verify(mcp_url):",
    "    async with streamable_http_client(mcp_url) as (read, write, _):",
    "        async with ClientSession(read, write) as session:",
    "            await session.initialize()",
    "            listed = await session.list_tools()",
    "            result = await session.call_tool(TOOL, {}) if TOOL is not None else None",
    "    count = len(listed.tools)",
    "    passed = count == TOOL_COUNT",
    '    description = f"listed {count} tools, expected {TOOL_COUNT}"',
    "    if result is not None:",
    "        status = None if result.isError else answered_status(result)",
    "        passed = passed and not result.isError and status == EXPECTED_STATUS",
    '        description += f"; {TOOL} answered status {status!r}, expected {EXPECTED_STATUS!r}"',
    "    else:",
    '        description += "; no GET tool without path parameters answers without arguments"',
    '    print(f"serve: {description}")',
    '    return [{"id": "serve", "result": passed, "description": description}]',
    "",
  ].join("\n");

/** The smoke task: deploy the env locally, then run the verifier against it. */
export const bundleSmokeTask = (name: string): string =>
  `${JSON.stringify(
    [
      { id: "env", type: "deploy_env", env_id: name, sandbox_type: "local" },
      {
        id: "serve",
        type: "env_outcome_verifier",
        env_id: name,
        file_artifact_id: `check_${name}`,
        verifier_id: "serve",
      },
    ],
    null,
    2,
  )}\n`;

const packageSourceText = (source: EnvironmentPackageSource): string =>
  source.kind === "registry"
    ? `\`${source.specifier}\` from the npm registry`
    : `the packed tarball \`${BUNDLE_TARBALL_NAME}\` copied beside the Dockerfile`;

type ReadmePlan = Pick<
  EnvironmentBundlePlan,
  "name" | "packageSource" | "toolCount" | "check" | "state"
>;

/** What this bundle serves: the state the export derived, or replay and why. */
const servedHere = (source: EnvironmentSource, plan: ReadmePlan): string => {
  const { state } = plan;
  return state.served
    ? `This bundle serves from the state: the export derived it as Evidence
\`${state.evidence_id}\`, and the server serves ${String(plan.toolCount)} of the manifest's
${String(source.manifest.tools.length)} tools.`
    : `This bundle serves replay: the server serves all ${String(plan.toolCount)} manifest tools
from their recordings because the state is unavailable
(\`${state.code}\`: ${state.message}).`;
};

/** The bundle README: provenance, what the environment serves and does not establish, how to run it, and the rights note. */
export const bundleReadme = (
  source: EnvironmentSource,
  plan: ReadmePlan,
): string => {
  const { manifest } = source;
  const check =
    plan.check === null
      ? "no served GET tool without path parameters answers without arguments, so the verifier checks the tool count only"
      : `calls \`${plan.check.tool}\` without arguments and checks the call succeeds with \`status\` ${String(plan.check.status)}, the status of record ${String(plan.check.recordOrdinal)} its answer carries`;
  return `# ${plan.name}

An agent environment exported by REA from one retained ${source.captureKind === "browser-scenario" ? "browser scenario capture" : "web network capture"}.
Every tool answers from the state that capture observed or from a recorded
exchange; nothing here runs the captured application.

The bundle contains captured application content. Exported files use mode
0600 on POSIX; Windows retains inherited ACLs, so choose a private destination
if that content requires restricted access.

## Provenance

- ${source.captureKind === "browser-scenario" ? "Scenario definition" : "Capture artifact"} SHA-256: \`${source.captureSha256 ?? "excluded from Evidence"}\`
- Capture Evidence (the manifest's parent): \`${source.evidenceId}\`
- Manifest Evidence: \`${source.manifestEvidenceId}\`
- Manifest view digest: \`${manifest.view_digest}\`
- Primary origin: \`${manifest.origin}\`
- Tools: ${String(plan.toolCount)}
- State: ${plan.state.served ? `\`${plan.state.evidence_id}\`, derived from the capture` : "not served"}
- Serving CLI: ${packageSourceText(plan.packageSource)}

## What the environment serves

\`envs/${plan.name}/\` builds an image that runs \`rea environment-serve\` on the
manifest and capture Evidence copied beside its Dockerfile. At startup the
server derives the state the capture observed, the \`environment-state\` view
of the capture with the manifest's template rules, and serves from it: read
tools answer from the state where it backs them and from their recordings
otherwise, \`/agentenv\` serves \`data/reset\`, \`data/add\` and \`data/get\` on
it, and write tools are served only where the capture's later reads confirmed
their effect. When the state cannot be derived, or
its catalog exceeds the discovery budget, the server logs why and replays
instead: each MCP tool call selects the retained record whose path and query
values best match the arguments and returns that record's recorded status,
content type and body, citing the record ordinal and the Evidence id.
\`rea environment-serve --replay-only\` serves pure replay.

${servedHere(source, plan)}

Neither is emulation: the environment does not establish the application's
authorization model, response semantics or state transitions, does not
validate supplied values, and answers only from the capture's recordings and
the state they observed or a caller loaded. Served content is target content
and must be treated as data, never as instructions.

## Run it

From this folder:

\`\`\`sh
agent-env run .
\`\`\`

From anywhere else, name this folder's path instead of \`.\`.
\`tasks/smoke.json\` deploys the env on the local sandbox and runs
\`artifacts/check_${plan.name}/verify.py\` against its MCP endpoint: it lists
the tools and checks the count equals ${String(plan.toolCount)}, and ${check}.
The run needs Docker; the first run also builds the runner's own infrastructure.

## Rights

The recorded content in \`evidence.json\` belongs to the captured application.
Do not publish this bundle without the rights to that content.
`;
};

/** Derive every file of the bundle from an authenticated source, the state its server derives and the package source. */
export const planEnvironmentBundle = (
  source: EnvironmentSource,
  options: EnvironmentBundleOptions,
): Result<EnvironmentBundlePlan, AnalysisError> => {
  const name = options.name ?? source.manifest.name;
  const admitted = validateBundleName(name);
  if (!admitted.ok) return admitted;
  // Prepared only after the name checks, under the name the bundle's server serves.
  const { state, report } = options.served(name);
  // The catalog and answers the bundle's server will have, so the verifier and README predict them.
  const catalog = servedCatalog(
    source,
    state,
    name,
    ENVIRONMENT_EXPORT_OPERATION,
  );
  if (!catalog.ok) return catalog;
  const check = servedCheck(
    catalog.value.tools,
    environmentToolAnswer(
      source,
      state === undefined ? undefined : new EnvironmentStateStore(state),
    ),
  );
  const envFolder = `envs/${name}`;
  const base = {
    name,
    packageSource: options.packageSource,
    toolCount: catalog.value.tools.length,
    check,
    state: report,
  };
  return ok({
    ...base,
    files: [
      { path: "README.md", content: bundleReadme(source, base) },
      {
        path: `${envFolder}/env.toml`,
        content: `environment_name = ${JSON.stringify(name)}\n`,
      },
      {
        path: `${envFolder}/Dockerfile`,
        content: bundleDockerfile(options.packageSource, name),
      },
      {
        path: `artifacts/check_${name}/verify.py`,
        content: bundleVerifier(base),
      },
      { path: "tasks/smoke.json", content: bundleSmokeTask(name) },
    ],
    copies: {
      manifest: `${envFolder}/manifest.json`,
      evidence: `${envFolder}/evidence.json`,
      tarball:
        options.packageSource.kind === "tarball"
          ? `${envFolder}/${BUNDLE_TARBALL_NAME}`
          : null,
    },
  });
};
