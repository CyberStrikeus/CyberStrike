---
name: cis-ubuntu2004-v300-6-2-2-1-4
description: "Ensure systemd-journal-remote service is not in use"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.2.1.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2.1.4 Ensure systemd-journal-remote service is not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Journald `systemd-journal-remote` supports the ability to receive messages from remote hosts, thus acting as a log server. Clients should not receive data from other hosts.

Note:

- The same package, `systemd-journal-remote`, is used for both sending logs to remote hosts and receiving incoming logs.
- With regards to receiving logs, there are two services; `systemd-journal-remote.socket` and `systemd-journal-remote.service`.

## Rationale

If a client is configured to also receive data, thus turning it into a server, the client system is acting outside it's operational boundary.

Note: This recommendation only applies if `journald` is the chosen method for client side logging. Do not apply this recommendation if `rsyslog` is used.

## Audit Procedure

### Command Line

Run the following command to verify `systemd-journal-remote.socket` and `systemd-journal-remote.service` are not enabled:

```bash
# systemctl is-enabled systemd-journal-remote.socket systemd-journal-remote.service | grep -P -- '^enabled'
```

Nothing should be returned.

Run the following command to verify `systemd-journal-remote.socket` and `systemd-journal-remote.service` are not active:

```bash
# systemctl is-active systemd-journal-remote.socket systemd-journal-remote.service | grep -P -- '^active'
```

## Expected Result

Nothing should be returned for either command.

## Remediation

### Command Line

Run the following commands to stop and mask `systemd-journal-remote.socket` and systemd-journal-remote.service:

```bash
# systemctl stop systemd-journal-remote.socket systemd-journal-remote.service
# systemctl mask systemd-journal-remote.socket systemd-journal-remote.service
```

## Default Value

Not enabled or active by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-7 AU-12

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      |      |      |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.006 | TA0040  | M1029       |
