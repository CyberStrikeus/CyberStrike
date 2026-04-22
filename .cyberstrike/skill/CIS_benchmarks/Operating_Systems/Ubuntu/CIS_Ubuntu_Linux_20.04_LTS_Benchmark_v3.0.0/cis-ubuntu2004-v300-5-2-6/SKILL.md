---
name: cis-ubuntu2004-v300-5-2-6
description: "Ensure sudo authentication timeout is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, sudo]
cis_id: "5.2.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sudo authentication timeout is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` caches used credentials for a default of 5 minutes. This is for ease of use when there are multiple administrative tasks to perform. The timeout can be modified to suit local security policies.

## Rationale

A timeout value reduces the window of opportunity for unauthorized privileged sudo access.

## Audit Procedure

### Command Line

Run the following command to verify the default sudo timeout is enabled and no greater than `15` minutes:

```bash
# sudo -V | grep "Authentication timestamp timeout:"
```

Example output:

```
Authentication timestamp timeout: 15.0 minutes
```

Verify timeout is not: a negative number (disabled), greater than `15` minutes, and follows local site policy.

## Expected Result

```
Authentication timestamp timeout: 15.0 minutes
```

(or a value of 15 minutes or less, not negative/disabled)

## Remediation

### Command Line

- IF - the currently configured timeout is a negative number (disabled), greater than `15` minutes, or doesn't follow local site polity:
Run the `visudo` command and edit or add the following line:

```
Defaults        timestamp_timeout=<N>
```

Example:

```
Defaults        timestamp_timeout=15
```

## Default Value

timestamp_timeout=15

## References

1. https://www.sudo.ws/man/1.9.0/sudoers.man.html
2. NIST SP 800-53 Rev. 5: AC-6

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts
Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

MITRE ATT&CK Mappings: T1548 | TA0004 | M1026
