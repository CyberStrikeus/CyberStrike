---
name: cis-nginx-v300-2-3-1
description: "Ensure NGINX directories and files are owned by root (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, permissions-ownership, basic-configuration]
cis_id: "2.3.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.3.1 — Ensure NGINX directories and files are owned by root

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

The NGINX configuration directory and all contained files must be owned by the `root` user and group to prevent unauthorized modification.

## Rationale

The NGINX configuration **controls** the security posture of the web server. If a non-privileged user (including the `nginx` worker user) can modify these files, they can trivially escalate privileges (e.g., by loading a malicious module or changing the `user` directive to `root`). Ensuring that **only root owns** these files guarantees that configuration changes require administrative privileges.

## Impact

None. The NGINX master process runs as `root` and can read these files. The worker processes (running as `nginx`) do not need write access to the configuration.

## Audit Procedure

**1. Identify Configuration Directory:**

Run `nginx -V` and look for `--conf-path` to find the main configuration file location (e.g., `/etc/nginx/nginx.conf`). The directory containing this file is the target.

**2. Verify Ownership:**

Run the following command to audit the ownership of the configuration directory and its contents:

```bash
find /etc/nginx -name "*" \( -not -user root -o -not -group root \) -exec ls -ld {} \;
```

(Replace `/etc/nginx` with the actual configuration path in case it is different)

**Evaluation:**

- **PASS:** The command produces no output. All files are owned by `root:root`.
- **FAIL:** The command lists files owned by other users (e.g., `nginx` or a developer account).

## Remediation

Set the ownership of the NGINX configuration directory and files to `root`:

```bash
chown -R root:root /etc/nginx
```

(Replace `/etc/nginx` with the actual configuration path in case it is different)

**Note:** Ensure that this does not break access to specific files if you have a custom setup where external processes need write access.

## Default Value

The default ownership and group for nginx is `root`.

## References

1. https://nginx.org/en/docs/ngx_core_module.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | Y    | Y    | Y    |
| v7               | 14.6 Protect Information through Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic      | Technique                                           |
| ----------- | --------------------------------------------------- |
| Persistence | T1222 - File and Directory Permissions Modification |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
