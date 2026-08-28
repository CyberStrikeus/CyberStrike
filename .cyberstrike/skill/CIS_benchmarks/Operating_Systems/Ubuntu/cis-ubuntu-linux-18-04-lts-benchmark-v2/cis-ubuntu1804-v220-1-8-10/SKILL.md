---
name: cis-ubuntu1804-v220-1-8-10
description: "Ensure XDCMP is not enabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, gdm, gnome, xdmcp, xdcmp, remote-display]
cis_id: "1.8.10"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.8.10 Ensure XDCMP is not enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

X Display Manager Control Protocol (XDMCP) is designed to provide authenticated access to display management services for remote displays.

## Rationale

XDMCP is inherently insecure.

- XDMCP is not a ciphered protocol. This may allow an attacker to capture keystrokes entered by a user.
- XDMCP is vulnerable to man-in-the-middle attacks. This may allow an attacker to steal the credentials of legitimate users by impersonating the XDMCP server.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
grep -Eis '^\s*Enable\s*=\s*true' /etc/gdm3/custom.conf
```

## Expected Result

Nothing should be returned.

## Remediation

### Command Line

Edit the file `/etc/gdm3/custom.conf` and remove the line:

```
Enable=true
```

## Default Value

false (This is denoted by no Enabled= entry in the file `/etc/gdm3/custom.conf` in the [xdmcp] section)

## References

1. NIST SP 800-53 Rev. 5: SI-4
