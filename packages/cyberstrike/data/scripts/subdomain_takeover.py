#!/usr/bin/env python3
"""Subdomain takeover checker — CNAME detection + cloud service verification."""
import argparse
import subprocess
import json
import sys
import requests
import urllib3
urllib3.disable_warnings()

TAKEOVER_SIGNATURES = {
    "github": {"cname": ["github.io", "github.com"], "fingerprint": "There isn't a GitHub Pages site here"},
    "heroku": {"cname": ["herokuapp.com", "herokussl.com"], "fingerprint": "No such app"},
    "shopify": {"cname": ["myshopify.com"], "fingerprint": "Sorry, this shop is currently unavailable"},
    "tumblr": {"cname": ["tumblr.com"], "fingerprint": "There's nothing here"},
    "wordpress": {"cname": ["wordpress.com"], "fingerprint": "Do you want to register"},
    "aws_s3": {"cname": ["s3.amazonaws.com", "s3-website"], "fingerprint": "NoSuchBucket"},
    "aws_eb": {"cname": ["elasticbeanstalk.com"], "fingerprint": "NXDOMAIN"},
    "azure": {"cname": ["azurewebsites.net", "cloudapp.azure.com", "trafficmanager.net", "blob.core.windows.net"], "fingerprint": "404 Web Site not found"},
    "bitbucket": {"cname": ["bitbucket.io"], "fingerprint": "Repository not found"},
    "surge": {"cname": ["surge.sh"], "fingerprint": "project not found"},
    "feedpress": {"cname": ["redirect.feedpress.me"], "fingerprint": "The feed has not been found"},
    "ghost": {"cname": ["ghost.io"], "fingerprint": "The thing you were looking for is no longer here"},
    "netlify": {"cname": ["netlify.app", "netlify.com"], "fingerprint": "Not Found - Request ID"},
    "pantheon": {"cname": ["pantheonsite.io"], "fingerprint": "404 error unknown site"},
    "fastly": {"cname": ["fastly.net"], "fingerprint": "Fastly error: unknown domain"},
    "zendesk": {"cname": ["zendesk.com"], "fingerprint": "Help Center Closed"},
    "readme": {"cname": ["readme.io"], "fingerprint": "Project doesnt exist"},
    "cargo": {"cname": ["cargocollective.com"], "fingerprint": "If you're moving your domain away"},
    "fly": {"cname": ["fly.dev"], "fingerprint": "404 Not Found"},
    "vercel": {"cname": ["vercel.app", "now.sh"], "fingerprint": "The deployment could not be found"},
}

def get_cname(domain):
    try:
        result = subprocess.run(["dig", "+short", "CNAME", domain], capture_output=True, text=True, timeout=10)
        cname = result.stdout.strip().rstrip(".")
        return cname if cname else None
    except:
        return None

def check_takeover(domain, cname):
    for service, config in TAKEOVER_SIGNATURES.items():
        if any(c in cname.lower() for c in config["cname"]):
            try:
                resp = requests.get(f"https://{domain}", verify=False, timeout=10,
                    headers={"User-Agent": "Mozilla/5.0"})
                if config["fingerprint"].lower() in resp.text.lower():
                    return {"service": service, "vulnerable": True, "fingerprint": config["fingerprint"]}
                return {"service": service, "vulnerable": False, "note": f"CNAME matches but fingerprint not found"}
            except requests.exceptions.ConnectionError:
                return {"service": service, "vulnerable": True, "note": "Connection refused — likely takeover candidate"}
            except:
                return {"service": service, "vulnerable": False, "note": "Could not verify"}
    return {"service": "unknown", "vulnerable": False, "note": f"CNAME {cname} doesn't match known services"}

def main():
    parser = argparse.ArgumentParser(description="Subdomain takeover checker")
    parser.add_argument("input", help="File with subdomains (one per line) or single domain")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    try:
        with open(args.input) as f:
            domains = [l.strip() for l in f if l.strip()]
    except FileNotFoundError:
        domains = [args.input]

    results = []
    print(f"\nSubdomain Takeover Check: {len(domains)} domains")
    print(f"{'='*60}\n")

    for domain in domains:
        cname = get_cname(domain)
        if not cname:
            continue

        result = check_takeover(domain, cname)
        result["domain"] = domain
        result["cname"] = cname
        results.append(result)

        icon = "[TAKEOVER!]" if result["vulnerable"] else "[SAFE]     "
        print(f"  {icon} {domain}")
        print(f"            CNAME: {cname} → {result['service']}")
        if result["vulnerable"]:
            print(f"            {result.get('fingerprint', result.get('note', ''))}")

    vulns = [r for r in results if r["vulnerable"]]
    print(f"\n{'='*60}")
    print(f"Results: {len(vulns)} vulnerable / {len(results)} with CNAME / {len(domains)} total")

    if args.json_output:
        print(json.dumps({"total": len(domains), "with_cname": len(results), "vulnerable": vulns}, indent=2))

if __name__ == "__main__":
    main()
