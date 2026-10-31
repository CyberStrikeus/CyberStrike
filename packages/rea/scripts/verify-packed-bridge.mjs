import { GHIDRA_BRIDGE_SOURCES } from "../src/ghidra/GhidraBridgeSources.ts";

const packedHopperBridge = "package/bridge/hopper_bridge.py";
const packedCutterBridge = "package/bridge/cutter/rea_bridge.py";

/** Check shipped bridge files; real-provider lanes verify runtime behavior. */
export async function verifyPackedBridge({ tarball, packedFiles, commands }) {
  if (
    packedFiles.some(
      (path) => path.includes("__pycache__") || path.endsWith(".pyc"),
    )
  ) {
    throw new Error("package contained generated Python bytecode");
  }
  for (const path of [
    packedHopperBridge,
    packedCutterBridge,
    ...Object.values(GHIDRA_BRIDGE_SOURCES).map(
      (name) => `package/bridge/ghidra/${name}`,
    ),
  ]) {
    if (!packedFiles.includes(path)) throw new Error(`package omitted ${path}`);
  }
  // Read the packed source without extracting into the caller's leased root.
  // Only the interpreter's standard library is needed; caller-local modules
  // and site startup hooks must not replace the parser or execute here.
  await commands.exec("python3", [
    "-I",
    "-S",
    "-c",
    [
      "import ast, sys, tarfile",
      "with tarfile.open(sys.argv[1]) as archive:",
      "    member = archive.getmember(sys.argv[2])",
      "    if not member.isfile():",
      "        raise ValueError(f'{member.name} is not a regular file')",
      "    with archive.extractfile(member) as source:",
      "        ast.parse(source.read().decode('utf-8'), filename=sys.argv[2])",
    ].join("\n"),
    tarball,
    packedHopperBridge,
  ]);
}
