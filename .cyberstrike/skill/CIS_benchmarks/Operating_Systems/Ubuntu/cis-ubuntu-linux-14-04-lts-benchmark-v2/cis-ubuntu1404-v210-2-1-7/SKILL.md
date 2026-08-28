---
name: "CIS Ubuntu 14.04 LTS - 2.1.7 Ensure talk server is not enabled"
description: "Verify that talk inetd services are disabled to reduce attack surface"
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
cis_id: "2.1.7"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 2.1.7 Ensure talk server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The talk software makes it possible for users to send and receive messages across systems through a terminal session. The talk client (allows initiate of talk sessions) is installed by default.

## Rationale

The software presents a security risk as it uses unencrypted protocols for communication.

## Audit Procedure

Verify the `talk` service is not enabled. Run the following commands and verify results are as indicated:

```bash
grep -R "^talk" /etc/inetd.*
grep -R "^ntalk" /etc/inetd.*
```

No results should be returned.

Check `/etc/xinetd.conf` and `/etc/xinetd.d/*` and verify all talk services have `disable = yes` set.

## Expected Result

No output should be returned from the grep commands. All talk services in xinetd should have `disable = yes`.

## Remediation

Comment out or remove any lines starting with `talk` or `ntalk` from `/etc/inetd.conf` and `/etc/inetd.d/*`.

Set `disable = yes` on all `talk` services in `/etc/xinetd.conf` and `/etc/xinetd.d/*`.

## Default Value

talk services are not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
