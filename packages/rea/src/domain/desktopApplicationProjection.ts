import { IL2CPP_METADATA_VERSIONS } from "./il2cpp/il2cppMetadata.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import type { DesktopApplication, DesktopFile } from "./desktopApplication.js";

/** The most next probes this projection derives from any one fact. */
export const DESKTOP_PROBES_PER_FACT = 2;

/** Interpret only the facts admitted by the directory reader, never target bytes. */
export const projectDesktopApplication = (
  files: readonly DesktopFile[],
): Pick<DesktopApplication, "candidates" | "components" | "next_probes"> => {
  const candidates: DesktopApplication["candidates"] = [];
  const components: DesktopApplication["components"] = [];
  const probes = new Map<string, DesktopApplication["next_probes"][number]>();
  const has = (file: DesktopFile, kind: string) =>
    file.facts.some((fact) => fact.kind === kind);
  const candidate = (
    family: DesktopApplication["candidates"][number]["family"],
    basis: readonly DesktopFile[],
    rationale: string,
    confidence: "derived" | "inferred" = "derived",
  ) => {
    if (basis.length === 0) return;
    const semantic = {
      family,
      basis_file_ids: [...new Set(basis.map((file) => file.file_id))].sort(),
      rationale,
      confidence,
    };
    candidates.push({
      candidate_id: `dsc_${digestCanonicalValue(semantic, "Desktop runtime candidate")}`,
      ...semantic,
    });
  };
  const probe = (
    operation: DesktopApplication["next_probes"][number]["operation"],
    file: DesktopFile,
    rationale: string,
  ) => {
    const semantic = {
      operation,
      path: file.local_path,
      file_id: file.file_id,
      rationale,
      confidence: "inferred" as const,
    };
    const probe_id = `dsp_${digestCanonicalValue(semantic, "Desktop next probe")}`;
    probes.set(probe_id, { probe_id, ...semantic });
  };
  const managed = files.filter((file) => has(file, "pe-cli-directory"));
  candidate(
    "dotnet",
    managed,
    "PE optional headers declare nonempty CLI directories; CLR execution and metadata validity remain unverified.",
  );
  for (const file of managed)
    probe(
      "inspect_managed_artifact",
      file,
      "Inspect the declared managed metadata and references.",
    );
  const mono = managed.filter((file) => has(file, "unity-assembly-reference"));
  candidate(
    "unity-mono",
    mono,
    "Managed assemblies in a Unity Data/Managed layout reference UnityEngine assemblies.",
  );
  const metadata = files.filter((file) => has(file, "il2cpp-metadata-header"));
  for (const file of metadata)
    if (
      file.facts.some(
        (fact) =>
          fact.kind === "il2cpp-metadata-header" &&
          IL2CPP_METADATA_VERSIONS.some(
            (version) => version === fact.value.raw_version,
          ),
      )
    )
      probe(
        "inspect_il2cpp_metadata",
        file,
        "Inventory this supported-version metadata candidate; complete validity and native binary correspondence remain unverified.",
      );
  const il2cpp = files.filter(
    (file) =>
      has(file, "il2cpp-library-convention") &&
      has(file, "native-image-header"),
  );
  if (metadata.length > 0 && il2cpp.length > 0) {
    candidate(
      "unity-il2cpp",
      [...metadata, ...il2cpp],
      "IL2CPP metadata magic and conventionally named native libraries coexist; metadata validity and build correspondence are unverified.",
      "inferred",
    );
    for (const file of il2cpp)
      probe(
        "open_binary",
        file,
        "Inspect this native IL2CPP candidate; metadata-to-address correspondence remains unknown.",
      );
  }
  candidate(
    "godot",
    files.filter((file) => has(file, "godot-pck-header")),
    "A standalone or trailer-located Godot pack header was observed; pack contents and encryption are unexamined.",
  );
  for (const file of files.filter((file) => has(file, "unityfs-header")))
    probe(
      "open_binary",
      file,
      "A UnityFS AssetBundle header was observed; member contents and encryption are unexamined.",
    );
  candidate(
    "gamemaker",
    files.filter((file) => has(file, "gamemaker-form-header")),
    "A FORM container begins with a GEN8 chunk; its game resources remain unexamined.",
  );
  candidate(
    "unreal",
    files.filter((file) => has(file, "unreal-container-convention")),
    "Unreal Content/Paks paths or an IoStore TOC header suggest an Unreal package layout.",
    "inferred",
  );
  const electron = files.filter((file) =>
    has(file, "electron-asar-convention"),
  );
  candidate(
    "electron",
    electron,
    "An app.asar in a resources directory suggests an Electron application; archive validity and execution are unverified.",
    "inferred",
  );
  for (const file of electron) {
    probe(
      "open_binary",
      file,
      "Select this ASAR target with open_binary, then call inspect_artifact to inventory it before selecting JavaScript sources.",
    );
    probe(
      "analyze_javascript_application",
      file,
      "Analyze the candidate application archive with the static JavaScript workflow.",
    );
  }
  const componentMarkers = [
    {
      expression: /(?:^|\/)bepinex(?:\/|$)/iu,
      name: "BepInEx",
      category: "mod-loader" as const,
    },
    {
      expression: /(?:^|\/)melonloader(?:\/|$)/iu,
      name: "MelonLoader",
      category: "mod-loader" as const,
    },
    {
      expression: /(?:^|\/)easyanticheat(?:_eos)?(?:\/|$)/iu,
      name: "Easy Anti-Cheat",
      category: "protection" as const,
    },
    {
      expression: /(?:^|\/)battleye(?:\/|$)/iu,
      name: "BattlEye",
      category: "protection" as const,
    },
  ];
  for (const marker of componentMarkers) {
    const basis = files.filter((file) => marker.expression.test(file.path));
    if (basis.length === 0) continue;
    const semantic = {
      name: marker.name,
      category: marker.category,
      basis_file_ids: basis.map((file) => file.file_id),
      confidence: "inferred" as const,
      runtime_presence: "unknown" as const,
    };
    components.push({
      component_id: `dsm_${digestCanonicalValue(semantic, "Desktop component marker")}`,
      ...semantic,
    });
  }
  return { candidates, components, next_probes: [...probes.values()] };
};
