/** Project the development manifest and lock into the shared runtime artifact. */
export function pluginPackageMetadata(manifest, lock) {
  if (
    lock.lockfileVersion !== 3 ||
    lock.name !== manifest.name ||
    lock.version !== manifest.version ||
    lock.packages?.[""]?.version !== manifest.version
  )
    throw new Error("Plugin packaging requires the matching v3 package lock");

  // Claude skips dependency installation when a published manifest has
  // overrides. Preserve development security overrides in the source owner,
  // and reject any future runtime override rather than silently discarding it.
  for (const name of Object.keys(manifest.overrides ?? {})) {
    const matches = Object.entries(lock.packages).filter(([path]) =>
      path.endsWith(`node_modules/${name}`),
    );
    if (matches.length === 0 || matches.some(([, entry]) => entry.dev !== true))
      throw new Error(`Cannot omit a runtime or unresolved override: ${name}`);
  }

  const packageJson = { ...manifest };
  delete packageJson.devDependencies;
  delete packageJson.overrides;
  // Codex's npm source fetches the archive without installing dependencies.
  // Keep optional Frida outside the bundle so ordinary npm installs can still
  // run its host-specific installer. PTY binaries are transitive optionals of
  // a runtime dependency and are included for every supported platform by the
  // archive producer.
  packageJson.bundleDependencies = Object.keys(manifest.dependencies ?? {});
  const root = { ...lock.packages[""] };
  delete root.devDependencies;
  const shrinkwrap = {
    ...lock,
    packages: Object.fromEntries(
      Object.entries(lock.packages).filter(([, entry]) => entry.dev !== true),
    ),
  };
  shrinkwrap.packages[""] = root;
  return { packageJson, shrinkwrap };
}
