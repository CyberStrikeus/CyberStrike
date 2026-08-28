---
name: cis-ubuntu2004-v300-5-1-11
description: "Ensure sshd IgnoreRhosts is enabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.11"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd IgnoreRhosts is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `IgnoreRhosts` parameter specifies that `.rhosts` and `.shosts` files will not be used in `RhostsRSAAuthentication` or `HostbasedAuthentication`.

## Rationale

Setting this parameter forces users to enter a password when authenticating with SSH.

## Audit Procedure

### Command Line

Run the following command to verify `IgnoreRhosts` is set to `yes`:

```bash
# sshd -T | grep ignorerhosts
```

```
ignorerhosts yes
```

## Expected Result

```
ignorerhosts yes
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `IgnoreRhosts` parameter to `yes` above any `Include` entry as follows:

```
IgnoreRhosts yes
```

Note: First occurrence of a option takes precedence. If `Include` locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in `Include` location.

## Default Value

IgnoreRhosts yes

## References

1. SSHD_CONFIG(5)
2. SSHD(8)
3. NIST SP 800-53 Rev. 5: CM-1,CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 5.2 Use Unique Passwords
Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA.

v7 - 4.4 Use Unique Passwords
Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.003 | TA0001 | M1027
