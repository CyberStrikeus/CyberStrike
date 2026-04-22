---
name: cis-ubuntu2004-v300-5-2-1
description: "Ensure sudo is installed"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, sudo]
cis_id: "5.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sudo is installed (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` allows a permitted user to execute a command as the superuser or another user, as specified by the security policy. The invoking user's real (not effective) user ID is used to determine the user name with which to query the security policy.

## Rationale

`sudo` supports a plug-in architecture for security policies and input/output logging. Third parties can develop and distribute their own policy and I/O logging plug-ins to work seamlessly with the `sudo` front end. The default security policy is `sudoers`, which is configured via the file `/etc/sudoers` and any entries in `/etc/sudoers.d`.

The security policy determines what privileges, if any, a user has to run `sudo`. The policy may require that users authenticate themselves with a password or another authentication mechanism. If authentication is required, `sudo` will exit if the user's password is not entered within a configurable time limit. This limit is policy-specific.

## Audit Procedure

### Command Line

Run the following command to verify that either `sudo` is installed:

```bash
# dpkg-query -s sudo &>/dev/null && echo "sudo is installed"
```

```
sudo is installed
```

- OR -
Run the following command to verify that either `sudo-ldap` is installed:

```bash
# dpkg-query -s sudo-ldap &>/dev/null && echo "sudo-ldap is installed"
```

```
sudo-ldap is installed
```

## Expected Result

Either `sudo is installed` or `sudo-ldap is installed` should be returned.

## Remediation

### Command Line

First determine if LDAP functionality is required. If so, then install `sudo-ldap`, else install `sudo`.
Example:

```bash
# apt install sudo
```

## References

1. SUDO(8)
2. NIST SP 800-53 Rev. 5: AC-6

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts
Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

MITRE ATT&CK Mappings: T1548 | TA0004 | M1026
