#!/usr/bin/env python3
"""Rate limit bypass tester — X-Forwarded-For rotation, case variation, method switching."""
import argparse
import requests
import json
import sys
import random
import time
import urllib3
urllib3.disable_warnings()

def generate_random_ip():
    return f"{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"

def test_xff_bypass(url, method, headers, data, count=20):
    """Test if X-Forwarded-For header bypasses rate limiting."""
    results = {"success": 0, "blocked": 0, "errors": 0}
    for i in range(count):
        ip = generate_random_ip()
        h = {**headers, "X-Forwarded-For": ip, "X-Real-IP": ip,
             "X-Originating-IP": ip, "X-Client-IP": ip}
        try:
            resp = requests.request(method, url, headers=h, json=data, verify=False, timeout=10)
            if resp.status_code == 429:
                results["blocked"] += 1
            else:
                results["success"] += 1
        except:
            results["errors"] += 1
    bypassed = results["success"] == count
    print(f"  {'[BYPASS!]' if bypassed else '[SAFE]   '} X-Forwarded-For rotation: {results['success']}/{count} succeeded")
    return {"technique": "xff_rotation", "bypassed": bypassed, **results}

def test_case_variation(url, method, headers, data, count=10):
    """Test if URL case variation bypasses rate limiting."""
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    results = {"success": 0, "blocked": 0}
    for i in range(count):
        path = "".join(c.upper() if random.random() > 0.5 else c.lower() for c in parsed.path)
        varied_url = f"{parsed.scheme}://{parsed.netloc}{path}"
        if parsed.query:
            varied_url += f"?{parsed.query}"
        try:
            resp = requests.request(method, varied_url, headers=headers, json=data, verify=False, timeout=10)
            if resp.status_code == 429:
                results["blocked"] += 1
            else:
                results["success"] += 1
        except:
            pass
    bypassed = results["success"] == count
    print(f"  {'[BYPASS!]' if bypassed else '[SAFE]   '} Case variation: {results['success']}/{count} succeeded")
    return {"technique": "case_variation", "bypassed": bypassed, **results}

def test_method_switching(url, headers, data):
    """Test if different HTTP methods bypass rate limiting."""
    methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    results = []
    for m in methods:
        try:
            resp = requests.request(m, url, headers=headers, json=data if m != "GET" else None, verify=False, timeout=10)
            blocked = resp.status_code == 429
            results.append({"method": m, "status": resp.status_code, "blocked": blocked})
            icon = "[BLOCK]" if blocked else "[OK]   "
            print(f"  {icon} {m:8s} → {resp.status_code}")
        except:
            pass
    return {"technique": "method_switching", "results": results}

def test_query_param_bypass(url, method, headers, data, count=10):
    """Test if adding random query params bypasses rate limiting."""
    results = {"success": 0, "blocked": 0}
    for i in range(count):
        sep = "&" if "?" in url else "?"
        varied_url = f"{url}{sep}_cache={random.randint(100000,999999)}&_t={int(time.time())}"
        try:
            resp = requests.request(method, varied_url, headers=headers, json=data, verify=False, timeout=10)
            if resp.status_code == 429:
                results["blocked"] += 1
            else:
                results["success"] += 1
        except:
            pass
    bypassed = results["success"] == count
    print(f"  {'[BYPASS!]' if bypassed else '[SAFE]   '} Random query params: {results['success']}/{count} succeeded")
    return {"technique": "query_params", "bypassed": bypassed, **results}

def test_header_variations(url, method, headers, data, count=10):
    """Test various header-based bypass techniques."""
    bypass_headers = [
        {"X-Forwarded-For": "127.0.0.1"},
        {"X-Forwarded-Host": "localhost"},
        {"X-Custom-IP-Authorization": "127.0.0.1"},
        {"X-Original-URL": "/"},
        {"X-Rewrite-URL": "/"},
        {"Content-Length": "0"},
    ]
    results = []
    for bh in bypass_headers:
        try:
            h = {**headers, **bh}
            resp = requests.request(method, url, headers=h, json=data, verify=False, timeout=10)
            bypassed = resp.status_code != 429
            key = list(bh.keys())[0]
            results.append({"header": key, "value": bh[key], "status": resp.status_code, "bypassed": bypassed})
            icon = "[BYPASS!]" if bypassed else "[SAFE]   "
            print(f"  {icon} {key}: {bh[key]} → {resp.status_code}")
        except:
            pass
    return {"technique": "header_variations", "results": results}

def main():
    parser = argparse.ArgumentParser(description="Rate limit bypass tester")
    parser.add_argument("url", help="Target URL")
    parser.add_argument("--method", default="POST", help="HTTP method")
    parser.add_argument("-H", "--header", action="append", default=[])
    parser.add_argument("-d", "--data", default=None, help="Request body JSON")
    parser.add_argument("--count", type=int, default=10, help="Requests per test")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    headers = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"}
    for h in args.header:
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()
    data = json.loads(args.data) if args.data else None

    print(f"\nRate Limit Bypass Tester: {args.url}")
    print(f"Method: {args.method} | Requests per test: {args.count}")
    print(f"{'='*60}\n")

    all_results = []

    print("[1] X-Forwarded-For Rotation:")
    all_results.append(test_xff_bypass(args.url, args.method, headers, data, args.count))

    print(f"\n[2] Case Variation:")
    all_results.append(test_case_variation(args.url, args.method, headers, data, args.count))

    print(f"\n[3] HTTP Method Switching:")
    all_results.append(test_method_switching(args.url, headers, data))

    print(f"\n[4] Random Query Parameters:")
    all_results.append(test_query_param_bypass(args.url, args.method, headers, data, args.count))

    print(f"\n[5] Header Variations:")
    all_results.append(test_header_variations(args.url, args.method, headers, data, args.count))

    bypasses = [r for r in all_results if r.get("bypassed")]
    print(f"\n{'='*60}")
    print(f"Results: {len(bypasses)} bypass techniques found")

    if args.json_output:
        print(json.dumps({"url": args.url, "results": all_results}, indent=2))

if __name__ == "__main__":
    main()
