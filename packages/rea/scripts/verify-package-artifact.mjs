import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

/** Run artifact and JavaScript application analysis against packaged fixtures. */
export async function verifyPackageArtifactAndElectron({
  commands,
  cli,
  workspace,
  environment,
}) {
  const artifactArchive = await verifyPackagedArtifact({
    commands,
    cli,
    workspace,
    environment,
  });
  await verifyPackagedElectronApplication({
    commands,
    cli,
    workspace,
    environment,
  });
  return { artifactArchive };
}

const verifyPackagedArtifact = async ({
  commands,
  cli,
  workspace,
  environment,
}) => {
  const artifactArchive = join(workspace, "artifact.zip");
  const artifactWriter = new ZipWriter(new Uint8ArrayWriter());
  await artifactWriter.add("app/main.js", new TextReader("main();"));
  await writeFile(artifactArchive, await artifactWriter.close());
  const artifactInspection = JSON.parse(
    await commands.run(
      cli,
      ["inspect-artifact", artifactArchive, "--json"],
      environment,
    ),
  );
  const repeatedArtifactInspection = JSON.parse(
    await commands.run(
      cli,
      ["inspect-artifact", artifactArchive, "--json"],
      environment,
    ),
  );
  const artifactInventory =
    artifactInspection.normalized_result?.substeps?.[0]?.evidence
      ?.normalized_result;
  const repeatedArtifactInventory =
    repeatedArtifactInspection.normalized_result?.substeps?.[0]?.evidence
      ?.normalized_result;
  if (
    artifactInspection.operation !== "inspect_artifact" ||
    artifactInspection.provider?.id !== "rea-artifact-graph" ||
    artifactInventory?.manifest?.root_format !== "zip" ||
    !sameArtifactIdentity(artifactInventory, repeatedArtifactInventory)
  )
    throw new Error("packaged artifact inventory CLI failed");
  await verifyPackagedArtifactExtraction({
    commands,
    artifactArchive,
    artifactInventory,
    cli,
    environment,
    workspace,
  });
  return artifactArchive;
};

const verifyPackagedElectronApplication = async ({
  commands,
  cli,
  workspace,
  environment,
}) => {
  const applicationRoot = join(workspace, "electron-app");
  await mkdir(applicationRoot);
  await writeFile(
    join(applicationRoot, "package.json"),
    '{"name":"packaged-electron-fixture","main":"main.js"}\n',
  );
  await writeFile(
    join(applicationRoot, "main.js"),
    'const { BrowserWindow, ipcMain } = require("electron");\nnew BrowserWindow({ webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true } });\nipcMain.handle("rea:ping", () => true);\n',
  );
  await writeFile(
    join(applicationRoot, "preload.js"),
    'const { contextBridge, ipcRenderer } = require("electron");\ncontextBridge.exposeInMainWorld("rea", { ping: () => ipcRenderer.invoke("rea:ping") });\n',
  );
  const applicationAnalysis = JSON.parse(
    await commands.run(
      cli,
      ["analyze-javascript-application", applicationRoot, "--json"],
      environment,
    ),
  );
  if (
    applicationAnalysis.operation !== "analyze_javascript_application" ||
    applicationAnalysis.provider?.id !== "rea-javascript-application" ||
    applicationAnalysis.normalized_result?.summary?.browser_windows !== 1 ||
    applicationAnalysis.normalized_result?.summary?.ipc
      ?.paired_renderer_transmissions !== 1
  )
    throw new Error("packaged JavaScript application analysis CLI failed");
  const routedApplicationAnalysis = JSON.parse(
    await commands.run(
      cli,
      ["analyze", applicationRoot, "--json"],
      environment,
    ),
  );
  assertRoutedApplicationAnalysis(routedApplicationAnalysis);
};

const sameArtifactIdentity = (left, right) =>
  isDeepStrictEqual(left?.manifest, right?.manifest) &&
  isDeepStrictEqual(left?.nodes, right?.nodes) &&
  isDeepStrictEqual(left?.occurrences, right?.occurrences) &&
  isDeepStrictEqual(left?.edges, right?.edges);

const verifyPackagedArtifactExtraction = async ({
  commands,
  artifactArchive,
  artifactInventory,
  cli,
  environment,
}) => {
  const occurrence = artifactInventory?.occurrences?.find(
    ({ logical_path: path }) => path === "app/main.js",
  );
  if (occurrence?.logical_path === undefined)
    throw new Error("packaged artifact inventory omitted the selected member");
  const extraction = JSON.parse(
    await commands.run(
      cli,
      ["extract-artifact", artifactArchive, "--json"],
      environment,
    ),
  );
  const outputRoot = extraction.normalized_result?.output_root;
  try {
    if (
      extraction.operation !== "extract_artifact" ||
      extraction.provider?.id !== "rea-artifact-graph" ||
      extraction.normalized_result?.containment_verified !== true ||
      extraction.normalized_result?.artifacts?.some(
        ({ relative_path: path }) => path === occurrence.logical_path,
      ) !== true ||
      typeof outputRoot !== "string" ||
      (await readFile(join(outputRoot, "app/main.js"), "utf8")) !== "main();"
    )
      throw new Error("packaged artifact extraction CLI failed");
  } finally {
    if (typeof outputRoot === "string")
      await rm(outputRoot, { recursive: true, force: true });
  }
};

const assertRoutedApplicationAnalysis = (analysis) => {
  if (
    analysis.operation !== "analyze_javascript_application" ||
    analysis.provider?.id !== "rea-javascript-application" ||
    analysis.normalized_result?.format !== "directory" ||
    analysis.normalized_result?.summary?.ipc?.paired_renderer_transmissions !==
      1
  )
    throw new Error("packaged routed JavaScript application analysis failed");
};
