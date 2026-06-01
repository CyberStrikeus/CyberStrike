#!/usr/bin/env python3
"""CORS misconfiguration checker — test multiple origin reflection patterns."""
import argparse
import requests
import json
import sys
import urllib3
urllib3.disable_warnings()

def check_cors(url, origin, method="GET"):
    headers = {
        "Origin": origin,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    }
    try:
        resp = requests.request(method, url, headers=headers, verify=False, timeout=10)
        acao = resp.headers.get("Access-Control-Allow-Origin", "")
        acac = resp.headers.get("Access-Control-Allow-Credentials", "")
        return {
            "origin_sent": origin,
            "acao": acao,
            "acac": acac,
            "reflected": acao == origin,
            "wildcard": acao == "*",
            "credentials": acac.lower() == "true",
            "status": resp.status_code,
        }
    except Exception as e:
        return {"origin_sent": origin, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="CORS misconfiguration checker")
    parser.add_argument("url", help="Target URL to test")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    # Extract domain from URL
    from urllib.parse import urlparse
    parsed = urlparse(args.url)
    domain = parsed.hostname

    test_origins = [
        f"https://evil.com",
        f"https://{domain}.evil.com",
        f"https://evil.{domain}",
        f"https://sub.{domain}",
        f"http://{domain}",  # HTTP downgrade
        f"https://{domain}%60.evil.com",  # Backtick bypass
        f"https://{domain}_.evil.com",  # Underscore bypass
        "null",  # null origin
        f"https://evil.com%0d%0a",  # CRLF
    ]

    results = []
    vulns = []

    print(f"CORS Misconfiguration Check: {args.url}")
    print(f"{'='*70}\n")

    for origin in test_origins:
        result = check_cors(args.url, origin)
        results.append(result)

        if "error" in result:
            print(f"  [ERROR]  {origin} → {result['error']}")
            continue

        is_vuln = False
        reason = ""

        if result["reflected"] and result["credentials"]:
            is_vuln = True
            reason = "Origin reflected + credentials allowed = FULL CORS BYPASS"
        elif result["reflected"]:
            is_vuln = True
            reason = "Origin reflected (no credentials)"
        elif result["wildcard"] and result["credentials"]:
            is_vuln = True
            reason = "Wildcard ACAO with credentials (browser blocks this, but misconfigured)"
        elif result["acao"] == "null" and result["credentials"]:
            is_vuln = True
            reason = "null origin allowed with credentials"

        icon = "[VULN!] " if is_vuln else "[SAFE]  "
        print(f"  {icon} Origin: {origin}")
        print(f"          ACAO: {result['acao'] or '(none)'}, ACAC: {result['acac'] or '(none)'}")
        if is_vuln:
            print(f"          {reason}")
            vulns.append({"origin": origin, "reason": reason, **result})
        print()

    if args.json_output:
        print(json.dumps({"url": args.url, "total_tests": len(results), "vulnerabilities": vulns, "results": results}, indent=2))
    else:
        print(f"{'='*70}")
        print(f"RESULTS: {len(vulns)}/{len(results)} origins accepted (potentially vulnerable)")

if __name__ == "__main__":
    main()
