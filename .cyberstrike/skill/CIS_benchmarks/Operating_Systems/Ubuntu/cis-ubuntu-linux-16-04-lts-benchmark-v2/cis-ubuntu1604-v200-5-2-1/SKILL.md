---
name: cis-ubuntu1604-v200-5-2-1
description: "Ensure sudo is installed"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, access-control]
cis_id: "5.2.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 5.2.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` allows a permitted user to execute a command as the superuser or another user, as specified by the security policy. The invoking user's real (not effective) user ID is used to determine the user name with which to query the security policy.

Note: Use the `sudo-ldap` package if you need LDAP support for sudoers.

## Rationale

`sudo` supports a plugin architecture for security policies and input/output logging. Third parties can develop and distribute their own policy and I/O logging plugins to work seamlessly with the sudo front end. The default security policy is sudoers, which is configured via the file `/etc/sudoers`.

The security policy determines what privileges, if any, a user has to run sudo. The policy may require that users authenticate themselves with a password or another authentication mechanism. If authentication is required, sudo will exit if the user's password is not entered within a configurable time limit. This limit is policy-specific.

## Impact

None.

## Audit Procedure

### Command Line

Verify that sudo is installed. Run the following command and inspect the output to confirm that sudo is installed:

```bash
dpkg -s sudo
```

OR

```bash
dpkg -s sudo-ldap
```

## Expected Result

The output should show that the package status is `install ok installed`.

## Remediation

### Command Line

Install sudo using the following command:

```bash
apt install sudo
```

OR

```bash
apt install sudo-ldap
```

## Default Value

By default, `sudo` is installed on Ubuntu systems.

## References

1. SUDO(8)
2. http://www.sudo.ws/

## CIS Controls

| Controls Version | Control                                                 |
| ---------------- | ------------------------------------------------------- |
| v7               | 4.3 Ensure the Use of Dedicated Administrative Accounts |

## Assessment Status

Automated
