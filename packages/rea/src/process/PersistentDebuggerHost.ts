/** Both persistent debugger managers require Linux procfs descriptor readback. */
export const persistentDebuggerHostSupported = (
  platform: NodeJS.Platform,
): boolean => platform === "linux";
