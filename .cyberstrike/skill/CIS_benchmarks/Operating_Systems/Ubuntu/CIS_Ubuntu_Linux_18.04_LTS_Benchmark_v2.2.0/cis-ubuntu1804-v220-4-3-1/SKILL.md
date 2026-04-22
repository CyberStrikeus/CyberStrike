---
name: cis-ubuntu1804-v220-4-3-1
description: "Ensure sudo is installed"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` allows a permitted user to execute a command as the superuser or another user, as specified by the security policy. The invoking user's real (not effective) user-ID is used to determine the user name with which to query the security policy.

## Rationale

`sudo` supports a plugin architecture for security policies and input/output logging. Third parties can develop and distribute their own policy and I/O logging plugins to work seamlessly with the `sudo` front end. The default security policy is sudoers, which is configured via the file `/etc/sudoers`.

## Audit Procedure

### Command Line

Run the following command to verify that `sudo` is installed:

```bash
dpkg-query -s sudo | grep -i status
```

### Expected Result

```
Status: install ok installed
```

## Remediation

### Command Line

Install sudo using the following command:

```bash
apt install sudo
```

## References

1. NIST SP 800-53 Rev. 5: AC-6(1)

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
