import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "../../domain/javascript/javascriptStaticAnalysis.js";
import { analyzeJavaScriptSemantics } from "../../domain/javascript/javascriptSemanticAnalysis.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { projectJavaScriptSemanticFileSteps } from "./JavaScriptSemanticGraphBuilder.js";

const source = `${Array.from({ length: 40 }, (_, i) => `function library${String(i)}(){return ${String(i)}}`).join("\n")}
  const e=require("electron");
  function register(channel,callback){e.ipcMain.addListener(channel,event=>allowed(event)&&callback(event))}
  register("test:copy",event=>event.sender.copy());`;
const file: JavaScriptArtifactFile = {
  path: "main.js",
  sha256: "a".repeat(64),
  container_sha256: "b".repeat(64),
  bytes: source.length,
  inventory_artifact_id: `art_${"a".repeat(64)}`,
  kind: "javascript",
  unpacked: false,
  text: { included: true, value: source },
};
const facts = analyzeJavaScriptStaticSource(source);
const ir = analyzeJavaScriptSemantics(source);
const project = (budget: number) => {
  const steps = projectJavaScriptSemanticFileSteps(
    file,
    ir,
    { nodes: budget, unknowns: budget },
    facts.electron.call_paths,
  );
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
};

it("retains Electron calls before library definitions consume the node budget", () => {
  const result = project(20);
  expect(result.nodes).toHaveLength(20);
  expect(result.nodesTruncated).toBe(true);
  const terminal = result.nodes.find(
    (node) => node.label === "ipc-event.sender.copy",
  );
  expect(terminal).toBeDefined();
  expect(
    result.relations.some(
      (r) =>
        r.target_node_id === terminal?.node_id && r.resolution === "candidate",
    ),
  ).toBe(true);
  expect(
    result.nodes.some(
      (node) =>
        node.properties.entry === "test:copy" &&
        Array.isArray(node.properties.conditions) &&
        node.properties.conditions.length === 1,
    ),
  ).toBe(true);
});

it("reports truncation and keeps referential integrity even within a boundary path", () => {
  const result = project(3);
  expect(result.nodes).toHaveLength(3);
  expect(result.nodesTruncated).toBe(true);
  expect(
    result.nodes.some((node) => node.label === "ipc-event.sender.copy"),
  ).toBe(false);
  const retained = new Set(result.nodes.map((node) => node.node_id));
  expect(
    result.relations.every(
      (r) => retained.has(r.source_node_id) && retained.has(r.target_node_id),
    ),
  ).toBe(true);
});
