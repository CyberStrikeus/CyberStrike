declare global {
  const CYBERSTRIKE_VERSION: string
  const CYBERSTRIKE_CHANNEL: string
}

export const InstallationVersion = typeof CYBERSTRIKE_VERSION === "string" ? CYBERSTRIKE_VERSION : "local"
export const InstallationChannel = typeof CYBERSTRIKE_CHANNEL === "string" ? CYBERSTRIKE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
