import assert from "node:assert/strict";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const [repo, gpuPath, modelPath] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/dist/${path}`));
const { GpuCodeObjectsProvider } = await load("gpu/GpuCodeObjectsProvider.js");
const { GpuCodeObjectsService } = await load(
  "application/gpu/GpuCodeObjectsService.js",
);
const { ModelArtifactProvider } = await load("model/ModelArtifactProvider.js");
const { ModelArtifactService } = await load(
  "application/model/ModelArtifactService.js",
);
const { projectAnalysisError } = await load(
  "domain/analysisErrorProjection.js",
);
const cases = [
  {
    name: "gpu",
    service: new GpuCodeObjectsService(new GpuCodeObjectsProvider()),
    request: { path: gpuPath, analysis: "kernels", detail: "complete" },
  },
  {
    name: "model",
    service: new ModelArtifactService(new ModelArtifactProvider()),
    request: { path: modelPath, detail: "complete" },
  },
];
const handles = [];
const before = [],
  pressure = [],
  after = [];
try {
  for (const item of cases) {
    const result = await item.service.inspect(item.request);
    assert.equal(result.ok, true, JSON.stringify(result));
    before.push(result.value);
  }
  let exhausted = false;
  for (let index = 0; index < 128; index += 1) {
    try {
      handles.push(await open("/dev/null", "r"));
    } catch (cause) {
      assert.equal(cause.code, "EMFILE");
      exhausted = true;
      break;
    }
  }
  assert.equal(exhausted, true, "Child must run under a low descriptor limit");
  for (const item of cases) {
    const result = await item.service.inspect(item.request);
    assert.equal(result.ok, false);
    pressure.push({
      name: item.name,
      system_code: result.error.cause?.code,
      projection: projectAnalysisError(result.error),
    });
  }
  for (const handle of handles) await handle.close();
  handles.length = 0;
  for (const [index, item] of cases.entries()) {
    const result = await item.service.inspect(item.request);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      result.value.normalized_result,
      before[index].normalized_result,
    );
    after.push({ name: item.name, restored: true });
  }
  process.stdout.write(JSON.stringify({ pressure, after }));
} finally {
  for (const handle of handles) await handle.close();
  for (const item of cases) await item.service.close();
}
