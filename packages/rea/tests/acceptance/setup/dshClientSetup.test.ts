import { artifactMcpCall } from "../../../scripts/lib/artifact-e2e.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for([
  {
    label: "blank defaults",
    harness: "",
    agents: " \t ",
    dshRoot: "home/.dsh",
    agentsRoot: "home/.agents",
  },
  {
    label: "tilde roots",
    harness: "~/selected harness",
    agents: "~\\shared agents",
    dshRoot: "home/selected harness",
    agentsRoot: "home/shared agents",
  },
  {
    label: "relative roots",
    harness: "./selected harness",
    agents: "../shared agents",
    dshRoot: "workspace/selected harness",
    agentsRoot: "shared agents",
  },
])(
  "DSH CLI uses Harness path semantics through setup, doctor and uninstall for $label",
  async ({ harness, agents, dshRoot, agentsRoot }, { cli }) => {
    const root = await createTestTempDirectory("rea-dsh-paths-");
    const home = join(root, "home");
    const cwd = join(root, "workspace");
    const config = join(root, dshRoot, "cordis.patch.yml");
    const skillRoot = join(
      root,
      agentsRoot,
      "skills",
      "reverse-engineer-anything",
    );
    const skill = join(skillRoot, "SKILL.md");
    await mkdir(home);
    await mkdir(cwd);
    await mkdir(dirname(config), { recursive: true });
    const original =
      "# caller patch\n- insert: [{id: caller, name: caller-plugin}]\n";
    await writeFile(config, original);
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: [...args, "--json"],
        cwd,
        environment: {
          HOME: home,
          USERPROFILE: home,
          DSH_HOME: harness,
          DSH_AGENTS_HOME: agents,
        },
      });
    const planned = await run(["setup", "--client", "dsh", "--dry-run"]);
    expect(planned.exitCode).toBe(0);
    expect(planned.json).toMatchObject({
      status: "planned",
      appliedActions: [],
      plannedActions: expect.arrayContaining([
        expect.objectContaining({ id: "configure_client:dsh", target: config }),
        expect.objectContaining({ kind: "install_skill", target: skillRoot }),
      ]),
    });
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(readFile(skill)).rejects.toMatchObject({ code: "ENOENT" });
    const configured = await run(["setup", "--client", "dsh", "--yes"]);
    expect(configured.exitCode).toBe(0);
    expect(configured.json).toMatchObject({
      status: "ready",
      clients: { dsh: { status: "configured" } },
    });
    const text = await readFile(config, "utf8");
    expect(text).toContain("# caller patch");
    expect(text).toContain("rea-mcp");
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    expect(await readFile(skill, "utf8")).toContain(
      "name: reverse-engineer-anything",
    );
    const doctor = await run(["doctor", "--client", "dsh", "--skill"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json).toMatchObject({ healthy: true });
    const repeated = await run(["setup", "--client", "dsh", "--yes"]);
    expect(repeated.exitCode).toBe(0);
    expect(repeated.json).toMatchObject({
      status: "ready",
      plannedActions: [],
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(text);
    const removed = await run(["uninstall"]);
    expect(removed.exitCode).toBe(0);
    expect(removed.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "dsh", status: "removed" }),
      ]),
    });
    expect(parse(await readFile(config, "utf8"))).toEqual([
      { insert: [{ id: "caller", name: "caller-plugin" }] },
    ]);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    await expect(readFile(skill)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

cliTest(
  "DSH CLI previews, approves, repairs, launches MCP, repeats and uninstalls while preserving caller YAML",
  async ({ cli }) => {
    const home = await createTestTempDirectory("rea-dsh-lifecycle-");
    const profile = join(home, "selected harness");
    const config = join(profile, "cordis.patch.yml");
    const skill = join(
      home,
      ".agents/skills/reverse-engineer-anything/SKILL.md",
    );
    await mkdir(profile);
    const original = `# caller home patch
- insert:
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config: {serverName: rea, transport: stdio, command: stale, args: [mcp]}
- holder: &op
    insert:
      - id: unrelated
        name: caller-plugin
        disabled: true
        config: {cwd: !!js process.cwd()}
      - id: rea-mcp
        name: '@deepseek-ai/dsh-mcp-client'
        config:
          serverName: rea
          transport: stdio
          command: stale
          args: [mcp]
          cwd: !!js process.cwd()
          env:
            REA_LOG_LEVEL: !!js process.env.REA_LOG_LEVEL
- *op
`;
    await writeFile(config, original);
    const environment = { HOME: home, USERPROFILE: home, DSH_HOME: profile };
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: [...args, "--json"],
        cwd: home,
        environment,
        timeoutMs: 20_000,
      });
    const plan = await run(["setup", "--client", "dsh", "--dry-run"]);
    expect(plan.exitCode).toBe(0);
    expect(plan.json).toMatchObject({
      status: "planned",
      appliedActions: [],
      plannedActions: expect.arrayContaining([
        expect.objectContaining({ id: "configure_client:dsh", target: config }),
        expect.objectContaining({ id: "install_skill" }),
      ]),
    });
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const unapproved = await run(["setup", "--client", "dsh"]);
    expect(unapproved.json).toMatchObject({
      status: "needs_confirmation",
      appliedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(original);
    const configured = await run(["setup", "--client", "dsh", "--yes"]);
    expect(configured.exitCode).toBe(0);
    expect(configured.json).toMatchObject({
      status: "ready",
      clients: { dsh: { status: "configured" } },
    });
    const text = await readFile(config, "utf8");
    expect(text).toContain("# caller home patch");
    const patches = parse(text, {
      customTags: [
        {
          tag: "tag:yaml.org,2002:js",
          resolve: (source: string) => ({ __jsExpr: source }),
        },
      ],
    }) as { insert?: { id: string; config: unknown }[] }[];
    const rows = patches.flatMap((patch) => patch.insert ?? []);
    expect(rows.filter(({ id }) => id === "unrelated")).toEqual([
      {
        id: "unrelated",
        name: "caller-plugin",
        disabled: true,
        config: { cwd: { __jsExpr: "process.cwd()" } },
      },
    ]);
    expect(rows.filter(({ id }) => id === "rea-mcp")).toHaveLength(1);
    const registration = z
      .object({
        command: z.string(),
        args: z.array(z.string()),
        cwd: z.unknown(),
        env: z.unknown(),
      })
      .parse(rows.find(({ id }) => id === "rea-mcp")?.config);
    expect(registration.cwd).toEqual({ __jsExpr: "process.cwd()" });
    expect(registration.env).toMatchObject({
      REA_LOG_LEVEL: { __jsExpr: "process.env.REA_LOG_LEVEL" },
    });
    const doctor = await run(["doctor", "--client", "dsh", "--skill"]);
    expect(doctor.exitCode).toBe(0);
    expect(doctor.json).toMatchObject({
      healthy: true,
      identity: {
        registrations: expect.arrayContaining([
          expect.objectContaining({ client: "dsh", state: "aligned" }),
        ]),
      },
    });
    await verifyGeneratedLauncher(registration, home, environment);
    const repeated = await run(["setup", "--client", "dsh", "--yes"]);
    expect(repeated.json).toMatchObject({
      status: "ready",
      appliedActions: [],
      plannedActions: [],
    });
    expect(await readFile(config, "utf8")).toBe(text);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    const removed = await run(["uninstall"]);
    expect(removed.exitCode).toBe(0);
    expect(removed.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "dsh", status: "removed" }),
      ]),
    });
    const remaining = parse(await readFile(config, "utf8"), {
      logLevel: "silent",
    }) as { insert?: { id: string }[] }[];
    expect(
      remaining.flatMap((patch) => patch.insert ?? []).map(({ id }) => id),
    ).toEqual(["unrelated"]);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(original);
    await expect(readFile(skill)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

async function verifyGeneratedLauncher(
  registration: { command: string; args: string[] },
  home: string,
  environment: Record<string, string>,
): Promise<void> {
  // Exercise the generated launcher. Native Cordis expression evaluation belongs
  // to verify:deepseek-client, not this SDK transport journey.
  const transport = new StdioClientTransport({
    command: registration.command,
    args: registration.args,
    cwd: home,
    env: { PATH: process.env.PATH ?? "", ...environment },
    stderr: "pipe",
  });
  const client = new Client({ name: "dsh-setup-lifecycle", version: "1" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map(({ name }) => name)).toContain(
      "binary_session",
    );
    const session = await artifactMcpCall(client, {
      name: "binary_session",
      arguments: {},
    });
    expect(session.isError).not.toBe(true);
    expect(session.structuredContent).toMatchObject({
      result: { open: false },
    });
  } finally {
    await client.close();
    await transport.close();
  }
}

cliTest.for(["null", "caller-value", "[caller-value]"])(
  "DSH CLI refuses to edit config %s and plain uninstall removes its owned row",
  async (configValue, { cli }) => {
    const home = await createTestTempDirectory("rea-dsh-malformed-config-");
    const profile = join(home, ".dsh");
    const config = join(profile, "cordis.patch.yml");
    await mkdir(profile);
    const initial = `# caller patch
- insert:
    - id: other
      name: caller-plugin
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config: ${configValue}
`;
    await writeFile(config, initial);
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: [...args, "--json"],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, DSH_HOME: profile },
      });
    const configured = await run(["setup", "--client", "dsh", "--yes"]);
    expect(configured.exitCode).not.toBe(0);
    expect(configured.json).toMatchObject({
      status: "needs_human",
      appliedActions: [],
      remediation: expect.stringContaining("config: Use a literal mapping"),
    });
    expect(await readFile(config, "utf8")).toBe(initial);
    await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const removed = await run(["uninstall"]);
    expect(removed.exitCode).toBe(0);
    expect(removed.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "dsh", status: "removed" }),
      ]),
    });
    const remaining = await readFile(config, "utf8");
    expect(remaining).toContain("# caller patch");
    expect(parse(remaining)).toEqual([
      { insert: [{ id: "other", name: "caller-plugin" }] },
    ]);
    expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(initial);
  },
);

cliTest.for([
  {
    label: "group-owned rows",
    patch: `- id: tools
  insert:
    - id: other
      name: caller-plugin
    - id: rea-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config: {serverName: rea, transport: stdio, command: stale, args: [mcp]}
`,
    remediation: "group with unknown activity",
    removal: "removed",
  },
  {
    label: "expression-backed inserts",
    patch: "- insert: !!js process.env.DSH_ROWS\n",
    remediation: "unknown structure",
    removal: "retained",
  },
])(
  "DSH CLI rejects setup and preserves ownership for $label",
  async ({ patch, remediation, removal }, { cli }) => {
    const home = await createTestTempDirectory("rea-dsh-ownership-");
    const profile = join(home, ".dsh");
    const config = join(profile, "cordis.patch.yml");
    await mkdir(profile);
    await writeFile(config, patch);
    const run = (args: readonly string[]) =>
      cli.run({
        arguments: [...args, "--json"],
        cwd: home,
        environment: { HOME: home, USERPROFILE: home, DSH_HOME: profile },
      });
    const setup = await run(["setup", "--client", "dsh", "--yes"]);
    expect(setup.exitCode).not.toBe(0);
    expect(setup.json).toMatchObject({
      status: "needs_human",
      appliedActions: [],
      remediation: expect.stringContaining(remediation),
    });
    expect(await readFile(config, "utf8")).toBe(patch);
    await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const uninstall = await run(["uninstall"]);
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.json).toMatchObject({
      status: "complete",
      items: expect.arrayContaining([
        expect.objectContaining({ name: "dsh", status: removal }),
      ]),
    });
    if (removal === "removed") {
      expect(parse(await readFile(config, "utf8"))).toEqual([
        { id: "tools", insert: [{ id: "other", name: "caller-plugin" }] },
      ]);
      expect(await readFile(`${config}.rea.backup`, "utf8")).toBe(patch);
    } else {
      expect(await readFile(config, "utf8")).toBe(patch);
      await expect(readFile(`${config}.rea.backup`)).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  },
);
