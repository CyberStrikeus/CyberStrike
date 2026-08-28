---
name: "CIS Ubuntu 14.04 LTS - 1.6.1.4 Ensure no unconfined daemons exist"
description: "Verify that no daemons are running unconfined outside of SELinux policy restrictions"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - mac
cis_id: "1.6.1.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with:
  - cis-ubuntu1404-v210-1-6-1-1
  - cis-ubuntu1404-v210-1-6-1-2
prerequisites:
  - cis-ubuntu1404-v210-1-6-1-1
severity_boost: "medium"
---

# 1.6.1.4 Ensure no unconfined daemons exist (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Daemons that are not defined in SELinux policy will inherit the security context of their parent process.

## Rationale

Since daemons are launched and descend from the `init` process, they will inherit the security context label `initrc_t`. This could cause the unintended consequence of giving the process more permission than it requires.

## Audit Procedure

Run the following command and verify not output is produced:

```bash
ps -eZ | egrep "initrc" | egrep -vw "tr|ps|egrep|bash|awk" | tr ':' ' ' | awk '{ print $NF }'
```

## Expected Result

No output should be returned. Any output indicates unconfined daemons that need investigation.

## Remediation

Investigate any unconfined daemons found during the audit action. They may need to have an existing security context assigned to them or a policy built for them.

## Default Value

Not applicable.

## Notes

Occasionally certain daemons such as backup or centralized management software may require running unconfined. Any such software should be carefully analyzed and documented before such an exception is made.

## References

- CIS Controls: 14.4 Protect Information With Access Control Lists

## Profile

- Level 2 - Server
- Level 2 - Workstation
