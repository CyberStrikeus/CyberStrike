"""Maintain shared HTML and run the static website's contributor commands."""

import argparse
from datetime import date
from functools import partial
from html import escape
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path, PurePosixPath
from string import Template
import subprocess
import sys
import tempfile
from textwrap import indent
from urllib.parse import quote, urlsplit


SITE_ORIGIN = "https://rea.tools"
NOTES_FIXTURES = {"examples/notes-electron/index.html", "examples/notes-web/index.html"}
NAVIGATION = (
    ("Get started", "get-started/"),
    ("Showcases", "showcase/"),
    ("Blog", "blog/"),
    ("Guides", "guides/"),
)


def checked_contributors(data):
    """Validate the public snapshot once, before rendering or replacing it."""
    if not isinstance(data, dict) or data.get("repository") != "morluto/rea":
        raise ValueError("Contributors must come from morluto/rea")
    if not isinstance(data.get("updated"), str):
        raise ValueError("Contributors need an ISO update date")
    date.fromisoformat(data["updated"])
    people = data.get("contributors")
    if not isinstance(people, list) or not people:
        raise ValueError("Contributors must be a nonempty list")
    ids, logins = set(), set()
    for person in people:
        if not isinstance(person, dict):
            raise ValueError("Invalid contributor record")
        identity, login = person.get("id"), person.get("login")
        if type(identity) is not int or identity <= 0 or identity in ids:
            raise ValueError("Contributor IDs must be unique positive integers")
        if not isinstance(login, str) or not login.strip() or login.casefold() in logins:
            raise ValueError("Contributor usernames must be nonempty and unique")
        if person.get("type") not in ("User", "Bot"):
            raise ValueError(f"Unknown contributor type: {login}")
        for key, host in (("html_url", "github.com"), ("avatar_url", "avatars.githubusercontent.com")):
            value = person.get(key)
            if not isinstance(value, str):
                raise ValueError(f"Missing {key}: {login}")
            url = urlsplit(value)
            if url.scheme != "https" or url.netloc != host or not url.path:
                raise ValueError(f"Invalid public {key}: {login}")
        ids.add(identity)
        logins.add(login.casefold())
    return data


def contributor_block(root):
    """Render equal-sized profile links from the checked GitHub snapshot."""
    path = root / "website/public/contributors/people.json"
    data = checked_contributors(json.loads(path.read_text(encoding="utf-8")))
    cards = []
    for person in sorted(data["contributors"], key=lambda item: item["login"].casefold()):
        login = escape(person["login"], quote=True)
        profile = escape(person["html_url"], quote=True)
        avatar = escape(person["avatar_url"], quote=True)
        cards.append(
            f'  <li data-contributor="{login}"><a class="contributor-card" href="{profile}">\n'
            f'    <img src="{avatar}" alt="" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer" />\n'
            f'    <span dir="ltr">@{login}</span>\n'
            '  </a></li>'
        )
    template = root / "website/templates/contributors.html.tmpl"
    return indent(Template(template.read_text(encoding="utf-8")).substitute(
        cards="\n".join(cards), updated=escape(data["updated"], quote=True),
    ), "        ")


def refresh_contributors(root):
    """Validate every GitHub page, then atomically replace the offline snapshot."""
    result = subprocess.run(
        ["gh", "api", "--paginate", "repos/morluto/rea/contributors?per_page=100", "--jq",
         "[.[] | {login,id,type,avatar_url,html_url}]"],
        capture_output=True, text=True, check=True,
    )
    decoder, remaining, people = json.JSONDecoder(), result.stdout.strip(), []
    while remaining:
        page, end = decoder.raw_decode(remaining)
        if not isinstance(page, list):
            raise ValueError("GitHub returned an invalid contributors page")
        people.extend(page)
        remaining = remaining[end:].lstrip()
    data = checked_contributors({
        "repository": "morluto/rea", "updated": date.today().isoformat(), "contributors": people,
    })
    path = root / "website/public/contributors/people.json"
    with tempfile.TemporaryDirectory(dir=path.parent, prefix=f".{path.name}-") as directory:
        staged = Path(directory) / path.name
        staged.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        staged.replace(path)
    print(f"Refreshed {len(people)} contributors. Run sync, translations extract and check.")


def authored_markdown(root):
    """Discover website documentation while excluding local environments and vendors."""
    site = root / "website"
    return [
        path for path in sorted(site.rglob("*.md"))
        if not any(part.startswith(".") or part in ("node_modules", "__pycache__")
                   for part in path.relative_to(site).parts)
        and "_site" not in path.relative_to(site).parts
    ]


class PageMetadata(HTMLParser):
    """Read the authored title, description and indexing policy from the head."""

    def __init__(self):
        super().__init__()
        self.in_head = False
        self.in_title = False
        self.titles = []
        self.descriptions = []
        self.noindex = False

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.in_head = True
        if not self.in_head:
            return
        if tag == "title":
            self.in_title = True
            self.titles.append("")
        if tag == "meta":
            attributes = dict(attrs)
            name = (attributes.get("name") or "").lower()
            content = attributes.get("content") or ""
            if name == "description":
                self.descriptions.append(content)
            if name in ("robots", "googlebot"):
                self.noindex |= bool(
                    set(content.lower().replace(",", " ").split()) & {"noindex", "none"}
                )

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.titles[-1] += data


def page_route(site, path):
    """Map an HTML file to its public route without a separate page registry."""
    route = path.relative_to(site).as_posix()
    return route.removesuffix("index.html") if path.name == "index.html" else route


def page_url(site, path):
    """Return the canonical public URL of an authored HTML file."""
    return f"{SITE_ORIGIN}/{quote(page_route(site, path), safe='/')}"


def shared_blocks(root, path, source):
    """Render shared regions while keeping the page's body and metadata authored."""
    site = root / "website/public"
    metadata = PageMetadata()
    metadata.feed(source)
    for name, values in (("title", metadata.titles), ("description", metadata.descriptions)):
        if len(values) != 1 or not values[0].strip():
            raise ValueError(f"{path.relative_to(site)}: needs one nonempty head {name}")
    depth = len(path.relative_to(site).parent.parts)
    base = "../" * depth or "./"
    route = page_route(site, path)
    links = []
    for label, destination in NAVIGATION:
        attributes = ' class="nav-start"' if destination == "get-started/" else ""
        if route.startswith(destination):
            attributes += ' aria-current="page"'
        links.append(f'      <a href="{base}{destination}"{attributes}>{label}</a>')
    values = {
        "base": base,
        "navigation": "\n" + "\n".join(links) + "\n    ",
        "canonical": escape(page_url(site, path), quote=True),
        "origin": SITE_ORIGIN,
        "title": escape(metadata.titles[0].strip(), quote=True),
        "description": escape(metadata.descriptions[0].strip(), quote=True),
    }
    from website_i18n import language_markup
    selector, alternates = language_markup(root, path.relative_to(site).as_posix())
    values["language_picker"] = indent(selector, "      ") if not metadata.noindex else ""
    values["alternates"] = alternates if not metadata.noindex else ""
    templates = root / "website/templates"
    blocks = {
        name: indent(Template((templates / f"{name}.html.tmpl").read_text(encoding="utf-8")).substitute(values), "    ")
        for name in ("sharing", "theme", "header", "footer")
    }
    if route == "contributors/":
        blocks["contributors"] = contributor_block(root)
    return blocks


def sync_pages(root, check=False):
    """Update shared regions, or reject drift without changing any authored file."""
    site = root / "website/public"
    changes = []
    for path in sorted(site.rglob("*.html")):
        if path.relative_to(site).as_posix() in NOTES_FIXTURES:
            continue
        original = path.read_text(encoding="utf-8")
        source = original
        for name, block in shared_blocks(root, path, source).items():
            start = f"    <!-- website:{name}:start -->\n"
            end = f"    <!-- website:{name}:end -->"
            if source.count(start) != 1 or source.count(end) != 1:
                raise ValueError(f"{path.relative_to(site)}: needs one {name} region; use new-page for a new reading page")
            before, _, remaining = source.partition(start)
            _, found, after = remaining.partition(end)
            if not found:
                raise ValueError(f"{path.relative_to(site)}: {name} region is out of order")
            source = before + start + block + end + after
        if source != original:
            changes.append((path, source))
    if check and changes:
        names = ", ".join(str(path.relative_to(site)) for path, _ in changes)
        raise ValueError(f"Shared HTML is stale: {names}. Run python3 scripts/website.py sync and commit the updated pages.")
    if not check:
        for path, source in changes:
            path.write_text(source, encoding="utf-8")
    print(f"{'Checked' if check else 'Synced'} shared HTML ({len(changes)} pages changed).")
    return [path for path, _ in changes]


def new_page(root, route, title, description):
    """Create a draft reading page with correct depth, metadata and shared regions."""
    parts = PurePosixPath(route)
    if not route or parts.is_absolute() or ".." in parts.parts or "\\" in route or parts.suffix:
        raise ValueError("Use a relative directory route, such as blog/my-article.")
    site = root / "website/public"
    path = site.joinpath(*parts.parts, "index.html")
    if not path.resolve().is_relative_to(site.resolve()):
        raise ValueError("The new page must stay inside website/public.")
    if path.exists():
        raise ValueError(f"Page already exists: {path.relative_to(site)}")
    base = "../" * len(parts.parts) or "./"
    source = Template((root / "website/templates/page.html").read_text(encoding="utf-8")).substitute(
        title=escape(title, quote=True), description=escape(description, quote=True), base=base,
    )
    # Render before writing, so invalid input cannot leave an incomplete page.
    blocks = shared_blocks(root, path, source)
    for name, block in blocks.items():
        source = source.replace(f"    <!-- website:{name}:start -->\n", f"    <!-- website:{name}:start -->\n{block}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source, encoding="utf-8")
    print(f"Created {path.relative_to(root)}. Write the page, add its index link, then remove the Draft label and noindex directive when ready.")
    return path


def run_script(root, name, arguments=()):
    """Use the active Python environment for the existing preparation and checks."""
    subprocess.run([sys.executable, str(root / "scripts" / name), *arguments], cwd=root, check=True)


def preview_handler(site, prefix):
    """Serve one static directory at root or a Pages prefix, preserving redirects."""
    class Handler(SimpleHTTPRequestHandler):
        def send_head(self):
            if not urlsplit(self.path).path.startswith(prefix):
                self.send_error(404)
                return None
            return super().send_head()

        def translate_path(self, path):
            return super().translate_path("/" + path[len(prefix):])

    return partial(Handler, directory=str(site))


def main():
    """Expose one small command for synchronizing, checking and previewing the site."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sync = commands.add_parser("sync", help="Update shared HTML after editing templates or page metadata")
    sync.add_argument("--check", action="store_true", help="Report drift without rewriting pages")
    commands.add_parser("check", help="Check shared HTML, prepare assets, verify links and run regression tests")
    commands.add_parser("contributors", help="Refresh the public contributor snapshot using GitHub CLI")
    links = commands.add_parser("links", help="Audit external targets using gh and HTTP; separate from offline checks")
    links.add_argument("--report", help="Write the full external-link JSON report")
    create = commands.add_parser("new-page", help="Create a draft reading page")
    create.add_argument("route")
    create.add_argument("--title", required=True)
    create.add_argument("--description", required=True)
    translations = commands.add_parser("translations", help="Maintain gettext catalogs")
    translations.add_argument("action", choices=("extract", "status", "check"))
    translations.add_argument("--language", help="Check one language, such as zh-CN")
    translations.add_argument("--strict", action="store_true", help="Fail on missing or fuzzy translations")
    serve = commands.add_parser("serve", help="Prepare and preview the static site")
    serve.add_argument("--port", type=int, default=4173)
    serve.add_argument("--base-path", choices=("/", "/rea/"), default="/")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        if args.command == "translations":
            from website_i18n import checked_catalog, extract_catalogs, languages
            template = extract_catalogs(root, check=args.action != "extract")
            if args.action != "extract":
                inventory = languages(root)[1:]
                if args.language:
                    inventory = [item for item in inventory if item["code"] == args.language]
                    if not inventory:
                        raise ValueError(f"Unknown translation language: {args.language}")
                for language in inventory:
                    messages, missing = checked_catalog(root, language, template, strict=args.strict)
                    print(f"{language['code']}: {len(messages)}/{len(template)} translated; {len(missing)} missing or fuzzy")
        elif args.command == "new-page":
            new_page(root, args.route, args.title, args.description)
        elif args.command == "sync":
            sync_pages(root, check=args.check)
        elif args.command == "contributors":
            refresh_contributors(root)
        elif args.command == "check":
            sync_pages(root, check=True)
            for name in ("prepare-website.py", "verify-website.py", "test-website.py"):
                run_script(root, name)
        elif args.command == "links":
            run_script(root, "audit-website-links.py", ["--report", args.report] if args.report else [])
        else:
            sync_pages(root)
            run_script(root, "prepare-website.py")
            prefix = args.base_path

            handler = preview_handler(root / "website/_site", prefix)
            with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
                print(f"Preview: http://127.0.0.1:{server.server_port}{prefix}", flush=True)
                server.serve_forever()
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as error:
        return error.returncode
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
