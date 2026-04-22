---
name: cis-nginx-v300-1-1-1
description: "Ensure NGINX is installed (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, installation, initial-setup]
cis_id: "1.1.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.1.1 — Ensure NGINX is installed

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

An NGINX installation must be present on the system. To ensure support for modern security standards (such as TLS 1.3 and HTTP/3) and to mitigate known vulnerabilities, the installed version must be `1.28.0` or later and compiled with the necessary modules.

## Rationale

NGINX must be installed and operational to serve as the target for this benchmark's security controls. Enforcing a minimum version and feature set ensures the platform is capable of supporting the required security configurations.

## Impact

Upgrading NGINX to a newer version may introduce configuration syntax changes or deprecated directives. Administrators should test the configuration syntax `nginx -t` before restarting the service.

## Audit Procedure

**1. Verify Installation and Version:** Run the following command to display the installed NGINX version:

```bash
# Note: It's an uppercase V
nginx -V
```

**2. Evaluation:**

- **Verify Output:** The command must return an installed version (e.g., `nginx version: nginx/1.28.0`). If the command is not found, NGINX is not installed.
- **Check Version:** Ensure the version number is 1.28.0 or higher.

## Remediation

Install or upgrade NGINX to version `1.28.0` or later.

**Note:** Official packages from nginx.org (see recommendation 1.2.1) typically include these modules by default. Custom builds must explicitly enable them.

## Default Value

NGINX is not installed by default.

## References

1. https://nginx.org/en/docs/install.html
2. https://nginx.org/en/linux_packages.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.2 Ensure Authorized Software is Currently Supported | Y    | Y    | Y    |
| v7               | 2.2 Ensure Software is Supported by Vendor            | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                                 |
| -------------- | ----------------------------------------- |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
