"""Optionally audit external website links; network failures stay distinct from missing targets."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen

from website import authored_markdown


@lru_cache(maxsize=None)
def github_api(endpoint):
    """Read GitHub evidence through the caller's gh installation and authentication."""
    result = subprocess.run(["gh", "api", endpoint], capture_output=True, encoding="utf-8", timeout=20)
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return json.loads(result.stdout)


def github_target(url):
    """Resolve repository URLs, including branch names containing slashes."""
    parts = [unquote(part) for part in url.path.strip("/").split("/")]
    if len(parts) < 2:
        return None
    repo = f"repos/{parts[0]}/{parts[1]}"
    if url.hostname == "raw.githubusercontent.com" and len(parts) >= 4:
        # Raw URLs omit the blob segment; share ref/path resolution below.
        parts = [*parts[:2], "blob", *parts[2:]]
    if len(parts) == 2:
        return repo
    kind = parts[2]
    if kind in ("blob", "tree") and len(parts) >= 4:
        ref = parts[3]
        # GitHub uses the longest matching branch name before the source path.
        if not re.fullmatch(r"[0-9a-f]{40}", ref):
            references = github_api(f"{repo}/git/matching-refs/heads/{quote(ref, safe='')}")
            references += github_api(f"{repo}/git/matching-refs/tags/{quote(ref, safe='')}")
            suffix = "/".join(parts[3:])
            matches = [item["ref"].split("/", 2)[2] for item in references]
            matches = [name for name in matches if suffix == name or suffix.startswith(name + "/")]
            if matches:
                ref = max(matches, key=len)
        path = "/".join(parts[3:])[len(ref):].lstrip("/")
        return f"{repo}/contents/{quote(path, safe='/')}?ref={quote(ref, safe='')}"
    if kind in ("issues", "pull") and len(parts) == 4 and parts[3].isdigit():
        return f"{repo}/{'pulls' if kind == 'pull' else 'issues'}/{parts[3]}"
    if kind == "commit" and len(parts) == 4:
        return f"{repo}/commits/{parts[3]}"
    if kind == "releases" and len(parts) >= 5 and parts[3] in ("tag", "download"):
        return f"{repo}/releases/tags/{quote(parts[4], safe='')}"
    return None


def audit_url(item):
    """Classify confirmed missing links separately from blocked or unsupported probes."""
    value, sources = item
    result = {"url": value, "sources": sorted(set(sources))}
    url = urlsplit(value)
    try:
        if url.hostname in ("github.com", "raw.githubusercontent.com"):
            endpoint = github_target(url)
            if endpoint is None:
                return dict(result, status="unknown", reason="GitHub UI route; check in a browser")
            data = github_api(endpoint)
            parts = url.path.strip("/").split("/")
            if len(parts) >= 6 and parts[2:4] == ["releases", "download"]:
                if unquote(parts[5]) not in [asset["name"] for asset in data.get("assets", [])]:
                    return dict(result, status="broken", reason="Release asset is missing")
            return dict(result, status="ok", via="gh api", endpoint=endpoint)
        request = Request(value.split("#", 1)[0], headers={
            "User-Agent": "REA-Website-Verifier/1.0 (+https://github.com/morluto/rea)",
        })
        with urlopen(request, timeout=15) as response:
            return dict(result, status="ok", http_status=response.status, final_url=response.url)
    except HTTPError as error:
        return dict(result, status="broken" if error.code in (404, 410) else "unknown", reason=str(error))
    except ValueError as error:
        return dict(result, status="broken" if "HTTP 404" in str(error) else "unknown", reason=str(error))
    except (OSError, URLError, TimeoutError, subprocess.TimeoutExpired) as error:
        return dict(result, status="unknown", reason=str(error))


def external_links(root):
    """Discover authored external links, excluding locally checked site and preview URLs."""
    references = {}

    def add(value, source):
        url = urlsplit(value)
        if url.scheme in ("http", "https") and url.hostname not in ("rea.tools", "localhost", "127.0.0.1", "::1"):
            references.setdefault(value, []).append(str(source.relative_to(root)))

    class Links(HTMLParser):
        def handle_starttag(self, tag, attrs):
            for key, value in attrs:
                if key in ("href", "src") and value:
                    add(value, path)

    for path in sorted((root / "website/public").rglob("*.html")):
        Links().feed(path.read_text(encoding="utf-8"))
    for path in authored_markdown(root):
        for value in re.findall(r"(?:\]\(|<)(https?://[^\s<>\)]+)", path.read_text(encoding="utf-8")):
            add(value, path)
    return references


def main():
    """Run an explicit network audit without making PR checks depend on third-party uptime."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Write the complete JSON report outside public assets")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(audit_url, external_links(root).items()))
    if args.report:
        if args.report.resolve().is_relative_to(root / "website/public"):
            parser.error("Keep audit reports outside website/public.")
        args.report.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    counts = {status: sum(item["status"] == status for item in results) for status in ("ok", "broken", "unknown")}
    print(f"External links: {counts['ok']} reachable, {counts['broken']} missing, {counts['unknown']} need manual verification.")
    print("GitHub checks establish target existence; external fragment IDs are not checked.")
    for item in results:
        if item["status"] != "ok":
            print(f"{item['status']}: {item['url']} — {item['reason']}")
    return 1 if counts["broken"] else 0


if __name__ == "__main__":
    sys.exit(main())
