---
name: cis-nginx-v300-2-2-3
description: "Ensure the NGINX service account has an invalid shell (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, account-security, basic-configuration]
cis_id: "2.2.3"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.2.3 — Ensure the NGINX service account has an invalid shell

## Profile Applicability

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description

The NGINX service account must be configured with an invalid login shell to prevent interactive access.

## Rationale

The NGINX service account is strictly for running daemon processes. Assigning it a valid login shell (like `/bin/bash`) unnecessarily expands the attack surface. If an attacker compromises the account credentials (or adds an SSH key), a valid shell facilitates interactive system access. Setting the shell to `/sbin/nologin` or `/bin/false` ensures that even with valid credentials, the system immediately rejects a login attempt.

## Impact

None. Service accounts do not require interactive login capabilities for normal operation.

## Audit Procedure

**1. Identify the User:**

```bash
nginx -T 2>/dev/null | grep -i "^user"
```

(Note the user, e.g., `nginx`)

**2. Verify Shell:**

Run the following command to inspect the configured shell for the identified user:

```bash
getent passwd nginx
```

(Replace `nginx` with the actual user found in step 1)

**Evaluation:**

Examine the last field of the output (the shell).

- **PASS:** The shell is set to `/sbin/nologin`, `/bin/nologin`, or `/bin/false`.
- **FAIL:** The shell is set to `/bin/bash`, `/bin/sh`, or any other interactive shell listed in `/etc/shells`.

**Example Output (PASS):**

```
nginx:x:999:988:nginx user:/nonexistent:/usr/sbin/nologin
```

## Remediation

Change the login shell for the identified user to `/sbin/nologin`:

```bash
usermod -s /sbin/nologin nginx
```

(Replace `nginx` with the actual user)

## Default Value

Official packages typically configure the user with `/sbin/nologin` or `/bin/false` by default.

## References

1. https://nginx.org/en/docs/ngx_core_module.html#user

## CIS Controls

| Controls Version | Control                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.1 Establish and Maintain a Secure Configuration Process | Y    | Y    | Y    |
| v7               | 5.1 Establish Secure Configurations                       | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique              |
| -------------------- | ---------------------- |
| Privilege Escalation | T1078 - Valid Accounts |

## Profile

- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
