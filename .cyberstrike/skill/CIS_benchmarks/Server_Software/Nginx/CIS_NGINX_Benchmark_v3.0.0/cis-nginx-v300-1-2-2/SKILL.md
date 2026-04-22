---
name: cis-nginx-v300-1-2-2
description: "Ensure the latest software package is installed (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, software-updates, initial-setup]
cis_id: "1.2.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.2.2 — Ensure the latest software package is installed

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
As new security vulnerabilities are discovered, the corresponding fixes are implemented by your NGINX software package provider. Installing the latest software version ensures these fixes are available on your system.

## Rationale
Up-to-date software provides the best possible protection against exploitation of security vulnerabilities, such as the execution of malicious code.

## Impact
Updating the NGINX package requires a service reload or restart to apply the changes. This may cause a brief interruption or configuration errors if the new version deprecates existing syntax.

## Audit Procedure

To verify your NGINX package is up to date, run the following command (example):

**Redhat:**

```bash
dnf info nginx
```

## Remediation
To install the latest NGINX package, run the following command (example):

**Redhat:**

```bash
dnf update nginx -y
```

## Default Value
Not applicable. The installed version depends on the configured repository and when the last update was performed.

## References
1. https://nginx.org/en/linux_packages.html

## Additional Information
Package update and installation commands are based on Red Hat Enterprise Linux 9. If using a different Linux distribution, please substitute with the appropriate command(s) and consider your organization patch management policy.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 7.3 Perform Automated Operating System Patch Management | Y | Y | Y |
| v8 | 7.4 Perform Automated Application Patch Management | Y | Y | Y |
| v7 | 3.4 Deploy Automated Operating System Patch Management Tools | Y | Y | Y |
| v7 | 3.5 Deploy Automated Software Patch Management Tools | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
