---
name: cis-nginx-v300-1-2-1
description: "Ensure package manager repositories are properly configured (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, software-updates, initial-setup]
cis_id: "1.2.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.2.1 — Ensure package manager repositories are properly configured

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

Package repositories must be trustworthy, properly configured, and maintained to ensure the system receives timely security patches, bug fixes, and support for modern protocols. While Operating System (OS) vendors provide NGINX packages, these versions are often frozen at older release points ("stable" but stale). Access to critical modern features like HTTP/3 (QUIC) and the latest TLS updates typically requires using the official repositories maintained by NGINX/F5.

## Rationale

If a system's package manager repositories are misconfigured or outdated, critical security patches may not be applied in a timely manner. Furthermore, relying solely on default OS repositories often restricts the web server to legacy versions that lack support for modern security standards (e.g., HTTP/3). Using the official nginx.org repositories ensures access to the latest stable and mainline versions directly from the source, reducing the risk of running obsolete software. Conversely, adding untrusted third-party repositories can introduce compromised software or dependency conflicts.

## Impact

Switching from OS-provided packages to upstream (nginx.org) packages alters the update lifecycle. Administrators become responsible for tracking upstream changes rather than relying on the OS vendor's backporting policy. However, this is often necessary to meet modern security and performance requirements.

## Audit Procedure

To verify that package manager repositories are configured correctly and point to a trusted source (either the OS vendor or official NGINX), run the following commands:

**Red Hat / Rocky-Linux:**

```bash
dnf repolist -v | grep -i nginx
```

**Debian / Ubuntu:**

```bash
apt-cache policy nginx
```

**Evaluation:**

- Verify that the repository URL points to a trusted domain (e.g., nginx.org, rhel..., ubuntu...).
- Ensure that the repository is enabled.
- Check that no unknown or untrusted third-party repositories are configured for NGINX.

## Remediation

Configure your package manager to use a trusted repository that meets your version requirements.

To enable the official NGINX repository (Recommended for HTTP/3 support): Follow the instructions at nginx.org/en/linux_packages.html for your specific distribution. This typically involves adding the NGINX signing key and creating a repository configuration file.

## Default Value

By default, systems are configured with the OS vendor's repositories, which typically contain older versions of NGINX and not always all needed features.

## References

1. https://nginx.org/en/linux_packages.html

## Additional Information

Package update and installation commands and repository structures vary by Linux distribution. The examples provided are based on Red Hat Enterprise Linux 9. Please substitute with the appropriate commands for your environment. Note that HTTP/3 (QUIC) support was introduced in NGINX 1.25.0 (Mainline) and is not available in many OS-bundled versions.

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 7.3 Perform Automated Operating System Patch Management      | Y    | Y    | Y    |
| v8               | 7.4 Perform Automated Application Patch Management           | Y    | Y    | Y    |
| v7               | 3.4 Deploy Automated Operating System Patch Management Tools | Y    | Y    | Y    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools         | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                                 |
| -------------- | ----------------------------------------- |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
