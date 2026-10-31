interface PackageManifest {
  name: string;
  version: string;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  overrides?: Record<string, unknown>;
  // npm manifests are extensible; preserve metadata outside this projection.
  [key: string]: unknown;
}

interface LockedPackage {
  version?: string;
  dev?: boolean;
  // Keep unmodified integrity, resolution, platform, and other lock-entry facts.
  [key: string]: unknown;
}

interface PackageLock {
  name: string;
  version: string;
  lockfileVersion: number;
  packages: Record<string, LockedPackage>;
  // Preserve other npm lock metadata rather than dropping unfamiliar fields.
  [key: string]: unknown;
}

export function pluginPackageMetadata<Manifest extends PackageManifest>(
  manifest: Manifest,
  lock: PackageLock,
): {
  packageJson: Omit<Manifest, "devDependencies" | "overrides"> & {
    bundleDependencies: string[];
  };
  shrinkwrap: PackageLock;
};
