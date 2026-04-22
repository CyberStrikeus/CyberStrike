---
name: cis-nginx-v300-2-2-1
description: "Ensure that NGINX is run using a non-privileged, dedicated service account (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, account-security, basic-configuration]
cis_id: "2.2.1"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.2.1 — Ensure that NGINX is run using a non-privileged, dedicated service account

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

The NGINX master process typically runs as `root` to bind to privileged ports and manage resources, but it spawns worker processes to handle the actual client traffic. The `user` directive in the main configuration designates the operating system account under which these worker processes run.

Running worker processes under a non-privileged, dedicated service account limits the damage an attacker can cause in the event the NGINX process is compromised. This account should be exclusively dedicated to NGINX, have no login capabilities, and possess no elevated system privileges.

## Rationale

If an attacker successfully exploits a vulnerability in a worker process (e.g., via a buffer overflow or Remote Code Execution), they inherit the permissions of the user account running that process. Using a privileged account like `root` significantly increases the risk of lateral movement. A dedicated, locked-down service account ensures that an attacker cannot access other services, modify sensitive system files, or easily escalate privileges, effectively reducing the impact of the compromise.

## Impact

Changing the NGINX user requires that ownership and permissions for all runtime directories (logs, caches, PID files) are updated to match the new account. Incorrect permissions will prevent NGINX from starting or writing necessary logs. Additionally, the dedicated user must remain strictly unprivileged; adding it to groups like `sudo` or `wheel` would negate the security benefit.

## Audit Procedure

**1. Identify Configured User:**

Inspect the running configuration to find the user directive:

```bash
nginx -T 2>/dev/null | grep -i "^user"
```

**Evaluation:** Verify that a specific user is defined (e.g., `user nginx;` or `user www-data;`). If missing, NGINX might run as `nobody` or the user used at compile time.

**2. Verify User Privileges:**

Check the UID and group membership of the identified user (e.g., `nginx`):

```bash
id nginx
```

**Evaluation:**

- Ensure **uid is not 0** (root).
- Ensure the user **is not** a member of privileged groups (like `root`, `wheel`, `sudo`).

**3. Check Sudo Access:**

Ensure the user cannot execute commands via `sudo`:

```bash
sudo -l -U nginx
```

**Evaluation:** Output should indicate "User nginx is not allowed to run sudo".

## Remediation

**1. Create/Harden User (if missing):**

If no user exists, create a system user with a no login shell:

```bash
useradd -r -d /var/cache/nginx -s /sbin/nologin nginx
```

**2. Configure NGINX:**

Set the user directive in the main context of `nginx.conf`:

```nginx
user nginx;
```

**3. Lock User Account:**

Ensure the account cannot be used for login:

```bash
usermod -s /sbin/nologin nginx
usermod -L nginx
```

## Default Value

Official packages usually create and configure a dedicated user (e.g., `nginx` or `www-data`). If compiled from source without arguments, the user defaults to `nobody`.

## References

1. https://nginx.org/en/docs/ngx_core_module.html#user

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts | Y    | Y    | Y    |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts                   | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique              |
| -------------------- | ---------------------- |
| Privilege Escalation | T1078 - Valid Accounts |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
