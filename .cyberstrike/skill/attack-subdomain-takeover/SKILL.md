---
name: attack-subdomain-takeover
description: "Subdomain takeover — CNAME detection, cloud service fingerprinting, dangling DNS exploitation"
category: "web-application"
version: "1.0"
author: "cyberstrike-official"
tags:
  - subdomain-takeover
  - dns
  - cloud
  - web
  - attack
tech_stack:
  - aws
  - azure
  - gcp
  - web
cwe_ids:
  - CWE-284
chains_with: []
prerequisites: []
severity_boost: {}
---

# Subdomain Takeover

## Objective

Identify subdomains with dangling DNS records (CNAME pointing to unclaimed cloud resources) and claim them to serve attacker content.

## Testing Methodology

### Phase 1: Subdomain Enumeration

```bash
# Passive enumeration
subfinder -d TARGET.com -silent | tee subdomains.txt

# Certificate transparency
curl -s "https://crt.sh/?q=%25.TARGET.com&output=json" | jq -r '.[].name_value' | sort -u >> subdomains.txt

# DNS brute force
puredns bruteforce wordlist.txt TARGET.com -r resolvers.txt >> subdomains.txt
```

### Phase 2: Automated Takeover Check

```bash
# Check all subdomains for takeover
attack_script subdomain_takeover subdomains.txt --json-output
```

Checks 20 cloud services:
- GitHub Pages, Heroku, Shopify, Tumblr, WordPress
- AWS S3, AWS Elastic Beanstalk, Azure Web Apps
- Netlify, Vercel, Fastly, Fly.io
- Bitbucket, Surge, Ghost, Pantheon
- Zendesk, README.io, Cargo, Feedpress

### Phase 3: Manual CNAME Verification

```bash
# Check CNAME records
dig +short CNAME subdomain.TARGET.com

# Verify the pointed service is unclaimed
curl -s https://subdomain.TARGET.com
# Look for: "There isn't a GitHub Pages site here"
# "No such app" (Heroku)
# "NoSuchBucket" (S3)
```

### Phase 4: Cloud Storage Enumeration

```bash
# Check related cloud buckets
attack_script cloud_storage_enum TARGET --json-output
```

### Phase 5: Claim & Verify

After confirming a dangling CNAME:
1. Create the resource on the target service (e.g., GitHub Pages repo, S3 bucket)
2. Serve a harmless proof page (e.g., `cyberstrike-takeover-proof.html`)
3. Verify it's accessible at `subdomain.TARGET.com`

## What Constitutes a Finding

| Finding | Severity |
|---------|----------|
| Subdomain takeover — attacker controls content | High (P2) |
| S3 bucket public write access | Critical (P1) |
| S3 bucket listing enabled | High (P2) |
| Dangling CNAME (service unreachable) | Medium (P3) |
| Cloud storage public read | Medium (P3) |

## Evidence Requirements

- Subdomain with dangling CNAME record
- Target cloud service identified
- Service fingerprint (error message)
- For takeover: proof of content hosting on subdomain
- For buckets: listing output or write proof

## Tools

- `attack_script subdomain_takeover` — automated CNAME + fingerprint checker
- `attack_script cloud_storage_enum` — S3/Azure/GCP enumeration
- `subfinder`, `puredns` — subdomain enumeration

## References

- [Can I Take Over XYZ](https://github.com/EdOverflow/can-i-take-over-xyz)
- [HackerOne: Subdomain Takeover](https://www.hackerone.com/vulnerability-management/guide-subdomain-takeovers)
