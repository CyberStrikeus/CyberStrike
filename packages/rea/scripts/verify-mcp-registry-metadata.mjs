import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) =>
  JSON.parse(await readFile(join(root, path), "utf8"));
const fail = (message) => {
  throw new Error(`MCP Registry metadata is invalid: ${message}`);
};

const packageJson = await readJson("package.json");
const serverJson = await readJson("server.json");
const registryPackage = serverJson.packages?.[0];

if (packageJson.name !== "rea-agents") fail("unexpected npm package name");
if (typeof packageJson.version !== "string")
  fail("package.json is missing a string version");
if (packageJson.mcpName !== "io.github.morluto/rea")
  fail("package.json mcpName does not identify io.github.morluto/rea");
if (serverJson.name !== packageJson.mcpName)
  fail("server.json name does not match package.json mcpName");
if (serverJson.version !== packageJson.version)
  fail("server.json version does not match package.json version");
if (!Array.isArray(serverJson.packages) || serverJson.packages.length !== 1)
  fail("server.json must describe exactly one npm package");
if (registryPackage === undefined)
  fail("server.json is missing its npm package");
if (registryPackage.registryType !== "npm")
  fail("server.json package must use the npm registry");
if (registryPackage.registryBaseUrl !== "https://registry.npmjs.org")
  fail("server.json package must use the public npm registry");
if (registryPackage.identifier !== packageJson.name)
  fail("server.json package identifier does not match package.json name");
if (registryPackage.version !== packageJson.version)
  fail("server.json package version does not match package.json version");
if (registryPackage.runtimeHint !== "npx")
  fail("server.json package must declare the npx runtime");
if (registryPackage.transport?.type !== "stdio")
  fail("server.json package must declare stdio transport");
if (
  !Array.isArray(registryPackage.packageArguments) ||
  registryPackage.packageArguments.length !== 1 ||
  registryPackage.packageArguments[0]?.type !== "positional" ||
  registryPackage.packageArguments[0]?.value !== "mcp"
)
  fail("server.json package must launch the existing mcp command");

process.stdout.write(
  `MCP Registry metadata is aligned for ${packageJson.name}@${packageJson.version}.\n`,
);
