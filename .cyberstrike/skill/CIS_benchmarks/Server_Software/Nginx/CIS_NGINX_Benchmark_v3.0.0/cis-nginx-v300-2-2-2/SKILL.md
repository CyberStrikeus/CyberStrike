---
name: cis-nginx-v300-2-2-2
description: "Ensure the NGINX service account is locked (Manual)"
category: cis-nginx
version: "3.0"
author: cyberstrike-official
tags: [cis, nginx, web-server, reverse-proxy, account-security, basic-configuration]
cis_id: "2.2.2"
cis_benchmark: "CIS NGINX Benchmark v3.0.0"
tech_stack: [nginx, linux, web-server]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.2.2 — Ensure the NGINX service account is locked

## Profile Applicability
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer

## Description
The NGINX service account must not have a usable password and should be explicitly locked in the system's shadow file to prevent direct login or password-based privilege escalation.

## Rationale
As a defense-in-depth measure, the NGINX service account should be explicitly locked. This prevents password-based logins and blocks adversaries from using the account for lateral movement, even if they manage to change the account's shell configuration.

In a properly hardened environment, there is no operational need for any user to log in as `nginx`. Administrative tasks requiring the NGINX identity should be performed using `sudo` (e.g., `sudo -u nginx`), which utilizes the administrator's credentials rather than the service account's password.

## Impact
Locking the service account has minimal operational impact. The account is not intended for human interaction, and all administrative tasks requiring the NGINX user context should already be performed using `sudo -u nginx` rather than password-based authentication.

## Audit Procedure

**1. Identify the User:**

```bash
nginx -T 2>/dev/null | grep -i "^user"
```

(Note the user, e.g., `nginx`)

**2. Check Lock Status:**

Run the following command for the identified user:

```bash
passwd -S nginx
```

**Evaluation:**

Verify that the output indicates a locked status:

- **RHEL**: Shows `LK` or `Password locked`.
- **Debian/Ubuntu**: Shows `L`.

## Remediation
Lock the account using the `passwd` command:

```bash
passwd -l nginx
```

(Replace `nginx` with the actual service user found in step 1)

## Default Value
System users created by official packages are typically created without a password (locked by default).

## References
1. https://nginx.org/en/docs/ngx_core_module.html#user

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | Y | Y | Y |
| v7 | 14.6 Protect Information through Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1078 - Valid Accounts |

## Profile
- Level 1 - Webserver
- Level 1 - Proxy
- Level 1 - Loadbalancer
