export default function parseMarkdown(value) {
  if (value.startsWith("# "))
    return { type: "heading", depth: 1, text: value.slice(2) };
  if (/^\*\*.*\*\*$/u.test(value))
    return { type: "strong", text: value.slice(2, -2) };
  return { type: "paragraph", text: value.replaceAll("\r\n", "\n") };
}
