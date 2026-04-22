---
name: "CIS Ubuntu 14.04 LTS - 2.1.1 Ensure chargen services are not enabled"
description: "Verify that chargen inetd services are disabled to reduce attack surface"
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
cis_id: "2.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 2.1.1 Ensure chargen services are not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`chargen` is a network service that responds with 0 to 512 ASCII characters for each connection it receives. This service is intended for debugging and testing purposes. It is recommended that this service be disabled.

## Rationale

Disabling this service will reduce the remote attack surface of the system.

## Audit Procedure

Verify the `chargen` service is not enabled. Run the following command and verify results are as indicated:

```bash
grep -R "^chargen" /etc/inetd.*
```

No results should be returned.

Check `/etc/xinetd.conf` and `/etc/xinetd.d/*` and verify all `chargen` services have `disable = yes` set.

## Expected Result

No output should be returned from the grep command. All chargen services in xinetd should have `disable = yes`.

## Remediation

Comment out or remove any lines starting with `chargen` from `/etc/inetd.conf` and `/etc/inetd.d/*`.

Set `disable = yes` on all `chargen` services in `/etc/xinetd.conf` and `/etc/xinetd.d/*`.

## Default Value

chargen services are not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
