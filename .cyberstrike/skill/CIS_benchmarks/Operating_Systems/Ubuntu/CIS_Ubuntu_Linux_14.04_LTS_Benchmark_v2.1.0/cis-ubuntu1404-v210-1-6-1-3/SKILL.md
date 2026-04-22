---
name: "CIS Ubuntu 14.04 LTS - 1.6.1.3 Ensure SELinux policy is configured"
description: "Verify that SELinux policy is configured to meet or exceed the default targeted policy"
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
cis_id: "1.6.1.3"
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
severity_boost: "high"
---

# 1.6.1.3 Ensure SELinux policy is configured (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Configure SELinux to meet or exceed the default targeted policy, which constrains daemons and system software only.

## Rationale

Security configuration requirements vary from site to site. Some sites may mandate a policy that is stricter than the default policy, which is perfectly acceptable. This item is intended to ensure that at least the default recommendations are met.

## Audit Procedure

Run the following commands and ensure output matches "ubuntu", "default" or "mls":

```bash
grep SELINUXTYPE= /etc/selinux/config
sestatus
```

## Expected Result

```
SELINUXTYPE=ubuntu

Policy from config file: ubuntu
```

## Remediation

Edit the `/etc/selinux/config` file to set the SELINUXTYPE parameter:

```
SELINUXTYPE=ubuntu
```

## Default Value

Not applicable.

## Notes

If your organization requires stricter policies, ensure that they are set in the `/etc/selinux/config` file.

## References

- CIS Controls: 14.4 Protect Information With Access Control Lists

## Profile

- Level 2 - Server
- Level 2 - Workstation
