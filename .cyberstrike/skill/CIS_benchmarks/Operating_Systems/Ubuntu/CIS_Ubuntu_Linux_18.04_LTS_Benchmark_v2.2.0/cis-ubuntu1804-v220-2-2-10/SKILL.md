---
name: cis-ubuntu1804-v220-2-2-10
description: "Ensure IMAP and POP3 server are not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, imap-pop3]
cis_id: "2.2.10"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.10 Ensure IMAP and POP3 server are not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`dovecot-imapd` and `dovecot-pop3d` are an open source IMAP and POP3 server for Linux based systems.

## Rationale

Unless POP3 and/or IMAP servers are to be provided by this system, it is recommended that the package be removed to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify `dovecot-imapd` is not installed:

```bash
# dpkg-query -s dovecot-imapd &>/dev/null && echo "dovecot-imapd is installed"
```

Nothing should be returned.

Run the following command to verify `dovecot-pop3d` is not installed:

```bash
# dpkg-query -s dovecot-pop3d &>/dev/null && echo "dovecot-pop3d is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result) for both commands.

## Remediation

### Command Line

Run one of the following commands to remove `dovecot-imapd` and `dovecot-pop3d`:

```bash
# apt purge dovecot-imapd dovecot-pop3d
```

## References

1. NIST SP 800-53 Rev. 5: CM-7

Additional Information:

Several IMAP/POP3 servers exist and can use other service names. `courier-imap` and `cyrus-imap` are example services that provide a mail server. These and other services should also be audited.

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
