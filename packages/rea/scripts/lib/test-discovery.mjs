import { relative, resolve } from "node:path";

/** Compare actual Vitest discovery with repository-owned test paths. */
export const compareTestDiscovery = (expectedPaths, discovery, root) => {
  if (!Array.isArray(discovery))
    throw new TypeError("Vitest file discovery must be an array");
  const projectsByFile = new Map();
  for (const entry of discovery) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.file !== "string" ||
      entry.file.length === 0 ||
      typeof entry.projectName !== "string" ||
      entry.projectName.length === 0
    )
      throw new TypeError(
        "Vitest discovery requires file and projectName strings",
      );
    const path = relative(root, resolve(root, entry.file)).replaceAll(
      "\\",
      "/",
    );
    const projects = projectsByFile.get(path) ?? [];
    projects.push(entry.projectName);
    projectsByFile.set(path, projects);
  }
  const expected = new Set(expectedPaths);
  const sorted = (values) => [...values].sort();
  return {
    missing: sorted(expected).filter((path) => !projectsByFile.has(path)),
    unexpected: sorted(projectsByFile.keys()).filter(
      (path) => !expected.has(path),
    ),
    duplicates: sorted(projectsByFile.keys()).flatMap((file) => {
      const projects = projectsByFile.get(file);
      return projects.length > 1 ? [{ file, projects: sorted(projects) }] : [];
    }),
    discovered: projectsByFile.size,
  };
};
