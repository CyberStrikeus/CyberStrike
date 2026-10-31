/** Split a `tar -tf` listing into member names without platform line endings. */
export function parseTarListing(stdout: string): readonly string[];
