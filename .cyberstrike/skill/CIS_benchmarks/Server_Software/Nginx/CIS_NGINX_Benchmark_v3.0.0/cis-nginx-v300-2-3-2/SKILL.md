---
name: cis-nginx-v300-2-3-2
description: "Ensure access to NGINX directories and files is restricted (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, permissions-ownership, basic-configuration]
cis_id: "2.3.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.3.2 — Ensure access to NGINX directories and files is restricted

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The NGINX configuration directory (`/etc/nginx` or equivalent) and its contents should have restrictive permissions to enforce the principle of least privilege.

- **Directories** should be accessible only by the `root` user and the `root` group (and potentially read/execute by the group), but not by others.
- **Files** should be readable/writable by `root` and readable by the group, but inaccessible to others.

## Rationale
Restrictive file permissions prevent unauthorized users on the system from viewing sensitive configuration details, such as backend IP addresses, routing logic, or loaded module paths. By removing "world" access (permissions for "other"), we ensure that only administrators (via `sudo`) can interact with the web server configuration. This is a fundamental defense against information disclosure.

## Impact
Setting permissions to `640` (files) and `750` (directories) prevents non-privileged users from listing the configuration directory or reading configuration files.

## Audit Procedure

**1. Identify Configuration Directory:**

Run `nginx -V` and identify the `--conf-path` to determine the configuration root (e.g., `/etc/nginx`).

**2. Audit Directory Permissions:**

Run the following command to find directories with loose permissions:

```bash
find /etc/nginx -type d -exec stat -Lc "%n %a" {} +
```

**Evaluation:**

Verify that the output shows permissions of `750` (`drwxr-x---`) or more restrictive (e.g., `700`).

- **Standard:** `755` (`drwxr-xr-x`) allows world read/execute.
- **Hardened Target:** `750` or `700`.

**3. Audit File Permissions:**

Run the following command to find files with loose permissions:

```bash
find /etc/nginx -type f -exec stat -Lc "%n %a" {} +
```

**Evaluation:**

Verify that the output shows permissions of `640` (`-rw-r-----`) or more restrictive (e.g., `600`).

- **Standard:** `644` (`-rw-r--r--`) allows world read.
- **Hardened Target:** `640` or `600`.

## Remediation
To restrict access to the NGINX configuration directory and files, execute the following commands:

**1. Restrict Directories (750):**

Allow owner (`root`) full access, group read/execute, deny others.

```bash
find /etc/nginx -type d -exec chmod 750 {} +
```

**2. Restrict Files (640):**

Allow owner (`root`) read/write, group read, deny others.

```bash
find /etc/nginx -type f -exec chmod 640 {} +
```

**Note:** Private keys (e.g., `.key` files) require even stricter permissions (`400` or `600`) and should be addressed separately or manually verified here.

## Default Value
Default permissions are typically `755` for directories and `644` for files (world-readable).

## Additional Information
**Critical:** If your NGINX setup relies on the worker process (`nginx` user) reading configuration files directly (uncommon for standard configs, but possible with certain includes or SSL certificates not handled by the master process), ensure the `nginx` user is in the group that owns the files, **OR** use `chmod 644` if absolutely necessary. However, the Master Process (`root`) handles parsing, so `640`/`root:root` is usually safe.

## References
1. https://nginx.org/en/docs/ngx_core_module.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | Y | Y | Y |
| v7 | 14.6 Protect Information through Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Persistence | T1222 - File and Directory Permissions Modification |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
