---
name: cis-ubuntu2004-v300-2-1-8
description: "Ensure message access server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.8 Ensure message access server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

dovecot-imapd and dovecot-pop3d are an open source IMAP and POP3 server for Linux based systems.

## Rationale

Unless POP3 and/or IMAP servers are to be provided by this system, it is recommended that the services be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify dovecot-imapd and dovecot-pop3d are not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' dovecot-imapd dovecot-pop3d
```

If installed, run:

```bash
# systemctl is-enabled dovecot.socket dovecot.service
# systemctl is-active dovecot.socket dovecot.service
```

Verify the services are not enabled and not active.

## Expected Result

dovecot-imapd and dovecot-pop3d should not be installed, or if installed, the services should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge dovecot:

```bash
# systemctl stop dovecot.socket dovecot.service
# systemctl mask dovecot.socket dovecot.service
# apt purge dovecot-imapd dovecot-pop3d
```

## Default Value

dovecot-imapd and dovecot-pop3d are not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
