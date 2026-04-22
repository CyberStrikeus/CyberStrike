---
name: cis-ubuntu2004-v300-5-1-9
description: "Ensure sshd GSSAPIAuthentication is disabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd GSSAPIAuthentication is disabled (Automated)

## Profile Applicability

- Level 1 - Workstation
- Level 2 - Server

## Description

The `GSSAPIAuthentication` parameter specifies whether user authentication based on GSSAPI is allowed.

## Rationale

Allowing GSSAPI authentication through SSH exposes the system's GSSAPI to remote hosts, and should be disabled to reduce the attack surface of the system.

## Audit Procedure

### Command Line

Run the following command to verify `GSSAPIAuthentication` is set to `no`:

```bash
# sshd -T | grep gssapiauthentication
```

```
gssapiauthentication no
```

- IF - `Match` set statements are used in your environment, specify the connection parameters to use for the `-T` extended test mode and run the audit to verify the setting is not incorrectly configured in a match block.
  Example additional audit needed for a match block for the user _sshuser_:

```bash
# sshd -T -C user=sshuser | grep gssapiauthentication
```

Note: If provided, any Match directives in the configuration file that would apply are applied before the configuration is written to standard output. The connection parameters are supplied as keyword=value pairs and may be supplied in any order, either with multiple `-C` options or as a comma-separated list. The keywords are `addr` (source address), `user` (user), `host` (resolved source host name), `laddr` (local address), `lport` (local port number), and `rdomain` (routing domain)

## Expected Result

```
gssapiauthentication no
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `GSSAPIAuthentication` parameter to `no` above any `Include` and `Match` entries as follows:

```
GSSAPIAuthentication no
```

Note: First occurrence of an option takes precedence, `Match` set statements withstanding. If `Include` locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in `Include` location.

## Default Value

GSSAPIAuthentication no

## References

1. SSHD_CONFIG(5)
2. SSHD(8)
3. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 5.2 Use Unique Passwords
Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA.

v7 - 4.4 Use Unique Passwords
Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.003 | TA0001 | M1042
