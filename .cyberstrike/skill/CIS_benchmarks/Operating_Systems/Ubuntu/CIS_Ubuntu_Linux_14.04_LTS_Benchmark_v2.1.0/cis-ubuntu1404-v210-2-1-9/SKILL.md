---
name: "CIS Ubuntu 14.04 LTS - 2.1.9 Ensure tftp server is not enabled"
description: "Verify that tftp inetd service is disabled to prevent unauthenticated file transfers"
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
cis_id: "2.1.9"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.1.9 Ensure tftp server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Trivial File Transfer Protocol (TFTP) is a simple file transfer protocol, typically used to automatically transfer configuration or boot machines from a boot server. The packages `tftpd` and `atftp` are both used to define and support a TFTP server.

## Rationale

TFTP does not support authentication nor does it ensure the confidentiality or integrity of data. It is recommended that TFTP be removed, unless there is a specific need for TFTP. In that case, extreme caution must be used when configuring the services.

## Audit Procedure

Verify the `tftp` service is not enabled. Run the following command and verify results are as indicated:

```bash
grep -R "^tftp" /etc/inetd.*
```

No results should be returned.

Check `/etc/xinetd.conf` and `/etc/xinetd.d/*` and verify all `tftp` services have `disable = yes` set.

## Expected Result

No output should be returned from the grep command. All tftp services in xinetd should have `disable = yes`.

## Remediation

Comment out or remove any lines starting with `tftp` from `/etc/inetd.conf` and `/etc/inetd.d/*`.

Set `disable = yes` on all `tftp` services in `/etc/xinetd.conf` and `/etc/xinetd.d/*`.

## Default Value

tftp services are not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
