---
name: cis-ubuntu2004-v300-5-1-17
description: "Ensure sshd MaxSessions is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.17"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd MaxSessions is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `MaxSessions` parameter specifies the maximum number of open sessions permitted from a given connection.

## Rationale

To protect a system from denial of service due to a large number of concurrent sessions, use the rate limiting function of MaxSessions to protect availability of sshd logins and prevent overwhelming the daemon.

## Audit Procedure

### Command Line

Run the following command and verify that `MaxSessions` is `10` or less:

```bash
# sshd -T | grep maxsessions
```

```
maxsessions 10
```

Run the following command and verify the output:

```bash
grep -Psi -- '^\h*MaxSessions\h+\"?([1[1-9]|[2-9][0-9]|[1-9][0-9][0-9]+)\b' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf
```

Nothing should be returned.

- IF - `Match` set statements are used in your environment, specify the connection parameters to use for the `-T` extended test mode and run the audit to verify the setting is not incorrectly configured in a match block.
  Example additional audit needed for a match block for the user _sshuser_:

```bash
# sshd -T -C user=sshuser | grep maxsessions
```

Note: If provided, any Match directives in the configuration file that would apply are applied before the configuration is written to standard output. The connection parameters are supplied as keyword=value pairs and may be supplied in any order, either with multiple `-C` options or as a comma-separated list. The keywords are `addr` (source address), `user` (user), `host` (resolved source host name), `laddr` (local address), `lport` (local port number), and `rdomain` (routing domain)

## Expected Result

```
maxsessions 10
```

(or a value of 10 or less)

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `MaxSessions` parameter to `10` or less above any `Include` and `Match` entries as follows:

```
MaxSessions 10
```

Note: First occurrence of an option takes precedence, `Match` set statements withstanding. If `Include` locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in `Include` location.

## Default Value

MaxSessions 10

## References

1. SSHD_CONFIG(5)
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 0.0 Explicitly Not Mapped

v7 - 0.0 Explicitly Not Mapped

MITRE ATT&CK Mappings: T1499, T1499.002 | TA0040
