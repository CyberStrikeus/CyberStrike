/** Derive public support facts from one audited, stable release number. */
const defineToolRequirement = (release: {
  readonly name: string;
  readonly commandEnvironment: string;
  readonly version: readonly [number, number, number];
  readonly revision: string;
  readonly repository: string;
}) => {
  const [major, minor, patch] = release.version;
  const version = `${major}.${minor}.${patch}`;
  const line = `${major}.${minor}.x`;
  return {
    ...release,
    version,
    major,
    minor,
    line,
    requirement: `${release.name} ${line} (verified with ${version})`,
  } as const;
};

/** Audited report compatibility; installed tool identity is observed separately. */
export const FIRMWARE_TOOL_REQUIREMENTS = {
  binwalk: defineToolRequirement({
    name: "Binwalk",
    commandEnvironment: "REA_BINWALK_COMMAND",
    version: [3, 1, 0],
    revision: "4fdab3d464d97b68e0af9088df3f9e2e1545b21c",
    repository: "https://github.com/ReFirmLabs/binwalk",
  }),
  unblob: defineToolRequirement({
    name: "Unblob",
    commandEnvironment: "REA_UNBLOB_COMMAND",
    version: [26, 6, 4],
    revision: "1fcc7a0a584a70a96c31f5a276c20944d199a089",
    repository: "https://github.com/onekey-sec/unblob",
  }),
} as const;

/** Caller-supplied firmware engine selected by the operation. */
export type FirmwareEngineName = keyof typeof FIRMWARE_TOOL_REQUIREMENTS;
