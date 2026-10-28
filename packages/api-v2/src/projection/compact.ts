// Upstream's optional fields reject an explicit undefined, so an absent value must be omitted, not set.
export const compact = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
