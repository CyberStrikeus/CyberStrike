---
name: cis-nginx-v300-2-3-3
description: "Ensure the NGINX process ID (PID) file is secured (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, permissions-ownership, basic-configuration]
cis_id: "2.3.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.3.3 — Ensure the NGINX process ID (PID) file is secured

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

The `PID` file stores the main process ID of the nginx process. This file should be protected from unauthorized modification.

## Rationale

The `PID` file should be owned by `root` and the group `root`. It should also be readable to everyone, but only writable by `root` (permissions `644`). This will prevent unauthorized modification of the `PID` file, which could cause a denial of service.

## Impact

None. The PID file is managed by the master process (`root`). Restricting write access prevents other users from tampering with the file, but read access is generally safe and required for monitoring.

## Audit Procedure

**1. Identify PID File Location:**

Run `nginx -V` and look for the `--pid-path` argument to confirm the location (e.g., `/run/nginx.pid` or `/var/run/nginx.pid`).

**2. Verify Ownership and Permissions:**

Run the following command (substituting the identified path):

```bash
stat -Lc "%U:%G %a" /run/nginx.pid
```

**Evaluation:**

- **Ownership:** Must be `root:root`.
- **Permissions:** Must be `644` (`rw-r--r--`) or more restrictive.

## Remediation

Set the correct ownership and permissions for the `PID` file (replace path as needed):

```bash
chown root:root /run/nginx.pid
chmod 644       /run/nginx.pid
```

## Default Value

The `PID` file is owned by `root` and has permissions `644` by default when building using `dnf` or `apt`.

## References

1. https://nginx.org/en/docs/ngx_core_module.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | Y    | Y    | Y    |
| v7               | 14.6 Protect Information through Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic | Technique                          |
| ------ | ---------------------------------- |
| Impact | T1499 - Endpoint Denial of Service |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
