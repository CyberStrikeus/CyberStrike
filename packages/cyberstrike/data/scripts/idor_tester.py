#!/usr/bin/env python3
"""IDOR tester — cross-account access testing with two sets of credentials."""
import argparse
import requests
import json
import sys
import urllib3
urllib3.disable_warnings()

def test_endpoint(url, token, method="GET", data=None):
    headers = {"Authorization": f"Bearer {token}"} if not token.startswith("Cookie:") else {"Cookie": token.split("Cookie:", 1)[1].strip()}
    headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

    try:
        if method.upper() == "GET":
            resp = requests.get(url, headers=headers, verify=False, timeout=10)
        elif method.upper() == "POST":
            headers["Content-Type"] = "application/json"
            resp = requests.post(url, headers=headers, json=data, verify=False, timeout=10)
        elif method.upper() == "PUT":
            headers["Content-Type"] = "application/json"
            resp = requests.put(url, headers=headers, json=data, verify=False, timeout=10)
        elif method.upper() == "DELETE":
            resp = requests.delete(url, headers=headers, verify=False, timeout=10)
        else:
            resp = requests.request(method.upper(), url, headers=headers, verify=False, timeout=10)

        return {
            "status": resp.status_code,
            "length": len(resp.text),
            "body_preview": resp.text[:500],
            "headers": dict(resp.headers),
        }
    except Exception as e:
        return {"status": 0, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="IDOR cross-account tester")
    parser.add_argument("--token-a", required=True, help="Token for Account A (victim)")
    parser.add_argument("--token-b", required=True, help="Token for Account B (attacker)")
    parser.add_argument("--endpoints", required=True, help="File with endpoints (one per line) or comma-separated")
    parser.add_argument("--method", default="GET", help="HTTP method (default: GET)")
    parser.add_argument("--data", default=None, help="Request body JSON (for POST/PUT)")
    parser.add_argument("--json-output", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    # Parse endpoints
    if "," in args.endpoints:
        endpoints = [e.strip() for e in args.endpoints.split(",")]
    else:
        with open(args.endpoints) as f:
            endpoints = [l.strip() for l in f if l.strip()]

    data = json.loads(args.data) if args.data else None
    results = []

    print(f"Testing {len(endpoints)} endpoints for IDOR...")
    print(f"Method: {args.method}")
    print(f"{'='*70}\n")

    for endpoint in endpoints:
        # Test: Account A accessing their own resource (baseline)
        resp_a_own = test_endpoint(endpoint, args.token_a, args.method, data)

        # Test: Account B accessing Account A's resource (IDOR test)
        resp_b_cross = test_endpoint(endpoint, args.token_b, args.method, data)

        is_idor = False
        reason = ""

        if resp_b_cross["status"] == 200 and resp_a_own["status"] == 200:
            # Both 200 — check if attacker sees victim's data
            if resp_b_cross["length"] > 50:  # Non-trivial response
                is_idor = True
                reason = f"Account B got 200 with {resp_b_cross['length']} bytes (Account A baseline: {resp_a_own['length']} bytes)"
        elif resp_b_cross["status"] == 200 and resp_a_own["status"] in [401, 403]:
            is_idor = True
            reason = f"Account B got 200 but Account A got {resp_a_own['status']} — possible privilege escalation"

        result = {
            "endpoint": endpoint,
            "idor_detected": is_idor,
            "reason": reason,
            "account_a": {"status": resp_a_own["status"], "length": resp_a_own.get("length", 0)},
            "account_b_cross": {"status": resp_b_cross["status"], "length": resp_b_cross.get("length", 0)},
        }
        results.append(result)

        if not args.json_output:
            icon = "[IDOR!]" if is_idor else "[SAFE] "
            print(f"{icon} {endpoint}")
            print(f"        A(own): {resp_a_own['status']} ({resp_a_own.get('length', 0)}b)")
            print(f"        B(cross): {resp_b_cross['status']} ({resp_b_cross.get('length', 0)}b)")
            if is_idor:
                print(f"        Reason: {reason}")
            print()

    idor_count = sum(1 for r in results if r["idor_detected"])

    if args.json_output:
        print(json.dumps({"total": len(results), "idor_found": idor_count, "results": results}, indent=2))
    else:
        print(f"{'='*70}")
        print(f"RESULTS: {idor_count}/{len(results)} endpoints vulnerable to IDOR")
        if idor_count > 0:
            print(f"\nVulnerable endpoints:")
            for r in results:
                if r["idor_detected"]:
                    print(f"  - {r['endpoint']}: {r['reason']}")

if __name__ == "__main__":
    main()
