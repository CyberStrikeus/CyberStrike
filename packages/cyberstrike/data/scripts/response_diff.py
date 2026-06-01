#!/usr/bin/env python3
"""Response diff — compare two HTTP responses to detect access control differences."""
import argparse
import requests
import json
import difflib
import sys
import urllib3
urllib3.disable_warnings()

def fetch(url, headers=None, method="GET", data=None):
    h = {"User-Agent": "Mozilla/5.0"}
    if headers:
        for kv in headers:
            k, v = kv.split(":", 1)
            h[k.strip()] = v.strip()
    try:
        resp = requests.request(method, url, headers=h, json=data, verify=False, timeout=15)
        return {
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "body": resp.text,
            "length": len(resp.text),
        }
    except Exception as e:
        return {"status": 0, "error": str(e), "body": "", "headers": {}, "length": 0}

def main():
    parser = argparse.ArgumentParser(description="HTTP response diff tool")
    parser.add_argument("url", help="URL to test")
    parser.add_argument("--header-a", action="append", default=[], help="Headers for request A")
    parser.add_argument("--header-b", action="append", default=[], help="Headers for request B")
    parser.add_argument("--method", default="GET")
    parser.add_argument("--data", default=None, help="JSON body")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    data = json.loads(args.data) if args.data else None

    print(f"Fetching response A...")
    resp_a = fetch(args.url, args.header_a, args.method, data)
    print(f"Fetching response B...")
    resp_b = fetch(args.url, args.header_b, args.method, data)

    diff = {
        "url": args.url,
        "status_match": resp_a["status"] == resp_b["status"],
        "length_match": resp_a["length"] == resp_b["length"],
        "a": {"status": resp_a["status"], "length": resp_a["length"]},
        "b": {"status": resp_b["status"], "length": resp_b["length"]},
    }

    if args.json_output:
        # Add body diff
        a_lines = resp_a["body"].splitlines(keepends=True)
        b_lines = resp_b["body"].splitlines(keepends=True)
        delta = list(difflib.unified_diff(a_lines, b_lines, fromfile="Response A", tofile="Response B", lineterm=""))
        diff["body_diff"] = "".join(delta[:100])
        print(json.dumps(diff, indent=2))
    else:
        print(f"\n{'='*60}")
        print(f"Response A: {resp_a['status']} ({resp_a['length']} bytes)")
        print(f"Response B: {resp_b['status']} ({resp_b['length']} bytes)")
        print(f"Status match: {diff['status_match']}")
        print(f"Length match: {diff['length_match']}")

        if not diff["status_match"]:
            print(f"\n[!] Different status codes — possible access control difference")

        if resp_a["body"] != resp_b["body"]:
            print(f"\n--- Body Diff ---")
            a_lines = resp_a["body"].splitlines(keepends=True)[:50]
            b_lines = resp_b["body"].splitlines(keepends=True)[:50]
            for line in difflib.unified_diff(a_lines, b_lines, fromfile="A", tofile="B"):
                print(line, end="")
        else:
            print(f"\n[*] Bodies are identical")

if __name__ == "__main__":
    main()
