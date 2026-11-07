import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";
import readline from "node:readline";

const configurationPath =
  process.env.REA_READINESS_CONFIG ?? "./readiness-config.json";
const configuration = JSON.parse(
  await readFile(configurationPath, "utf8").catch(() => "{}"),
);
const prompt = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
process.stdout.write("\u001b[?1049h");
const answer = await new Promise((resolve) =>
  prompt.question("readiness> ", resolve),
);
prompt.close();
const child = spawn(process.execPath, ["-e", "process.stdout.write('child')"]);
const server = createServer((request, response) => {
  response.end(JSON.stringify({ path: request.url, answer }));
});
server.listen(Number(configuration.port ?? 0), "127.0.0.1");
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
  server.close();
  process.stdout.write("\u001b[?1049l");
});
await writeFile(
  configurationPath,
  JSON.stringify({ ...configuration, lastAnswer: answer }),
);
