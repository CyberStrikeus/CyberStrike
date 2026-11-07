import type {
  Device as VendorDevice,
  DeviceManager as VendorDeviceManager,
  Script as VendorScript,
  Session as VendorSession,
} from "../../node_modules/frida/build/src/frida_binding.js";
import type { Device, DeviceManager, Script, Session } from "frida";

type Assert<Condition extends true> = Condition;

type VendorDeviceManagerFitsShim = Assert<
  VendorDeviceManager extends DeviceManager ? true : false
>;
type VendorDeviceFitsShim = Assert<VendorDevice extends Device ? true : false>;
type VendorSessionFitsShim = Assert<
  VendorSession extends Session ? true : false
>;
type VendorScriptFitsShim = Assert<VendorScript extends Script ? true : false>;

// These aliases intentionally fail when the pinned Frida API narrows incompatibly.
const compatibility: readonly [
  VendorDeviceManagerFitsShim,
  VendorDeviceFitsShim,
  VendorSessionFitsShim,
  VendorScriptFitsShim,
] = [true, true, true, true];

void compatibility;
