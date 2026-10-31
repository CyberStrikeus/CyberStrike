import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { verifyAndroidMethodBodies } from "./method-bodies.mjs";
import { verifyAndroidDirectInvokes } from "./direct-invokes.mjs";
import { verifyAndroidExternalReferences } from "./external-invokes.mjs";

/** Prove cold metadata stays unmaterialized and overload identities survive code generation. */
export const verifyAndroidMetadata = async ({
  java,
  jar,
  apk,
  bridge,
  repository,
  execute,
  entrypoint,
  environment,
  jvmArguments = [],
}) => {
  const javac =
    process.env.JAVA_HOME === undefined
      ? "javac"
      : resolve(
          process.env.JAVA_HOME,
          "bin",
          process.platform === "win32" ? "javac.exe" : "javac",
        );
  try {
    await execute(javac, ["-version"], { timeout: 10_000 });
  } catch (cause) {
    throw new Error(
      "verify:android metadata requires the full selected JDK, including javac",
      { cause },
    );
  }
  const classes = await mkdtemp(join(tmpdir(), "rea-android-metadata-"));
  try {
    await execute(
      javac,
      [
        ...jvmArguments.map((argument) => `-J${argument}`),
        "-classpath",
        jar,
        "-d",
        classes,
        bridge,
        resolve(
          repository,
          "tests/conformance/android/ReaJadxMetadataRegression.java",
        ),
        resolve(
          repository,
          "tests/conformance/android/ReaJadxExternalReferencesRegression.java",
        ),
      ],
      { timeout: 30_000 },
    );
    const result = await execute(
      java,
      [
        ...jvmArguments,
        "-classpath",
        `${classes}${delimiter}${jar}`,
        "ReaJadxMetadataRegression",
        apk,
        resolve(repository, "tests/fixtures/android/static-initializers"),
        classes,
        resolve(repository, "tests/fixtures/android/direct-invokes"),
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    assert.match(
      result.stdout,
      /LOAD_FAILURE_REGRESSION_PASS typed=true decoy=true suspension=true cancellation=true/u,
    );
    assert.match(
      result.stdout,
      /METADATA_REGRESSION_PASS classes=\d+ overloads=3/u,
    );
    assert.match(
      result.stdout,
      /CLASS_SEARCH_REGRESSION_PASS pages=\d+ nonzero=true/u,
    );
    assert.match(
      result.stdout,
      /RAW_CLASS_SELECTOR_REGRESSION_PASS nested=true metadata=true references=true/u,
    );
    assert.match(
      result.stdout,
      /DEFAULT_PACKAGE_SELECTOR_REGRESSION_PASS raw=true display=true metadata=true method=true references=true frozen=true/u,
    );
    assert.match(
      result.stdout,
      /INITIALIZER_REGRESSION_PASS folded=2 bounded=true/u,
    );
    assert.match(
      result.stdout,
      /NO_BODY_REGRESSION_PASS native=true abstract=true frozen=true/u,
    );
    assert.match(
      result.stdout,
      /NATIVE_DECLARATION_REGRESSION_PASS raw=true native_only=true unicode=true overloads=true duplicate_dex=true partial=true no_source=true/u,
    );
    assert.match(
      result.stdout,
      /NATIVE_DECLARATION_COLD_PASS no_apk_load=true raw=true/u,
    );
    assert.match(
      result.stdout,
      /MERGED_METHOD_REGRESSION_PASS exact=true overloaded=true handlers=true/u,
    );
    assert.match(
      result.stdout,
      /CONSTANT_FIELD_REGRESSION_PASS encoded=9 absent=4 opt_in=true/u,
    );
    assert.match(
      result.stdout,
      /RAW_MEMBER_NAME_REGRESSION_PASS reserved=true overloads=2 inner=true/u,
    );
    assert.match(
      result.stdout,
      /DIRECT_INVOKE_REGRESSION_PASS nodes=1 offsets=0,3 cross_dex=true/u,
    );
    assert.match(
      result.stdout,
      /MANIFEST_REGRESSION_PASS root=true namespaces=true entities=true reload=true missing=true bounded=true/u,
    );
    console.log(
      "PASS real cold metadata, full generic types and stable overloaded method selection",
    );
    console.log(
      "PASS real Java filtered pages, nonzero inventory cursors and complete combined results",
    );
    console.log(
      "PASS real nested class binary selectors preserve metadata and reference identity",
    );
    console.log(
      "PASS real folded and mixed static initializers, absent bodies and bounded smali",
    );
    console.log(
      "PASS real native/abstract absence before and after neighbouring code generation",
    );
    console.log(
      "PASS real raw DEX direct-invoke offsets and cross-DEX source identity",
    );
    console.log(
      "PASS root manifest selection, namespace/entity values and session cache identity",
    );
    await verifyAndroidMethodBodies({
      apk: resolve(classes, "initializers.apk"),
      repository,
      entrypoint,
      environment,
      execute,
    });
    await verifyAndroidDirectInvokes({
      apk: resolve(classes, "direct-invokes.apk"),
      dexEntry: "classes.dex",
      repository,
      entrypoint,
      environment,
      execute,
    });
    await verifyAndroidDirectInvokes({
      apk: resolve(classes, "direct-invokes-multidex.apk"),
      dexEntry: "classes2.dex",
      repository,
      entrypoint,
      environment,
      execute,
    });
    await verifyAndroidExternalReferences({
      java,
      jar,
      classes,
      repository,
      execute,
      entrypoint,
      environment,
      jvmArguments,
    });
  } finally {
    await rm(classes, { recursive: true, force: true });
  }
};
