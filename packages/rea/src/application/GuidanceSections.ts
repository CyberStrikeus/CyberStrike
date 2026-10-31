/** Parsed documentation facts; callers never reinterpret Markdown boundaries. */
export interface GuideSection {
  readonly guide: string;
  readonly heading: string;
  readonly content: string;
  readonly ordinal: number;
}

// The shipped bundle has tens of headings. These ceilings bound object count
// and UTF-16 text retained by a complete index before allocating section text.
const MAX_SECTIONS = 4096;
// ATX has at most six enclosing levels over the admitted 4 MiB bundle.
const MAX_EXPANDED_CHARACTERS = 6 * 4_194_304;

const blank = (value: string | undefined): boolean =>
  value === " " || value === "\t";

/** ATX closing hashes and ASCII whitespace, scanned once from each end. */
const headingTitle = (raw: string): string => {
  let start = 0;
  let end = raw.length;
  while (start < end && blank(raw[start])) start += 1;
  while (end > start && blank(raw[end - 1])) end -= 1;
  let hashes = end;
  while (hashes > start && raw[hashes - 1] === "#") hashes -= 1;
  if (hashes < end && (hashes === start || blank(raw[hashes - 1]))) {
    end = hashes;
    while (end > start && blank(raw[end - 1])) end -= 1;
  }
  return raw.slice(start, end);
};

interface Heading {
  readonly level: number;
  readonly title: string;
  readonly start: number;
  end: number;
}

const atxHeading = (
  line: string,
): Pick<Heading, "level" | "title"> | undefined => {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/u.exec(line);
  if (match?.[1] === undefined) return undefined;
  const raw = match[2] ?? "";
  // Closing hashes need whitespace; literal C# and escaped hashes survive.
  const title = headingTitle(raw);
  return { level: match[1].length, title };
};

const readHeadings = (
  content: string,
  remaining: number,
): Heading[] | undefined => {
  const headings: Heading[] = [];
  const enclosing: Heading[] = [];
  let fence: { marker: string; length: number } | undefined;
  let start = 0;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    const end = newline < 0 ? content.length : newline;
    const line = content.slice(start, end);
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const marker = fenceMatch?.[1];
    if (fence !== undefined) {
      if (
        marker?.[0] === fence.marker &&
        marker.length >= fence.length &&
        /^[ \t]*$/u.test(fenceMatch?.[2] ?? "")
      )
        fence = undefined;
    } else if (
      marker !== undefined &&
      !(marker[0] === "`" && fenceMatch?.[2]?.includes("`"))
    ) {
      fence = { marker: marker[0] ?? "", length: marker.length };
    } else {
      const parsed = atxHeading(line);
      if (parsed !== undefined) {
        if (headings.length >= remaining) return undefined;
        while ((enclosing.at(-1)?.level ?? 0) >= parsed.level) {
          const parent = enclosing.pop();
          if (parent !== undefined) parent.end = start;
        }
        const heading = { ...parsed, start, end: content.length };
        headings.push(heading);
        enclosing.push(heading);
      }
    }
    start = newline < 0 ? content.length : newline + 1;
  }
  return headings;
};

/** Bound the whole bundle before materializing an expanded section index. */
export const parseGuidanceSections = (
  files: ReadonlyMap<string, string>,
): readonly GuideSection[] | undefined => {
  const documents: { guide: string; content: string; headings: Heading[] }[] =
    [];
  let count = 0;
  let expanded = 0;
  for (const [guide, content] of files) {
    const headings = readHeadings(content, MAX_SECTIONS - count);
    if (headings === undefined) return undefined;
    count += headings.length;
    for (const heading of headings) {
      expanded += heading.end - heading.start;
      if (expanded > MAX_EXPANDED_CHARACTERS) return undefined;
    }
    documents.push({ guide, content, headings });
  }
  const sections: GuideSection[] = [];
  for (const { guide, content, headings } of documents)
    for (const [ordinal, heading] of headings.entries())
      sections.push({
        guide,
        ordinal,
        heading: heading.title,
        content: content.slice(heading.start, heading.end).trim(),
      });
  return sections;
};
