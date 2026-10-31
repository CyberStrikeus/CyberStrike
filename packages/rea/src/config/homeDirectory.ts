import { userInfo } from "node:os";

const firstNonempty = (...values: readonly (string | undefined)[]) =>
  values.find(
    (value): value is string => value !== undefined && value.length > 0,
  );

/** Resolve the caller's selected home before consulting the host account. */
export const homeDirectoryFromEnvironment = (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
): string => {
  const windowsDriveHome =
    environment.HOMEDRIVE !== undefined &&
    environment.HOMEDRIVE.length > 0 &&
    environment.HOMEPATH !== undefined &&
    environment.HOMEPATH.length > 0
      ? `${environment.HOMEDRIVE}${environment.HOMEPATH}`
      : undefined;
  const selected =
    platform === "win32"
      ? firstNonempty(
          environment.USERPROFILE,
          windowsDriveHome,
          environment.HOME,
        )
      : firstNonempty(environment.HOME, environment.USERPROFILE);
  return selected ?? userInfo().homedir;
};
