---
name: cis-ubuntu1804-v220-4-3-6
description: "Ensure sudo authentication timeout is configured correctly"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.6"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.6

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` caches credentials for a period of time. The default timeout for the `sudo` command is 15 minutes. It is recommended that the timeout be set to no more than 15 minutes.

## Rationale

If the timeout is too long, a user could execute commands as root for an extended period without re-authenticating. This could allow unauthorized users to execute commands as root if the original user walks away from their terminal.

## Audit Procedure

### Command Line

Run the following command to verify the sudo authentication timeout:

```bash
grep -roP "timestamp_timeout\h*=\h*\d+" /etc/sudoers /etc/sudoers.d/
```

### Expected Result

If output is returned, `timestamp_timeout` should be 15 or less. If no output is returned, the default of 15 minutes is in effect, which is compliant.

## Remediation

### Command Line

Edit the file `/etc/sudoers` or a file in `/etc/sudoers.d/` with `visudo` and set or modify the `timestamp_timeout` value:

```bash
Defaults timestamp_timeout=15
```

OR set to a value of 15 or less per site policy.

## Default Value

timestamp_timeout=15

## References

1. NIST SP 800-53 Rev. 5: IA-11

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
