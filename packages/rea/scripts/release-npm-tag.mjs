import semver from "semver";

export function releaseNpmTag(version) {
  if (version === undefined || semver.valid(version) !== version)
    throw new Error("Expected an exact SemVer version.");
  return semver.prerelease(version) === null ? "latest" : "next";
}
