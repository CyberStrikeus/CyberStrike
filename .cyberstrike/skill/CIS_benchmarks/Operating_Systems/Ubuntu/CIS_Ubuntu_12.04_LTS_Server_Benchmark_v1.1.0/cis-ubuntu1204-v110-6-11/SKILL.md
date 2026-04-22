---
name: cis-ubuntu1204-v110-6-11
description: "Ensure IMAP and POP server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, imap, pop, dovecot, mail, attack-surface]
cis_id: "6.11"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.11 Ensure IMAP and POP server is not enabled (Not Scored)

## Profile Applicability

- Level 1

## Description

`Dovecot` is an open source IMAP and POP3 server for Linux based systems.

## Rationale

Unless POP3 and/or IMAP servers are to be provided to this server, it is recommended that the service be deleted to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Ensure no start conditions listed for `dovecot`:

```bash
initctl show-config dovecot dovecot
```

## Expected Result

No start conditions should be listed for dovecot.

## Remediation

### Using Command Line

Remove or comment out start lines in `/etc/init/dovecot.conf`:

```bash
sed -i 's/^start/#start/' /etc/init/dovecot.conf
```

## Default Value

Not installed by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
