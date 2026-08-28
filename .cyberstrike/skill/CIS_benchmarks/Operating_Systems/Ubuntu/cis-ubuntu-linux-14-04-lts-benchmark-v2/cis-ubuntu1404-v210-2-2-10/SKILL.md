---
name: "CIS Ubuntu 14.04 LTS - 2.2.10 Ensure HTTP server is not enabled"
description: "Verify that Apache HTTP server is disabled when not required"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - services
cis_id: "2.2.10"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.10 Ensure HTTP server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

HTTP or web servers provide the ability to host web site content.

## Rationale

Unless there is a need to run the system as a web server, it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure

Run the following to ensure no start links for `apache2` exist in `/etc/rc*.d`:

```bash
ls /etc/rc*.d/S*apache2
```

No results should be returned.

## Expected Result

No output should be returned, indicating that `apache2` has no start links.

## Remediation

Run the following command to disable `apache2`:

```bash
update-rc.d apache2 disable
```

## Default Value

HTTP server is not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
