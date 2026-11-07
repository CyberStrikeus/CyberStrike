/** Require a sealed identifier and Apple Developer ID signing team together. */
export const macDeveloperIdRequirement = (
  identifier: string,
  teamIdentifier: string,
): string =>
  `= identifier "${identifier}" and anchor apple generic` +
  ` and certificate leaf[subject.OU] = "${teamIdentifier}"`;
