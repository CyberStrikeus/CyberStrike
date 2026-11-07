/** Copy an isolated runtime and injected addon into a caller-owned workspace. */
export function prepareWindowsNativeInspectionWorkspace(input: {
  readonly root: string;
  readonly artifact: string;
  readonly workspace: string;
}): Promise<string>;
