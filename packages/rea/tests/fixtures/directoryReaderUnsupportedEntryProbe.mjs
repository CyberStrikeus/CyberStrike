import { pathToFileURL } from "node:url";

const [modulePath, root] = process.argv.slice(2);
if (modulePath === undefined || root === undefined)
  throw new Error("Directory reader probe requires module and root paths");

const { DirectoryArtifactReader } = await import(pathToFileURL(modulePath));
const reader = new DirectoryArtifactReader(root);
const paths = [];
try {
  for await (const entry of reader.entries()) paths.push(entry.path);
} finally {
  await reader.close();
}
process.stdout.write(`${JSON.stringify(paths)}\n`);
