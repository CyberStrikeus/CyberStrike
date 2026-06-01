#!/usr/bin/env python3
"""Wayback Machine endpoint discovery — find historical/hidden endpoints via CDX API."""
import argparse
import requests
import json
import sys
from urllib.parse import urlparse
import urllib3
urllib3.disable_warnings()

def fetch_wayback(domain, limit=5000):
    url = f"https://web.archive.org/cdx/search/cdx?url=*.{domain}/*&output=json&fl=original,statuscode,mimetype&collapse=urlkey&limit={limit}"
    try:
        resp = requests.get(url, timeout=60)
        if resp.status_code != 200:
            return []
        data = resp.json()
        if len(data) <= 1:
            return []
        return data[1:]  # Skip header row
    except Exception as e:
        print(f"[ERROR] Wayback fetch failed: {e}")
        return []

def categorize_endpoints(entries):
    categories = {
        "api_endpoints": [], "admin_panels": [], "config_files": [],
        "backup_files": [], "debug_endpoints": [], "auth_endpoints": [],
        "upload_endpoints": [], "interesting": [],
    }
    seen = set()
    for entry in entries:
        url, status, mime = entry[0], entry[1], entry[2]
        parsed = urlparse(url)
        path = parsed.path.lower()
        if url in seen:
            continue
        seen.add(url)
        item = {"url": url, "status": status, "mime": mime}

        if any(x in path for x in ["/api/", "/v1/", "/v2/", "/v3/", "/graphql", "/rest/"]):
            categories["api_endpoints"].append(item)
        elif any(x in path for x in ["/admin", "/dashboard", "/manage", "/panel", "/cms"]):
            categories["admin_panels"].append(item)
        elif any(x in path for x in [".env", ".config", "config.", "settings.", "appsettings", "web.config", ".yml", ".yaml", ".toml"]):
            categories["config_files"].append(item)
        elif any(x in path for x in [".bak", ".old", ".orig", ".backup", ".sql", ".dump", ".tar", ".gz", ".zip"]):
            categories["backup_files"].append(item)
        elif any(x in path for x in ["/debug", "/pprof", "/actuator", "/phpinfo", "/_debug", "/trace", "/health"]):
            categories["debug_endpoints"].append(item)
        elif any(x in path for x in ["/login", "/auth", "/oauth", "/sso", "/signup", "/register", "/forgot", "/reset"]):
            categories["auth_endpoints"].append(item)
        elif any(x in path for x in ["/upload", "/import", "/export", "/download", "/file"]):
            categories["upload_endpoints"].append(item)
        elif any(x in path for x in ["/internal", "/staging", "/dev", "/test", "/beta", "/sandbox"]):
            categories["interesting"].append(item)
    return categories

def probe_alive(urls, max_check=50):
    alive = []
    for url in urls[:max_check]:
        try:
            resp = requests.head(url, verify=False, timeout=5, allow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code < 500:
                alive.append({"url": url, "status": resp.status_code})
        except:
            pass
    return alive

def main():
    parser = argparse.ArgumentParser(description="Wayback Machine endpoint discovery")
    parser.add_argument("domain", help="Target domain")
    parser.add_argument("--probe", action="store_true", help="Check if endpoints are still alive")
    parser.add_argument("--limit", type=int, default=5000, help="Max results from Wayback")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    print(f"\nWayback Machine Endpoint Discovery: {args.domain}")
    print(f"{'='*60}\n")

    entries = fetch_wayback(args.domain, args.limit)
    print(f"[*] Found {len(entries)} unique URLs in Wayback Machine\n")

    if not entries:
        return

    categories = categorize_endpoints(entries)
    for cat, items in categories.items():
        if items:
            print(f"[{cat.upper()}] ({len(items)} found):")
            for item in items[:10]:
                print(f"  {item['status']} {item['url'][:120]}")
            if len(items) > 10:
                print(f"  ... and {len(items) - 10} more")
            print()

    if args.probe:
        print("[*] Probing endpoints for alive status...\n")
        high_value = (categories["api_endpoints"] + categories["admin_panels"] +
                      categories["config_files"] + categories["debug_endpoints"])
        urls = [item["url"] for item in high_value]
        alive = probe_alive(urls)
        if alive:
            print(f"[ALIVE] {len(alive)} endpoints still responding:")
            for a in alive:
                print(f"  [{a['status']}] {a['url'][:120]}")

    if args.json_output:
        print(json.dumps({"domain": args.domain, "total": len(entries), "categories": {k: v[:20] for k, v in categories.items()}}, indent=2))

if __name__ == "__main__":
    main()
