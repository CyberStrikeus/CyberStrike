/** Preserve original indices and count every match while projecting only the requested page. */
export const selectViewRows = <Source, Row>(
  rows: readonly Source[],
  view: { readonly offset: number; readonly limit: number },
  matches: (row: Source, index: number) => boolean,
  project: (row: Source, index: number) => Row,
): { rows: Row[]; total: number } => {
  const selected: Row[] = [];
  let total = 0;
  for (const [index, row] of rows.entries()) {
    if (!matches(row, index)) continue;
    if (total >= view.offset && selected.length < view.limit)
      selected.push(project(row, index));
    total++;
  }
  return { rows: selected, total };
};
