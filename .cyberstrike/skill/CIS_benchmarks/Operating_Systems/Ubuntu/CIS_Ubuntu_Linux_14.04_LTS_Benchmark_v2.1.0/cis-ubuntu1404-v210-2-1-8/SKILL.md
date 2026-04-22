---
name: "CIS Ubuntu 14.04 LTS - 2.1.8 Ensure telnet server is not enabled"
description: "Verify that telnet inetd service is disabled to prevent cleartext credential exposure"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - inetd
cis_id: "2.1.8"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 2.1.8 Ensure telnet server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `telnet-server` package contains the `telnet` daemon, which accepts connections from users from other systems via the `telnet` protocol.

## Rationale

The `telnet` protocol is insecure and unencrypted. The use of an unencrypted transmission medium could allow a user with access to sniff network traffic the ability to steal credentials. The `ssh` package provides an encrypted session and stronger security.

## Audit Procedure

Verify the `telnet` service is not enabled. Run the following command and verify results are as indicated:

```bash
grep -R "^telnet" /etc/inetd.*
```

No results should be returned.

Check `/etc/xinetd.conf` and `/etc/xinetd.d/*` and verify all `telnet` services have `disable = yes` set.

## Expected Result

No output should be returned from the grep command. All telnet services in xinetd should have `disable = yes`.

## Remediation

Comment out or remove any lines starting with `telnet` from `/etc/inetd.conf` and `/etc/inetd.d/*`.

Set `disable = yes` on all `telnet` services in `/etc/xinetd.conf` and `/etc/xinetd.d/*`.

## Default Value

telnet services are not enabled by default.

## References

- CIS Controls: 3.4 Use Only Secure Channels For Remote System Administration
- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
