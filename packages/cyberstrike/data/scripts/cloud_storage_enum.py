#!/usr/bin/env python3
"""Cloud storage enumeration — S3/Azure/GCP bucket discovery + permission check."""
import argparse
import requests
import json
import sys
import urllib3
urllib3.disable_warnings()

def check_s3(name):
    """Check AWS S3 bucket existence and permissions."""
    urls = [
        f"https://{name}.s3.amazonaws.com",
        f"https://s3.amazonaws.com/{name}",
    ]
    results = []
    for url in urls:
        try:
            resp = requests.get(url, timeout=10, verify=False)
            if resp.status_code == 200:
                results.append({"url": url, "status": "PUBLIC_READ", "severity": "HIGH"})
            elif resp.status_code == 403:
                results.append({"url": url, "status": "EXISTS_NO_ACCESS", "severity": "INFO"})
                # Try listing
                resp2 = requests.get(url + "?list-type=2&max-keys=5", timeout=10, verify=False)
                if resp2.status_code == 200 and "<Contents>" in resp2.text:
                    results.append({"url": url, "status": "LISTING_ENABLED", "severity": "HIGH", "preview": resp2.text[:500]})
            elif resp.status_code == 404 or "NoSuchBucket" in resp.text:
                results.append({"url": url, "status": "NOT_FOUND", "severity": "NONE"})
            # Try upload
            try:
                put_resp = requests.put(url + "/cyberstrike_test.txt", data="test", timeout=10, verify=False)
                if put_resp.status_code in [200, 201]:
                    results.append({"url": url, "status": "PUBLIC_WRITE", "severity": "CRITICAL"})
                    requests.delete(url + "/cyberstrike_test.txt", timeout=5, verify=False)
            except:
                pass
        except:
            pass
    return results

def check_azure(name):
    """Check Azure Blob Storage."""
    url = f"https://{name}.blob.core.windows.net/?comp=list"
    try:
        resp = requests.get(url, timeout=10, verify=False)
        if resp.status_code == 200 and "<Containers>" in resp.text:
            return [{"url": url, "status": "LISTING_ENABLED", "severity": "HIGH", "preview": resp.text[:500]}]
        elif resp.status_code == 403:
            return [{"url": url, "status": "EXISTS_NO_ACCESS", "severity": "INFO"}]
        return []
    except:
        return []

def check_gcp(name):
    """Check Google Cloud Storage."""
    url = f"https://storage.googleapis.com/{name}"
    try:
        resp = requests.get(url, timeout=10, verify=False)
        if resp.status_code == 200:
            return [{"url": url, "status": "PUBLIC_READ", "severity": "HIGH"}]
        elif resp.status_code == 403:
            return [{"url": url, "status": "EXISTS_NO_ACCESS", "severity": "INFO"}]
        return []
    except:
        return []

def generate_names(target):
    """Generate common bucket name patterns."""
    base = target.replace(".", "-").replace(" ", "-").lower()
    return [
        base, f"{base}-dev", f"{base}-staging", f"{base}-prod", f"{base}-backup",
        f"{base}-assets", f"{base}-static", f"{base}-media", f"{base}-uploads",
        f"{base}-data", f"{base}-logs", f"{base}-internal", f"{base}-private",
        f"{base}-public", f"{base}-cdn", f"{base}-web", f"{base}-app",
        f"{base}-api", f"{base}-db", f"{base}-config", f"{base}-test",
        f"dev-{base}", f"staging-{base}", f"prod-{base}", f"backup-{base}",
    ]

def main():
    parser = argparse.ArgumentParser(description="Cloud storage enumeration")
    parser.add_argument("target", help="Target name or domain")
    parser.add_argument("--names", nargs="+", default=None, help="Custom bucket names to check")
    parser.add_argument("--json-output", action="store_true")
    args = parser.parse_args()

    names = args.names or generate_names(args.target)
    all_results = []

    print(f"\nCloud Storage Enumeration: {args.target}")
    print(f"Checking {len(names)} bucket name variants")
    print(f"{'='*60}\n")

    for name in names:
        for provider, check_fn in [("S3", check_s3), ("Azure", check_azure), ("GCP", check_gcp)]:
            results = check_fn(name)
            for r in results:
                r["name"] = name
                r["provider"] = provider
                all_results.append(r)
                if r["severity"] in ["HIGH", "CRITICAL"]:
                    print(f"  [{r['severity']}] {provider}: {name} → {r['status']}")
                    print(f"          URL: {r['url']}")

    vulns = [r for r in all_results if r["severity"] in ["HIGH", "CRITICAL"]]
    print(f"\n{'='*60}")
    print(f"Results: {len(vulns)} vulnerable / {len(all_results)} checked")

    if args.json_output:
        print(json.dumps({"target": args.target, "vulnerabilities": vulns, "all_results": all_results}, indent=2))

if __name__ == "__main__":
    main()
