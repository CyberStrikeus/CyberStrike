#!/usr/bin/env python3
"""Generate static-only verification artifacts with caller-selected existing tools."""
import argparse
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

# Keep generated Python artifacts out of this source-only fixture directory.
sys.dont_write_bytecode = True
from oracle import dex_oracle, elf_oracle


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ndk", required=True, type=Path)
    parser.add_argument("--jdk", required=True, type=Path)
    parser.add_argument("--r8-jar", required=True, type=Path)
    parser.add_argument("--android-jar", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--conscrypt-aar", type=Path)
    parser.add_argument("--conscrypt-original-dex-zip", type=Path)
    args = parser.parse_args()
    for path in (args.ndk, args.jdk, args.r8_jar, args.android_jar, args.output):
        assert path.is_absolute(), "Keep every selected input/output path explicit"
    assert "Pkg.Revision = 27.3.13750724" in (args.ndk / "source.properties").read_text()
    assert digest(args.r8_jar) == "ab1379835c7d3e5f21f80347c3c81e2f762e0b9b02748ae5232c3afa14adf702"
    root = Path(__file__).resolve().parent
    expected = json.loads((root / "source-expectations.json").read_text())
    output = args.output
    output.mkdir(parents=True, exist_ok=False)
    for directory in ("classes", "headers", "oracle", "readelf", "javap"):
        (output / directory).mkdir()
    toolchain = args.ndk / "toolchains/llvm/prebuilt/linux-x86_64"
    clang = toolchain / "bin/clang"
    readelf = toolchain / "bin/llvm-readelf"
    java = args.jdk / "bin/java"
    javac = args.jdk / "bin/javac"
    commands = []

    def run(command, log):
        command = [str(value) for value in command]
        commands.append({"arguments": command, "log": str(log)})
        print(json.dumps({"command": command, "log": str(log)}), flush=True)
        with log.open("w") as stream:
            subprocess.run(command, check=True, stdout=stream, stderr=subprocess.STDOUT)

    versions = {}
    for name, command in {
        "clang": [clang, "--version"],
        "lld": [toolchain / "bin/ld.lld", "--version"],
        "readelf": [readelf, "--version"],
        "java": [java, "-version"],
        "d8": [java, "-Xmx256m", "-XX:ActiveProcessorCount=2", "-cp", args.r8_jar, "com.android.tools.r8.D8", "--version"],
    }.items():
        versions[name] = subprocess.run([str(value) for value in command], check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout
    sources = sorted((root / "src").rglob("*.java"))
    run([javac, "-J-Xmx256m", "-J-XX:ActiveProcessorCount=2", "--release", "8", "-encoding", "UTF-8", "-h", output / "headers", "-d", output / "classes", *sources], output / "javac.log")
    headers = "\n".join(path.read_text() for path in (output / "headers").glob("*.h"))
    for row in expected["native_declarations"]:
        if row.get("symbol"):
            assert row["symbol"] in headers, ("javac -h disagrees", row)
    for name in ("fixture.jni.Bindings", "fixture.jni.Twin", "fixture.jni.原名𐐀"):
        run([args.jdk / "bin/javap", "-s", "-p", "-classpath", output / "classes", name], output / "javap" / (name + ".txt"))
    with zipfile.ZipFile(output / "input.jar", "w") as jar:
        for path in sorted((output / "classes").rglob("*.class")):
            jar.write(path, path.relative_to(output / "classes").as_posix())
    run([java, "-Xmx512m", "-XX:ActiveProcessorCount=2", "-cp", args.r8_jar, "com.android.tools.r8.D8", "--release", "--min-api", "21", "--lib", args.android_jar, "--output", output / "dex.zip", output / "input.jar"], output / "d8.log")
    with zipfile.ZipFile(output / "dex.zip") as dex:
        (output / "classes.dex").write_bytes(dex.read("classes.dex"))
    dex_facts = dex_oracle(output / "classes.dex", expected)
    (output / "oracle/dex.json").write_text(json.dumps(dex_facts, ensure_ascii=False, indent=2) + "\n")
    triples = {
        "arm64-v8a": "aarch64-linux-android21",
        "x86_64": "x86_64-linux-android21",
        "armeabi-v7a": "armv7a-linux-androideabi21",
        "x86": "i686-linux-android21",
    }
    variants = {"ordinary": "none", "relr": "relr", "aps2": "android"}
    receipts = {"static_only": True, "versions": versions, "ndk": str(args.ndk), "r8_sha256": digest(args.r8_jar), "source_expectations_sha256": digest(root / "source-expectations.json"), "dex": dex_facts, "variants": {}}
    for variant, packing in variants.items():
        libraries = {}
        for abi, triple in triples.items():
            for library, source in (("libfixture.so", "bindings.c"), ("libduplicate.so", "duplicate.c")):
                destination = output / variant / "lib" / abi / library
                destination.parent.mkdir(parents=True, exist_ok=True)
                run([clang, "--target=" + triple, "-shared", "-fPIC", "-O0", "-g0", "-I", output / "headers", "-Wl,--threads=2", "-Wl,--pack-dyn-relocs=" + packing, "-Wl,-soname," + library, root / "native" / source, "-o", destination], output / (variant + "-" + abi + "-" + library + ".log"))
                facts = elf_oracle(destination, expected if library == "libfixture.so" else {"tables": [], "native_declarations": []}, False)
                required = expected["variants"]["ordinary"][abi] if variant == "ordinary" else variant.upper() if variant == "relr" else "APS2"
                assert required in facts["relocation_encodings"], (variant, abi, facts["relocation_encodings"])
                for row in expected["native_declarations"]:
                    symbol = row.get("symbol")
                    if symbol and (library == "libfixture.so" or row["name"] == "sharedExport"):
                        assert symbol in facts["exports"], (destination, symbol)
                libraries[f"lib/{abi}/{library}"] = facts
                (output / "oracle" / (variant + "-" + abi + "-" + library + ".json")).write_text(json.dumps(facts, ensure_ascii=False, indent=2) + "\n")
                run([readelf, "--file-header", "--program-headers", "--sections", "--symbols", "--relocations", "--dynamic", "--wide", destination], output / "readelf" / (variant + "-" + abi + "-" + library + ".txt"))
        apk = output / ("jni-" + variant + "-static.apk")
        with zipfile.ZipFile(apk, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(output / "classes.dex", "classes.dex")
            for member, facts in libraries.items():
                archive.write(facts["path"], member)
        rows = []
        for abi in triples:
            for row in expected["native_declarations"]:
                claim = {**row, "abi": abi, "implementations": []}
                if variant == "aps2" and row["basis"] == "table":
                    claim["per_abi_status"] = "unknown"
                    claim["reason"] = "unsupported-aps2"
                for member, facts in libraries.items():
                    if member.split("/")[1] != abi:
                        continue
                    symbol = row.get("symbol")
                    entries = [entry for entry in facts["tables"] if entry["name"] == row["name"] and entry["descriptor"] == row["descriptor"]]
                    if symbol is not None and symbol in facts["exports"]:
                        claim["implementations"].append({"library": member, "library_sha256": facts["sha256"], "export": symbol, "address": facts["exports"][symbol]["address"]})
                    for entry in entries:
                        claim["implementations"].append({"library": member, "library_sha256": facts["sha256"], **entry})
                rows.append(claim)
        receipts["variants"][variant] = {"apk": str(apk), "sha256": digest(apk), "libraries": libraries, "expected_methods": rows}
    if args.conscrypt_aar or args.conscrypt_original_dex_zip:
        assert args.conscrypt_aar and args.conscrypt_original_dex_zip
        assert digest(args.conscrypt_aar) == "752044c289bc98e2dcabc00a1f88ca158b3aa3f505b38f124552bf4b2a0902b1"
        apk = output / "conscrypt-original-static.apk"
        copied = []
        with zipfile.ZipFile(args.conscrypt_aar) as aar, zipfile.ZipFile(args.conscrypt_original_dex_zip) as original, zipfile.ZipFile(apk, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in original.infolist():
                if entry.filename.endswith(".dex"):
                    archive.writestr(entry.filename, original.read(entry))
            for abi in triples:
                member = f"lib/{abi}/libconscrypt_jni.so"
                data = aar.read(f"jni/{abi}/libconscrypt_jni.so")
                archive.writestr(member, data)
                copied.append({"member": member, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
                if abi == "arm64-v8a":
                    library = output / "conscrypt-arm64.so"
                    library.write_bytes(data)
                    facts = elf_oracle(library, {}, True)
                    (output / "oracle/conscrypt-arm64.json").write_text(json.dumps(facts, indent=2) + "\n")
        receipts["conscrypt"] = {"apk": str(apk), "sha256": digest(apk), "aar_sha256": digest(args.conscrypt_aar), "original_dex_zip_sha256": digest(args.conscrypt_original_dex_zip), "libraries": copied, "limitation": "Original-name D8 from classes.jar, not R8-minified DEX; static APK only. Existing D8 platform-adapter missing OpenSSLSocketImpl warning remains."}
    (output / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
    (output / "full-expectations.json").write_text(json.dumps(receipts, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(output), "native_declarations": len(dex_facts["native_methods"]), "variants": list(variants), "expectations": str(output / "full-expectations.json")}), flush=True)


if __name__ == "__main__":
    main()
