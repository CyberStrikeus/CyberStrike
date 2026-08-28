---
name: cis-ubuntu1604-v200-1-8-4
description: "Ensure XDCMP is not enabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, xdmcp, gdm, gnome, remote-display, display-manager]
cis_id: "1.8.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.8.4

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

Nothing should be returned.

## Expected Result

No output should be returned, indicating XDMCP is not enabled.

## Remediation

### Command Line

Edit the file `/etc/gdm3/custom.conf` and remove the line:

```
Enable=true
```

## Default Value

false (This is denoted by no Enabled= entry in the file `/etc/gdm3/custom.conf` in the [xdmcp] section)

## References

None.

## CIS Controls

| Controls Version | Control                                                            |
| ---------------- | ------------------------------------------------------------------ |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |

## Assessment Status

Automated
