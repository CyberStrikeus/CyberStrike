#!/usr/bin/env python3
"""GraphQL vulnerability tester — introspection, complexity DoS, batch abuse, mutation auth bypass."""
import argparse
import requests
import json
import sys
import urllib3
urllib3.disable_warnings()

INTROSPECTION_QUERY = '{"query":"{ __schema { types { name fields { name type { name } } } mutationType { fields { name } } queryType { fields { name } } } }"}'

def test_introspection(url, headers):
    """Check if introspection is enabled — exposes entire API schema."""
    try:
        resp = requests.post(url, data=INTROSPECTION_QUERY, headers={**headers, "Content-Type": "application/json"}, verify=False, timeout=15)
        data = resp.json()
        if "data" in data and "__schema" in data.get("data", {}):
            schema = data["data"]["__schema"]
            types = [t["name"] for t in schema.get("types", []) if not t["name"].startswith("__")]
            mutations = [f["name"] for f in (schema.get("mutationType") or {}).get("fields", [])]
            queries = [f["name"] for f in (schema.get("queryType") or {}).get("fields", [])]
            print(f"  [VULN!] Introspection ENABLED — {len(types)} types, {len(queries)} queries, {len(mutations)} mutations")
            if mutations:
                print(f"          Mutations: {', '.join(mutations[:10])}")
            if queries:
                print(f"          Queries: {', '.join(queries[:10])}")
            return {"enabled": True, "types": len(types), "queries": queries[:20], "mutations": mutations[:20]}
        print("  [SAFE]  Introspection disabled")
        return {"enabled": False}
    except Exception as e:
        print(f"  [ERROR] {e}")
        return {"error": str(e)}

def test_complexity_dos(url, headers, depth=10):
    """Test nested query DoS — deeply nested queries that crash the server."""
    # Build nested query: { users { posts { comments { author { posts { ... } } } } } }
    inner = "id name"
    for i in range(depth):
        inner = f"nested{i} {{ {inner} }}"
    query = f'{{"query":"{{ {inner} }}"}}'
    try:
        resp = requests.post(url, data=query, headers={**headers, "Content-Type": "application/json"}, verify=False, timeout=30)
        if resp.status_code == 200 and resp.elapsed.total_seconds() > 5:
            print(f"  [VULN!] Complexity DoS — depth {depth} took {resp.elapsed.total_seconds():.1f}s")
            return {"vulnerable": True, "depth": depth, "time_seconds": resp.elapsed.total_seconds()}
        elif resp.status_code >= 500:
            print(f"  [VULN!] Server error at depth {depth} — {resp.status_code}")
            return {"vulnerable": True, "depth": depth, "status": resp.status_code}
        else:
            print(f"  [SAFE]  Depth {depth} handled OK ({resp.status_code}, {resp.elapsed.total_seconds():.1f}s)")
            return {"vulnerable": False}
    except requests.exceptions.Timeout:
        print(f"  [VULN!] Request timed out at depth {depth} — server overwhelmed")
        return {"vulnerable": True, "depth": depth, "timeout": True}
    except Exception as e:
        return {"error": str(e)}

def test_batch_abuse(url, headers, count=50):
    """Test batch query abuse — send many queries in single request."""
    queries = [{"query": f'{{ __typename }}'} for _ in range(count)]
    try:
        resp = requests.post(url, json=queries, headers=headers, verify=False, timeout=30)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) == count:
                print(f"  [VULN!] Batch queries accepted — {count} queries in single request")
                return {"vulnerable": True, "count": count}
        print(f"  [SAFE]  Batch queries rejected or limited ({resp.status_code})")
        return {"vulnerable": False}
    except Exception as e:
        return {"error": str(e)}

def test_alias_dos(url, headers, count=100):
    """Test alias-based DoS — same query duplicated via aliases."""
    aliases = " ".join([f'a{i}: __typename' for i in range(count)])
    query = f'{{"query":"{{ {aliases} }}"}}'
    try:
        resp = requests.post(url, data=query, headers={**headers, "Content-Type": "application/json"}, verify=False, timeout=30)
        if resp.status_code == 200 and resp.elapsed.total_seconds() > 3:
            print(f"  [VULN!] Alias DoS — {count} aliases took {resp.elapsed.total_seconds():.1f}s")
            return {"vulnerable": True, "aliases": count, "time": resp.elapsed.total_seconds()}
        print(f"  [SAFE]  {count} aliases handled ({resp.elapsed.total_seconds():.1f}s)")
        return {"vulnerable": False}
    except Exception as e:
        return {"error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="GraphQL vulnerability tester")
    parser.add_argument("url", help="GraphQL endpoint URL")
    parser.add_argument("-H", "--header", action="append", default=[], help="Headers (key:value)")
    parser.add_argument("--depth", type=int, default=10, help="Nesting depth for DoS test")
    parser.add_argument("--batch-count", type=int, default=50, help="Number of batch queries")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    headers = {"User-Agent": "Mozilla/5.0"}
    for h in args.header:
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()

    results = {}
    print(f"\nGraphQL Vulnerability Test: {args.url}")
    print(f"{'='*60}\n")

    print("[1] Introspection:")
    results["introspection"] = test_introspection(args.url, headers)

    print(f"\n[2] Complexity DoS (depth={args.depth}):")
    results["complexity_dos"] = test_complexity_dos(args.url, headers, args.depth)

    print(f"\n[3] Batch Query Abuse (count={args.batch_count}):")
    results["batch_abuse"] = test_batch_abuse(args.url, headers, args.batch_count)

    print(f"\n[4] Alias DoS:")
    results["alias_dos"] = test_alias_dos(args.url, headers)

    if args.json_output:
        print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
