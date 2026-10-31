"""Extract gettext catalogs and render language editions of authored static HTML."""

from collections import Counter
from html import escape, unescape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
from string import Formatter
from tempfile import TemporaryDirectory
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import polib


VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
INLINE = {"a", "abbr", "b", "bdi", "br", "cite", "code", "em", "i", "kbd", "mark", "s", "small", "span", "strong", "sub", "sup", "time", "u"}
PROSE = {"a", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "figcaption", "summary", "label", "button", "th", "td", "span", "strong", "small", "cite", "blockquote", "output"}
PROTECTED = {"code", "kbd", "pre", "script", "style", "svg", "math"}
ATTRIBUTES = {"alt", "aria-label", "aria-description", "title", "placeholder"}
PLACEHOLDER = re.compile(r"\{([a-zA-Z][a-zA-Z0-9_]*)\}")
LITERALS = {"REA", "Reverse Engineer Anything", "REA · Reverse Engineer Anything", "GitHub", "Discord", "FAQ", "MCP", "CLI", "CSV", "JSON", "HTML", "CSS", "JavaScript", "Electron", "Hopper", "Ghidra", "IDA", "Windows", "Linux", "macOS", "Notion", "DX-Ball", "TH04", "TH08", "TH095", "Aegis", "SHA-1", "HMAC", "Node.js", "Windows PowerShell", "macOS · Homebrew", "npm", "npx", "DOS", "PC-98"}
FALLBACK_NOTICE = "Translation is being updated. Read this page in English for now."


LANGUAGE_CODE = re.compile(r"[a-z]{2}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?")


def is_language_code(value):
    """Recognize canonical language, optional script and region inventory codes."""
    return LANGUAGE_CODE.fullmatch(value) is not None


def readme_edition_paths(root):
    """Return repo-relative README editions: root English plus docs/readme translations."""
    editions = set()
    if (root / "README.md").is_file():
        editions.add("README.md")
    folder = root / "docs" / "readme"
    if folder.is_dir():
        editions.update(
            f"docs/readme/{path.name}"
            for path in folder.glob("README_*.md")
            if path.is_file()
        )
    return editions


def languages(root):
    """Load the website language inventory and check it against README editions."""
    path = root / "website/locales/languages.json"
    editions = readme_edition_paths(root)
    if not path.exists():
        if any(edition != "README.md" for edition in editions):
            raise ValueError("Missing languages.json for the translated README editions")
        return [{"code": "en", "name": "English", "readme": "README.md", "dir": "ltr"}]
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data or not isinstance(data[0], dict) or data[0].get("code") != "en":
        raise ValueError("languages.json must start with English")
    codes, filenames = set(), set()
    for item in data:
        if not isinstance(item, dict) or set(item) != {"code", "name", "readme", "dir"}:
            raise ValueError("Each language needs code, name, readme and dir")
        if not all(isinstance(value, str) and value for value in item.values()):
            raise ValueError("Language fields must be nonempty strings")
        if not is_language_code(item["code"]) or item["code"] in codes:
            raise ValueError(f"Invalid or duplicate language: {item['code']}")
        if item["dir"] not in ("ltr", "rtl"):
            raise ValueError(f"Invalid text direction: {item['code']}")
        if item["readme"] in filenames:
            raise ValueError(f"Duplicate README edition: {item['readme']}")
        codes.add(item["code"])
        filenames.add(item["readme"])
    if editions and ({item["readme"] for item in data} != editions):
        raise ValueError("Website languages must match the README language editions")
    return data


def reading_pages(site):
    """Discover authored reading pages, leaving target applications untouched."""
    from website import NOTES_FIXTURES, PageMetadata
    pages = []
    for path in sorted(site.rglob("*.html")):
        if path.relative_to(site).as_posix() in NOTES_FIXTURES:
            continue
        metadata = PageMetadata()
        metadata.feed(path.read_text(encoding="utf-8"))
        if not metadata.noindex:
            pages.append(path)
    return pages


def localized_path(relative, code):
    """Keep English's existing routes and prefix other editions with their language."""
    return Path(relative) if code == "en" else Path(code) / relative


def language_markup(root, relative, code="en", available=None):
    """Render a keyboard-accessible same-page selector and reciprocal hreflang links."""
    from website import SITE_ORIGIN, page_route
    inventory = languages(root)
    available = set(available) if available is not None else {item["code"] for item in inventory}
    current = next(item for item in inventory if item["code"] == code)
    route = page_route(Path("."), Path(".") / relative)
    depth = len(localized_path(relative, code).parent.parts)
    base = "../" * depth or "./"
    choices, alternates = [], []
    for item in inventory:
        target = ("" if item["code"] == "en" else item["code"] + "/") + route
        href = escape(base + target, quote=True)
        active = ' aria-current="true"' if item["code"] == code else ""
        fallback = " · English" if item["code"] not in available else ""
        choices.append(f'<a href="{href}" lang="{item["code"]}" dir="{item["dir"]}" data-language="{item["code"]}"{active}>{escape(item["name"])}{fallback}</a>')
        if item["code"] in available:
            alternates.append(f'<!-- prettier-ignore -->\n<link rel="alternate" hreflang="{item["code"]}" href="{SITE_ORIGIN}/{quote(target, safe="/")}" />')
    alternates.append(f'<!-- prettier-ignore -->\n<link rel="alternate" hreflang="x-default" href="{SITE_ORIGIN}/{quote(route, safe="/")}" />')
    selector = '<details class="language-picker" data-i18n-skip><summary><span aria-hidden="true">文 / A</span> <span>' + escape(current["name"]) + '</span></summary><nav aria-label="' + escape(current["name"], quote=True) + '">' + "".join(choices) + "</nav></details>"
    return selector, "\n".join(alternates)


class Node:
    """Keep exact source spans so translating prose cannot reserialize code blocks."""

    def __init__(self, tag, attrs, start, open_end, line):
        self.tag, self.attrs, self.start, self.open_end = tag, dict(attrs), start, open_end
        self.end_start, self.end, self.line = open_end, open_end, line
        self.children = []
        self.parent = None


class Document(HTMLParser):
    """Parse structure while retaining original start tags, text and source positions."""

    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.offsets = [0]
        for match in re.finditer("\n", source):
            self.offsets.append(match.end())
        self.root = Node("document", [], 0, 0, 1)
        self.root.end = self.root.end_start = len(source)
        self.stack, self.nodes = [self.root], []
        self.feed(source)
        self.close()
        if len(self.stack) != 1:
            raise ValueError(f"Unclosed HTML element: {self.stack[-1].tag}")

    def position(self):
        line, column = self.getpos()
        return self.offsets[line - 1] + column

    def handle_starttag(self, tag, attrs):
        start = self.position()
        node = Node(tag, attrs, start, start + len(self.get_starttag_text()), self.getpos()[0])
        node.parent = self.stack[-1]
        node.parent.children.append(node)
        self.nodes.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.stack.pop()

    def handle_endtag(self, tag):
        if len(self.stack) < 2 or self.stack[-1].tag != tag:
            raise ValueError(f"Unbalanced HTML at line {self.getpos()[0]}: </{tag}>")
        node = self.stack.pop()
        node.end_start = self.position()
        node.end = self.source.index(">", node.end_start) + 1

    def handle_data(self, data):
        self.stack[-1].children.append((self.position(), self.position() + len(data)))

    def handle_entityref(self, name):
        self.handle_data("&" + name + ";")

    def handle_charref(self, name):
        self.handle_data("&#" + name + ";")


def skipped(node):
    """Respect protected evidence and explicit exclusions throughout a subtree."""
    while node:
        if node.tag in PROTECTED or "data-i18n-skip" in node.attrs or node.attrs.get("translate") == "no":
            return True
        node = node.parent
    return False


def translatable(text):
    """Leave identifiers, product names and numeric evidence as literal source."""
    literal = re.fullmatch(r"0x[0-9a-fA-F]+|code\[\d+\]\s*=\s*\d+|× pan_scale", text)
    return bool(re.search(r"[a-zA-Z]", text)) and text not in LITERALS and not literal and not re.fullmatch(r"[\w./\\:-]+\.(?:exe|dll|js|json|html|asar|apk|zip|cpp|h|svg)", text, flags=re.IGNORECASE)


def inline(node):
    return all(not isinstance(child, Node) or (child.tag in INLINE and inline(child)) for child in node.children)


def unit_text(document, node):
    """Represent inline markup and code as named placeholders in a complete sentence."""
    slots, parts = {}, []

    def slot(value):
        key = f"ph{len(slots)}"
        slots[key] = value
        return "{" + key + "}"

    def visit(child):
        if not isinstance(child, Node):
            parts.append(unescape(document.source[child[0]:child[1]]))
        elif child.tag in {"code", "kbd"} or "data-i18n-skip" in child.attrs or child.attrs.get("translate") == "no":
            parts.append(slot(document.source[child.start:child.end]))
        else:
            parts.append(slot(document.source[child.start:child.open_end]))
            for descendant in child.children:
                visit(descendant)
            if child.end > child.end_start:
                parts.append(slot(document.source[child.end_start:child.end]))
    for child in node.children:
        visit(child)
    return re.sub(r"\s+", " ", "".join(parts)).strip(), slots


def prose_units(source, path):
    """Extract paragraph-sized units, or individual orphan text when structure requires it."""
    document = Document(source)
    units = []

    def context(start):
        for name in ("sharing", "header", "footer"):
            begin, end = source.find(f"<!-- website:{name}:start -->"), source.find(f"<!-- website:{name}:end -->")
            if begin >= 0 and begin < start < end:
                return "shared"
        return "page:" + path

    def visit(node):
        if skipped(node) or node.tag in {"head", "document"}:
            if node.tag == "document":
                for child in node.children:
                    if isinstance(child, Node):
                        visit(child)
            return
        if node.tag in PROSE and inline(node) and node.children:
            text, slots = unit_text(document, node)
            if translatable(PLACEHOLDER.sub("", text).strip()):
                units.append((context(node.start), text, slots, node.open_end, node.end_start, node.line))
            return
        for child in node.children:
            if isinstance(child, Node):
                visit(child)
            else:
                raw = source[child[0]:child[1]]
                text = re.sub(r"\s+", " ", unescape(raw)).strip()
                if translatable(text):
                    units.append((context(child[0]), text, {}, child[0], child[1], source.count("\n", 0, child[0]) + 1))
    visit(document.root)
    # The title is prose even though it lives in the head.
    for node in document.nodes:
        if node.tag == "title" and not skipped(node):
            text, slots = unit_text(document, node)
            if translatable(text):
                units.append(("page:" + path, text, slots, node.open_end, node.end_start, node.line))
    return units


def attribute_units(source, path):
    """Extract accessibility labels and authored metadata without translating URLs."""
    units = []
    document = Document(source)
    for node in document.nodes:
        if skipped(node):
            continue
        names = set(ATTRIBUTES)
        if node.tag == "meta" and (node.attrs.get("name") == "description" or node.attrs.get("property") == "og:image:alt" or node.attrs.get("name") == "twitter:image:alt"):
            names.add("content")
        for name in names:
            text = node.attrs.get(name)
            if text and translatable(text):
                context = "shared" if "<!-- website:header:start -->" in source[:node.start] and "<!-- website:header:end -->" not in source[:node.start] else "page:" + path
                if name == "content" and node.attrs.get("name") != "description":
                    context = "shared"
                units.append((context, text, {}, node, name))
    return units


def runtime_units(root):
    """Extract the constrained t("literal", namedValues) authoring form directly."""
    yield "fallback", FALLBACK_NOTICE, "scripts/website_i18n.py", ""
    site = root / "website/public"
    for path in sorted((site / "assets").glob("*.js")):
        if path.name == "i18n.js":  # Owns t itself, rather than reader-facing calls.
            continue
        source = path.read_text(encoding="utf-8")
        calls = list(re.finditer(r'\bt\(\s*("(?:[^"\\]|\\.)*")', source))
        if len(calls) != len(re.findall(r"\bt\(", source)):
            raise ValueError(f'{path.name}: use t("one literal message", namedValues)')
        script = path.relative_to(site).as_posix()
        for call in calls:
            yield script, json.loads(call[1]), "website/public/" + script, source.count("\n", 0, call.start()) + 1


def read_runtime(root, page=None):
    """Scope automatically extracted interaction messages to a page's scripts."""
    units = list(runtime_units(root))
    if page is None:
        return list(dict.fromkeys(text for _, text, _, _ in units))
    site = root / "website/public"
    scripts = set()
    for node in Document(page.read_text(encoding="utf-8")).nodes:
        if node.tag == "script" and node.attrs.get("src"):
            reference = urlsplit(node.attrs["src"])
            if not reference.scheme and not reference.netloc:
                scripts.add((page.parent / unquote(reference.path)).resolve().relative_to(site.resolve()).as_posix())
    return list(dict.fromkeys(text for script, text, _, _ in units if script in scripts))


def source_catalog(root):
    """Build a deterministic POT with source references and protected-placeholder notes."""
    site = root / "website/public"
    catalog = polib.POFile(wrapwidth=88)
    catalog.metadata = {"Project-Id-Version": "REA website", "MIME-Version": "1.0", "Content-Type": "text/plain; charset=UTF-8", "Content-Transfer-Encoding": "8bit"}
    entries = {}

    def add(context, text, slots, reference, line):
        key = context, text
        if key not in entries:
            entry = polib.POEntry(msgctxt=context, msgid=text, msgstr="", flags=["python-brace-format"] if PLACEHOLDER.search(text) else [])
            entry.comment = "\n".join(f"{{{key}}}: {re.sub(r'\s+', ' ', value)}" for key, value in slots.items())
            entries[key] = entry
            catalog.append(entry)
        occurrence = (reference, str(line))
        if occurrence not in entries[key].occurrences:
            entries[key].occurrences.append(occurrence)

    for path in reading_pages(site):
        relative = path.relative_to(site).as_posix()
        source = path.read_text(encoding="utf-8")
        for context, text, slots, _, _, line in prose_units(source, relative):
            add(context, text, slots, "website/public/" + relative, line)
        for context, text, slots, node, _ in attribute_units(source, relative):
            add(context, text, slots, "website/public/" + relative, node.line)
    for _, text, reference, line in runtime_units(root):
        add("runtime", text, {}, reference, line)
    for path in sorted((site / "assets/figures").glob("*.svg")):
        source = path.read_text(encoding="utf-8")
        for node in Document(source).nodes:
            if node.tag in {"text", "title", "desc"} and not any(isinstance(child, Node) for child in node.children):
                text = unescape(source[node.open_end:node.end_start]).strip()
                if translatable(text):
                    add("figure:" + path.name, text, {}, "website/public/assets/figures/" + path.name, node.line)
    return catalog


def extract_catalogs(root, check=False):
    """Refresh standard catalogs, preserving translations/comments and archiving removed text."""
    inventory = languages(root)
    template = source_catalog(root)
    directory = root / "website/locales"
    target = directory / "messages.pot"
    changed = []
    if not target.exists() or target.read_text(encoding="utf-8") != str(template):
        changed.append(target)
        if not check:
            template.save(target)
    expected = {(entry.msgctxt, entry.msgid) for entry in template}
    for language in inventory[1:]:
        path = directory / language["code"] / "messages.po"
        catalog = polib.pofile(path, encoding="utf-8") if path.exists() else polib.POFile(wrapwidth=88)
        active = {(entry.msgctxt, entry.msgid) for entry in catalog if not entry.obsolete}
        if active != expected:
            changed.append(path)
        if not check:
            catalog.merge(template)
            catalog.metadata.update(template.metadata)
            catalog.metadata["Language"] = language["code"]
            path.parent.mkdir(parents=True, exist_ok=True)
            catalog.save(path)
    if check and changed:
        raise ValueError("Translation sources changed: " + ", ".join(str(path.relative_to(root)) for path in changed[:8]) + ". Run python3 scripts/website.py translations extract, then update the affected msgstr entries.")
    print(f"{'Checked' if check else 'Extracted'} {len(template)} source messages for {len(inventory) - 1} translation catalogs.")
    return template


def fields(text):
    """Validate named format fields without accepting conversion or format instructions."""
    result = []
    for _, name, specification, conversion in Formatter().parse(text):
        if name is not None:
            if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]*", name) or specification or conversion:
                raise ValueError(f"Unsupported translation placeholder: {name}")
            result.append(name)
    return Counter(result)


def checked_catalog(root, language, template, strict=False):
    """Reject malformed catalogs and report missing or fuzzy messages independently."""
    path = root / "website/locales" / language["code"] / "messages.po"
    catalog = polib.pofile(path, encoding="utf-8", check_for_duplicates=True)
    if catalog.metadata.get("Language") != language["code"]:
        raise ValueError(f"{path}: wrong Language header")
    messages, missing = {}, []
    source = {(entry.msgctxt, entry.msgid): entry for entry in template}
    for entry in catalog:
        if entry.obsolete:
            continue
        key = entry.msgctxt, entry.msgid
        if key not in source:
            raise ValueError(f"{path}: obsolete source still active: {entry.msgid[:80]}")
        if entry.msgid_plural or entry.msgstr_plural:
            raise ValueError(f"{path}: use the declared named-count messages, not undeclared plural forms")
        if not entry.msgstr.strip() or "fuzzy" in entry.flags:
            missing.append(key)
            continue
        if fields(entry.msgid) != fields(entry.msgstr):
            raise ValueError(f"{path}: translation changed placeholders: {entry.msgid[:100]}")
        slots = dict(re.findall(r"^\{(ph\d+)\}: (.*)$", source[key].comment, re.MULTILINE))
        if slots:
            fragment = escape(entry.msgstr, quote=False)
            for name, value in slots.items():
                fragment = fragment.replace("{" + name + "}", value)
            try:
                Document("<div>" + fragment + "</div>")
            except ValueError as error:
                raise ValueError(f"{path}: {entry.msgctxt}: invalid inline markup in {entry.msgid[:100]!r}: {error}") from error
        messages[key] = entry.msgstr.strip()
    missing.extend(key for key in source if key not in messages and key not in missing)
    if strict and missing:
        raise ValueError(f"{path}: {len(missing)} untranslated/fuzzy messages; first: {missing[0][1][:100]}")
    return messages, missing


def replace_attribute(raw, name, value):
    """Change one parsed start-tag attribute without modifying adjacent markup."""
    pattern = re.compile(r"(\s" + re.escape(name) + r"\s*=\s*)([\"'])(.*?)\2", re.DOTALL | re.IGNORECASE)
    updated, count = pattern.subn(lambda match: match[1] + '"' + escape(value, quote=True) + '"', raw)
    if count != 1:
        raise ValueError(f"Expected one quoted {name} attribute: {raw[:100]}")
    return updated


def apply_edits(source, edits):
    """Apply non-overlapping spans from the end, preserving untouched evidence byte-for-byte."""
    end = len(source)
    for start, stop, replacement in sorted(edits, reverse=True):
        if stop > end:
            raise ValueError("Overlapping translation spans")
        source = source[:start] + replacement + source[stop:]
        end = start
    return source


def render_prose(source, relative, messages):
    """Translate complete units and restore validated original inline markup."""
    edits = []
    for context, text, slots, start, end, _ in prose_units(source, relative):
        translated = messages[(context, text)]
        if fields(text) != fields(translated):
            raise ValueError(f"{relative}: changed placeholders")
        rendered = escape(translated, quote=False)
        for key, value in slots.items():
            rendered = rendered.replace("{" + key + "}", value)
        # Check translator-reordered markup before accepting it into the document.
        try:
            Document("<div>" + rendered + "</div>")
        except ValueError as error:
            raise ValueError(f"{relative}: invalid translated markup in {text[:100]!r}: {error}") from error
        raw = source[start:end]
        leading = re.match(r"\s*", raw)[0]
        trailing = re.search(r"\s*$", raw)[0]
        edits.append((start, end, leading + rendered + trailing))
    return apply_edits(source, edits)


def relative_reference(reference, source_path, output_path, site, available, code, figures, language_link=False):
    """Resolve links once, keeping assets shared and reading links in the selected edition."""
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return reference
    target = (source_path.parent / unquote(parsed.path)).resolve()
    if not target.is_relative_to(site.resolve()):
        raise ValueError(f"Reference leaves the website: {reference}")
    relative = target.relative_to(site.resolve())
    lookup = relative / "index.html" if target.is_dir() else relative
    if not language_link and lookup.as_posix() in available and code != "en":
        relative = Path(code) / relative
    if relative.as_posix() in figures and code != "en":
        relative = Path("assets/localized") / code / relative.relative_to("assets")
    destination = os.path.relpath(site / relative, output_path.parent).replace(os.sep, "/")
    if parsed.path.endswith("/") and not destination.endswith("/"):
        destination += "/"
    return urlunsplit(("", "", quote(destination, safe="/"), parsed.query, parsed.fragment))


def replace_language_markup(source, root, relative, code, available):
    """Derive selectors and alternates from the same page-level completeness decision."""
    selector, alternates = language_markup(root, relative, code, available)
    document = Document(source)
    picker = next(node for node in document.nodes if node.tag == "details" and node.attrs.get("class") == "language-picker")
    source = apply_edits(source, [(picker.start, picker.end, selector)])
    pattern = r"(<!-- website:languages:start -->).*?(<!-- website:languages:end -->)"
    return re.sub(pattern, lambda match: match[1] + "\n" + alternates + "\n" + match[2], source, flags=re.DOTALL)


def render_page(root, source_path, language, messages, available, figures, page_languages):
    """Create one complete translation, preserving routes, code, IDs and reference data."""
    from website import SITE_ORIGIN, PageMetadata, page_url
    site = root / "website/public"
    relative = source_path.relative_to(site).as_posix()
    code = language["code"]
    output_path = site / localized_path(relative, code)
    source = source_path.read_text(encoding="utf-8")
    source = render_prose(source, relative, messages)
    metadata = PageMetadata()
    # Translate attributes separately; units inside inline markup keep their source tags.
    replacements = {}
    for context, text, _, node, attribute in attribute_units(source, relative):
        raw = replacements.get(node.start, source[node.start:node.open_end])
        replacements[node.start] = replace_attribute(raw, attribute, messages[(context, text)])
    source = apply_edits(source, [(node.start, node.open_end, replacements[node.start]) for node in Document(source).nodes if node.start in replacements])
    metadata.feed(source)
    canonical = page_url(site, output_path)
    replacements = []
    for node in Document(source).nodes:
        raw = source[node.start:node.open_end]
        if node.tag == "html":
            raw = replace_attribute(raw, "lang", code)
            raw = raw[:-1] + f' dir="{language["dir"]}">'
        if node.tag == "meta":
            key = node.attrs.get("property") or node.attrs.get("name")
            if key in {"og:title", "twitter:title"}:
                raw = replace_attribute(raw, "content", metadata.titles[0])
            elif key in {"og:description", "twitter:description"}:
                raw = replace_attribute(raw, "content", metadata.descriptions[0])
            elif key == "og:url":
                raw = replace_attribute(raw, "content", canonical)
        for attribute in ("href", "src"):
            if attribute not in node.attrs:
                continue
            reference = node.attrs[attribute]
            if node.tag == "link" and node.attrs.get("rel") == "canonical":
                value = canonical
            else:
                value = relative_reference(reference, source_path, output_path, site, available, code, figures, "data-language" in node.attrs)
            raw = replace_attribute(raw, attribute, value)
        if raw != source[node.start:node.open_end]:
            replacements.append((node.start, node.open_end, raw))
    source = apply_edits(source, replacements)
    source = replace_language_markup(source, root, relative, code, page_languages)
    runtime = {text: messages[("runtime", text)] for text in read_runtime(root, source_path)}
    payload = json.dumps(runtime, ensure_ascii=False).replace("<", "\\u003c").replace("&", "\\u0026")
    # Only Korean editions request the font stylesheet; English fallbacks keep
    # their system fonts. The variable face also supplies the site's 650 weight.
    font_stylesheet = (
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&amp;display=swap" />\n  '
        if code == "ko" else ""
    )
    source = source.replace("</head>", f'{font_stylesheet}<script id="website-messages" type="application/json">{payload}</script>\n  </head>')
    return source


def required_messages(root, path, template):
    """Bind a page to its prose, attributes, runtime labels and referenced figures."""
    site = root / "website/public"
    relative = path.relative_to(site).as_posix()
    source = path.read_text(encoding="utf-8")
    required = {(unit[0], unit[1]) for unit in prose_units(source, relative)}
    required.update((unit[0], unit[1]) for unit in attribute_units(source, relative))
    required.update(("runtime", text) for text in read_runtime(root, path))
    for node in Document(source).nodes:
        reference = node.attrs.get("src")
        if reference and not urlsplit(reference).scheme:
            target = (path.parent / unquote(urlsplit(reference).path)).resolve()
            if target.parent == (site / "assets/figures").resolve():
                required.update((entry.msgctxt, entry.msgid) for entry in template if entry.msgctxt == "figure:" + target.name)
    return required


def render_fallback(root, path, language, page_languages, messages):
    """Expose a clear English fallback instead of a stale or partially translated article."""
    from website import page_url
    site = root / "website/public"
    relative = path.relative_to(site).as_posix()
    code = language["code"]
    output_path = site / localized_path(relative, code)
    source = path.read_text(encoding="utf-8")
    edits = []
    canonical = page_url(site, output_path)
    for node in Document(source).nodes:
        raw = source[node.start:node.open_end]
        for attribute in ("href", "src"):
            if attribute in node.attrs:
                value = canonical if node.tag == "link" and node.attrs.get("rel") == "canonical" else relative_reference(node.attrs[attribute], path, output_path, site, set(), code, set(), "data-language" in node.attrs)
                raw = replace_attribute(raw, attribute, value)
        if node.tag == "meta" and node.attrs.get("property") == "og:url":
            raw = replace_attribute(raw, "content", canonical)
        if node.tag == "html":
            raw = raw[:-1] + ' data-translation-fallback="true">'
        if raw != source[node.start:node.open_end]:
            edits.append((node.start, node.open_end, raw))
    source = apply_edits(source, edits)
    source = source.replace("</head>", '<meta name="robots" content="noindex, follow" />\n  </head>')
    source = replace_language_markup(source, root, relative, code, page_languages)
    notice = messages.get(("runtime", FALLBACK_NOTICE), FALLBACK_NOTICE)
    notice_lang = code if ("runtime", FALLBACK_NOTICE) in messages else "en"
    main = next(node for node in Document(source).nodes if node.tag == "main")
    source = source[:main.open_end] + f'<aside class="container translation-notice" lang="{notice_lang}" dir="{language["dir"]}">{escape(notice)}</aside>' + source[main.open_end:]
    return source


def build_translations(root, destination, finalize=None):
    """Build one clean publish directory from English sources and versioned PO catalogs."""
    site = root / "website/public"
    if destination.resolve() != (root / "website/_site").resolve():
        raise ValueError("Generated output must be website/_site")
    template = extract_catalogs(root, check=True)
    inventory = languages(root)
    pages = reading_pages(site)
    catalogs = {language["code"]: checked_catalog(root, language, template)[0] for language in inventory[1:]}
    required = {path.relative_to(site).as_posix(): required_messages(root, path, template) for path in pages}
    page_languages = {relative: {"en"} | {code for code, messages in catalogs.items() if keys <= messages.keys()} for relative, keys in required.items()}
    # Finish rendering before replacing the previous preview/publish artifact.
    with TemporaryDirectory(prefix=".i18n-", dir=root / "website") as directory:
        staging = Path(directory) / "site"
        shutil.copytree(site, staging, ignore=shutil.ignore_patterns("__pycache__"))
        for path in pages:
            relative = path.relative_to(site).as_posix()
            output = staging / relative
            output.write_text(replace_language_markup(path.read_text(encoding="utf-8"), root, relative, "en", page_languages[relative]), encoding="utf-8")
        for language in inventory[1:]:
            messages = catalogs[language["code"]]
            available = {relative for relative, codes in page_languages.items() if language["code"] in codes}
            figures = set()
            for path in sorted((site / "assets/figures").glob("*.svg")):
                source = path.read_text(encoding="utf-8")
                edits = []
                for node in Document(source).nodes:
                    if node.tag in {"text", "title", "desc"} and not any(isinstance(child, Node) for child in node.children):
                        text = unescape(source[node.open_end:node.end_start]).strip()
                        if translatable(text) and ("figure:" + path.name, text) in messages:
                            translated = messages[("figure:" + path.name, text)]
                            edits.append((node.open_end, node.end_start, escape(translated, quote=False)))
                translated = apply_edits(source, edits)
                output = staging / "assets/localized" / language["code"] / path.relative_to(site / "assets")
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(translated, encoding="utf-8")
                figures.add(path.relative_to(site).as_posix())
            for path in pages:
                relative = path.relative_to(site).as_posix()
                output = staging / localized_path(relative, language["code"])
                output.parent.mkdir(parents=True, exist_ok=True)
                rendered = render_page(root, path, language, messages, available, figures, page_languages[relative]) if relative in available else render_fallback(root, path, language, page_languages[relative], messages)
                output.write_text(rendered, encoding="utf-8")
            fallback_count = len(pages) - len(available)
            if fallback_count:
                print(f"{language['code']}: {fallback_count} English fallback pages, marked noindex; run translations status.")
        print(f"Prepared {len(pages) * len(inventory)} reading pages in {len(inventory)} languages.")
        if finalize is not None:
            finalize(staging)
        if destination.exists():
            shutil.rmtree(destination)
        staging.rename(destination)
