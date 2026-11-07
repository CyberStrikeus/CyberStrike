import { currentClientRegistrationCommand } from "../../src/application/ClientRegistrationIdentity.js";

export const codexToolPolicy = {
  default_tools_approval_mode: "prompt",
  enabled_tools: ["binary_session", "inspect_binary"],
  disabled_tools: ["run_script"],
  required: true,
  cwd: "/caller/working-directory",
  future_policy: { label: "retain this client setting" },
  tools: {
    binary_session: {
      approval_mode: "approve",
      output_token_limit: 9007199254740993n,
    },
    "inspect.binary": { approval_mode: "auto" },
    "run/script": { approval_mode: "writes" },
    ["__proto__"]: { approval_mode: "prompt", future_option: true },
  },
};

/** The same client policy in native table and inline-table representations. */
export const codexToolPolicySource = (
  layout: "tables" | "inline table",
  registrationCommand: readonly string[] = currentClientRegistrationCommand(),
): string => {
  const [command, ...args] = registrationCommand;
  return layout === "tables"
    ? [
        "# retained root comment",
        'model = "caller-model"',
        "[mcp_servers.other]",
        'command = "other"',
        "[mcp_servers.rea]",
        `command = ${JSON.stringify(command)}`,
        `args = ${JSON.stringify(args)}`,
        "startup_timeout_sec = 19",
        "tool_timeout_sec = 999",
        'default_tools_approval_mode = "prompt"',
        'enabled_tools = ["binary_session", "inspect_binary"]',
        'disabled_tools = ["run_script"]',
        "required = true",
        'cwd = "/caller/working-directory"',
        'future_policy = { label = "retain this client setting" }',
        "[mcp_servers.rea.env]",
        'CALLER_SETTING = "kept exactly"',
        "[mcp_servers.rea.tools.binary_session]",
        'approval_mode = "approve" # caller approval',
        "output_token_limit = 9007199254740993",
        '[mcp_servers.rea.tools."inspect.binary"]',
        'approval_mode = "auto"',
        '[mcp_servers.rea.tools."run/script"]',
        'approval_mode = "writes"',
        "[mcp_servers.rea.tools.__proto__]",
        'approval_mode = "prompt"',
        "future_option = true",
        "",
      ].join("\n")
    : [
        "# retained root comment",
        'model = "caller-model"',
        `mcp_servers = { other = { command = "other" }, rea = { command = ${JSON.stringify(command)}, args = ${JSON.stringify(args)}, startup_timeout_sec = 19, tool_timeout_sec = 999, default_tools_approval_mode = "prompt", enabled_tools = ["binary_session", "inspect_binary"], disabled_tools = ["run_script"], required = true, cwd = "/caller/working-directory", future_policy = { label = "retain this client setting" }, env = { CALLER_SETTING = "kept exactly" }, tools = { binary_session = { approval_mode = "approve", output_token_limit = 9007199254740993 }, "inspect.binary" = { approval_mode = "auto" }, "run/script" = { approval_mode = "writes" }, __proto__ = { approval_mode = "prompt", future_option = true } } } }`,
        "",
      ].join("\n");
};
