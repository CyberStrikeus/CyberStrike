import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Optional verification tool only; the runtime inspector never starts dtc.
const dtc = process.env.REA_DTC_PATH ?? "dtc";
assert.match(
  execFileSync(dtc, ["--version"], { encoding: "utf8" }),
  /DTC 1\.8\.1\b/,
);
const root = mkdtempSync(join(tmpdir(), "rea-dtb-verification-"));
try {
  const source = join(root, "board.dts"),
    blob = join(root, "board.dtb");
  writeFileSync(
    source,
    `/dts-v1/;
/memreserve/ 0x80000000 0x1000;
/ {
  compatible = "rea,verification"; model = "REA DTB verification";
  #address-cells = <1>; #size-cells = <1>;
  chosen { bootargs = "console=ttyS0"; stdout-path = "serial0"; };
  aliases { serial0 = &serial; };
  reserved-memory { #address-cells = <1>; #size-cells = <1>; ranges;
    region@80000000 { reg = <0x80000000 0x1000>; no-map; };
  };
  serial: serial@1000 { reg = <0x1000 0x100>; phandle = <1>; };
  consumer { remote-endpoint = <&serial>; };
};\n`,
  );
  execFileSync(dtc, ["-I", "dts", "-O", "dtb", "-o", blob, source]);
  const decompiled = execFileSync(dtc, ["-I", "dtb", "-O", "dts", blob], {
    encoding: "utf8",
  });
  const evidence = JSON.parse(
    execFileSync(
      process.execPath,
      ["scripts/rea.mjs", "inspect-devicetree", blob, "--json"],
      { encoding: "utf8" },
    ),
  );
  const report = evidence.normalized_result;
  // This controlled fixture uses one opening/closing brace per node line.
  const paths = [],
    stack = [];
  for (const line of decompiled.split("\n")) {
    const begin = /^\s*([^\s{}]+)\s*\{\s*$/.exec(line);
    if (begin) {
      stack.push(begin[1]);
      paths.push(stack.length === 1 ? "/" : `/${stack.slice(1).join("/")}`);
    }
    if (/^\s*};/.test(line)) stack.pop();
  }
  assert.deepEqual(
    report.nodes.map((n) => n.path),
    paths,
  );
  assert.equal(report.summary.bootargs, "console=ttyS0");
  assert.deepEqual(report.summary.aliases, [
    { name: "serial0", path: "/serial@1000" },
  ]);
  assert.equal(report.references[0].target, "/serial@1000");
  assert.equal(report.reservations[0].address, "0x80000000");
  assert.equal(
    report.nodes
      .find((n) => n.path.endsWith("region@80000000"))
      .properties.find((p) => p.name === "reg").derived.reg[0].size,
    "0x1000",
  );
  assert.equal(readFileSync(blob).readUInt32BE(0), 0xd00dfeed);
  console.log(
    JSON.stringify(
      {
        dtc: "1.8.1",
        matched_node_paths: paths,
        summary: report.summary,
        reservations: report.reservations,
        references: report.references,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
