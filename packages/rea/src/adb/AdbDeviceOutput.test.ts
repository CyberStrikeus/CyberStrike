import { describe, expect, it } from "vitest";

import {
  parseAdbDevicesOutput,
  parseGetpropOutput,
  parsePackageListOutput,
  parsePmPathOutput,
} from "./AdbDeviceOutput.js";

describe("parseAdbDevicesOutput", () => {
  it("parses emulator, USB, and network devices with their metadata", () => {
    const output = [
      "List of devices attached",
      "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1",
      "07ef9c2a              device usb:1-1 product:raven model:Pixel_6_Pro device:raven transport_id:2",
      "192.168.1.42:5555     device product:mock model:mock transport_id:3",
      "",
    ].join("\n");
    const { devices, unparsedLines, daemonStarted } =
      parseAdbDevicesOutput(output);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
    expect(daemonStarted).toBe(false);
    expect(devices).toEqual([
      {
        serial: "emulator-5554",
        state: "device",
        transport: "tcp",
        product: "sdk_gphone64_x86_64",
        model: "sdk_gphone64_x86_64",
        device: "emu64xa",
        transport_id: 1,
        kind: "emulator",
        kind_basis: "emulator_serial_prefix",
      },
      {
        serial: "07ef9c2a",
        state: "device",
        transport: "usb",
        product: "raven",
        model: "Pixel_6_Pro",
        device: "raven",
        transport_id: 2,
        kind: "physical",
        kind_basis: "usb_transport",
      },
      {
        serial: "192.168.1.42:5555",
        state: "device",
        transport: "tcp",
        product: "mock",
        model: "mock",
        device: null,
        transport_id: 3,
        kind: "unknown",
        kind_basis: "none",
      },
    ]);
  });
});

describe("ADB daemon startup notices", () => {
  it("recognizes daemon startup notices instead of failing the listing", () => {
    const output = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "emulator-5554          device transport_id:1",
      "",
    ].join("\n");
    const { devices, daemonStarted } = parseAdbDevicesOutput(output);
    expect(daemonStarted).toBe(true);
    expect(devices).toHaveLength(1);
  });

  it("recognizes daemon startup notices emitted on stderr", () => {
    const stdout = [
      "List of devices attached",
      "emulator-5554          device transport_id:1",
      "",
    ].join("\n");
    const stderr = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "",
    ].join("\n");
    const { devices, daemonStarted, unparsedLines } = parseAdbDevicesOutput(
      stdout,
      stderr,
    );
    expect(daemonStarted).toBe(true);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
    expect(devices).toHaveLength(1);
  });

  it("recognizes the legacy daemon notice with its trailing marker and CRLF", () => {
    const { daemonStarted, unparsedLines } = parseAdbDevicesOutput(
      "List of devices attached\r\n",
      "* daemon started successfully *\r\n",
    );
    expect(daemonStarted).toBe(true);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
  });

  it("does not treat a daemon startup error containing the success phrase as success", () => {
    const { daemonStarted, unparsedLines } = parseAdbDevicesOutput(
      "List of devices attached\r\n",
      "* daemon not started successfully\r\n",
    );
    expect(daemonStarted).toBe(false);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
  });

  it("ignores non-startup lines and device strings on stderr", () => {
    const stdout = [
      "List of devices attached",
      "emulator-5554          device transport_id:1",
      "",
    ].join("\n");
    const stderr = [
      "adb: warning: some transport warning",
      "emulator-5556          device transport_id:2",
      "",
    ].join("\n");
    const { devices, daemonStarted, unparsedLines } = parseAdbDevicesOutput(
      stdout,
      stderr,
    );
    expect(daemonStarted).toBe(false);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
    expect(devices).toHaveLength(1);
    expect(devices[0]?.serial).toBe("emulator-5554");
  });
});

describe("ADB device states", () => {
  it("keeps non-device states such as unauthorized and offline", () => {
    const output = [
      "List of devices attached",
      "emulator-5556          offline transport_id:2",
      "HT84L0240512           unauthorized usb:1-2 transport_id:3",
      "",
    ].join("\n");
    const { devices } = parseAdbDevicesOutput(output);
    expect(devices.map((device) => [device.serial, device.state])).toEqual([
      ["emulator-5556", "offline"],
      ["HT84L0240512", "unauthorized"],
    ]);
  });

  it("accepts complete multiword states and rejects state prefixes", () => {
    const output = [
      "serial-no-permission no permissions usb:1-1",
      "serial-bad-device deviceXYZ  ",
      "serial-bad-offline offline-ish",
      "serial-bad-auth unauthorizedXYZ",
    ].join("\n");
    const { devices, unparsedLines } = parseAdbDevicesOutput(output);
    expect(devices.map(({ serial, state }) => [serial, state])).toEqual([
      ["serial-no-permission", "no permissions"],
    ]);
    expect(unparsedLines).toEqual({
      sample: [
        "serial-bad-device deviceXYZ  ",
        "serial-bad-offline offline-ish",
        "serial-bad-auth unauthorizedXYZ",
      ],
      total: 3,
    });
  });

  it("returns unrecognized lines instead of dropping them", () => {
    const output = [
      "List of devices attached",
      "this is not a device line",
      "",
    ].join("\n");
    const { unparsedLines } = parseAdbDevicesOutput(output);
    expect(unparsedLines).toEqual({
      sample: ["this is not a device line"],
      total: 1,
    });
  });

  it("reports a non-numeric transport_id as unknown", () => {
    const output = [
      "List of devices attached",
      "emulator-5554          device transport_id:not-a-number",
      "",
    ].join("\n");
    const { devices } = parseAdbDevicesOutput(output);
    expect(devices[0]?.transport_id).toBeNull();
  });
});

describe("parseGetpropOutput", () => {
  it("projects the whitelisted build identity from a real dump", () => {
    const dump = [
      "[ro.build.version.release]: [14]",
      "[ro.build.version.sdk]: [34]",
      "[ro.build.version.security_patch]: [2024-06-05]",
      "[ro.build.id]: [AP21.240617.014]",
      "[ro.build.fingerprint]: [google/sdk_gphone64_x86_64/emu64xa:14/AP21.240617.014/12094027:userdebug/dev-keys]",
      "[ro.product.brand]: [google]",
      "[ro.product.device]: [emu64xa]",
      "[ro.product.manufacturer]: [Google]",
      "[ro.product.model]: [sdk_gphone64_x86_64]",
      "[ro.product.cpu.abilist]: [x86_64,x86,arm64-v8a,armeabi-v7a,armeabi]",
      "[ro.kernel.qemu]: [1]",
      "[ro.debuggable]: [1]",
      "[sys.unlisted.property]: [dropped]",
      "",
    ].join("\n");
    const { properties, emulatorObserved } = parseGetpropOutput(dump);
    expect(emulatorObserved).toBe(true);
    expect(properties).not.toContainEqual({
      name: "sys.unlisted.property",
      value: "dropped",
    });
    expect(properties).toEqual([
      { name: "ro.build.version.release", value: "14" },
      { name: "ro.build.version.sdk", value: "34" },
      { name: "ro.build.version.security_patch", value: "2024-06-05" },
      { name: "ro.build.id", value: "AP21.240617.014" },
      {
        name: "ro.build.fingerprint",
        value:
          "google/sdk_gphone64_x86_64/emu64xa:14/AP21.240617.014/12094027:userdebug/dev-keys",
      },
      { name: "ro.debuggable", value: "1" },
      { name: "ro.kernel.qemu", value: "1" },
      { name: "ro.product.brand", value: "google" },
      { name: "ro.product.device", value: "emu64xa" },
      { name: "ro.product.manufacturer", value: "Google" },
      { name: "ro.product.model", value: "sdk_gphone64_x86_64" },
      {
        name: "ro.product.cpu.abilist",
        value: "x86_64,x86,arm64-v8a,armeabi-v7a,armeabi",
      },
    ]);
  });

  it("reports an explicit non-emulator build without inventing a value", () => {
    const dump = [
      "[ro.build.version.release]: [13]",
      "[ro.kernel.qemu]: [0]",
      "",
    ].join("\n");
    const { emulatorObserved } = parseGetpropOutput(dump);
    expect(emulatorObserved).toBe(false);
  });

  it("reports the emulator indicator unknown when the build omits it", () => {
    const { emulatorObserved } = parseGetpropOutput(
      "[ro.build.version.sdk]: [33]\n",
    );
    expect(emulatorObserved).toBeNull();
  });
});

describe("parsePackageListOutput", () => {
  it("parses package lines with their base APK device paths", () => {
    const output = [
      "package:/data/app/~~xy==/com.example.npzyCvVb1I-YzKIsGFvVYw==/base.apk=com.example",
      "package:/system/app/WebView/WebView.apk=com.android.webview",
      "",
    ].join("\n");
    const { packages, unparsedLines } = parsePackageListOutput(output);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
    expect(packages).toEqual([
      {
        package_name: "com.example",
        base_apk_device_path:
          "/data/app/~~xy==/com.example.npzyCvVb1I-YzKIsGFvVYw==/base.apk",
      },
      {
        package_name: "com.android.webview",
        base_apk_device_path: "/system/app/WebView/WebView.apk",
      },
    ]);
  });

  it("keeps unrecognized lines for partial coverage reporting", () => {
    const { packages, unparsedLines } = parsePackageListOutput(
      "package:/data/app/x/base.apk=com.ok\n  garbage line  \n",
    );
    expect(packages).toHaveLength(1);
    expect(unparsedLines).toEqual({ sample: ["  garbage line  "], total: 1 });
  });

  it("samples the first ten unrecognized lines and counts every one", () => {
    const rows = Array.from(
      { length: 11 },
      (_, index) => `row ${String(index + 1)}`,
    );
    const { packages, unparsedLines } = parsePackageListOutput(
      ["package:/data/app/x/base.apk=com.ok", ...rows].join("\n"),
    );
    expect(packages).toHaveLength(1);
    expect(unparsedLines).toEqual({ sample: rows.slice(0, 10), total: 11 });
  });
});

describe("parsePmPathOutput", () => {
  it("classifies base and split APKs from their file names", () => {
    const output = [
      "package:/data/app/~~a==/com.example.b==/base.apk",
      "package:/data/app/~~a==/com.example.b==/split_config.arm64_v8a.apk",
      "package:/data/app/~~a==/com.example.b==/split_config.en.apk",
      "",
    ].join("\n");
    const { paths, unparsedLines } = parsePmPathOutput(output);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
    expect(paths).toEqual([
      {
        device_path: "/data/app/~~a==/com.example.b==/base.apk",
        file_name: "base.apk",
        role: "base",
      },
      {
        device_path:
          "/data/app/~~a==/com.example.b==/split_config.arm64_v8a.apk",
        file_name: "split_config.arm64_v8a.apk",
        role: "split",
      },
      {
        device_path: "/data/app/~~a==/com.example.b==/split_config.en.apk",
        file_name: "split_config.en.apk",
        role: "split",
      },
    ]);
  });

  it("reports an unknown role for names that follow neither convention", () => {
    const { paths } = parsePmPathOutput("package:/system/app/X/Y.apk\n");
    expect(paths[0]).toEqual({
      device_path: "/system/app/X/Y.apk",
      file_name: "Y.apk",
      role: "unknown",
    });
  });

  it("preserves whitespace and the exact POSIX device path", () => {
    const devicePath = "/data/app/My App/résumé:final\\draft*.apk";
    const { paths, rejectedPaths, unparsedLines } = parsePmPathOutput(
      `package:${devicePath}\r\n`,
      "linux",
    );
    expect(paths).toEqual([
      {
        device_path: devicePath,
        file_name: "résumé:final\\draft*.apk",
        role: "unknown",
      },
    ]);
    expect(rejectedPaths).toEqual([]);
    expect(unparsedLines).toEqual({ sample: [], total: 0 });
  });

  it("rejects an empty final component without normalizing the source", () => {
    const devicePath = "/data/app/pkg/base.apk/";
    const parsed = parsePmPathOutput(`package:${devicePath}\n`);
    expect(parsed.paths).toEqual([]);
    expect(parsed.rejectedPaths).toEqual([
      { device_path: devicePath, reason: "empty_file_name" },
    ]);
  });

  it("retains malformed lines including surrounding whitespace", () => {
    expect(
      parsePmPathOutput(" package:/data/app/pkg/base.apk \n").unparsedLines,
    ).toEqual({ sample: [" package:/data/app/pkg/base.apk "], total: 1 });
  });
});
