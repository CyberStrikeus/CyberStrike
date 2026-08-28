---
name: cis-ubuntu2004-v300-5-2-2
description: "Ensure sudo commands use pty"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, sudo]
cis_id: "5.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sudo commands use pty (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` can be configured to run only from a pseudo terminal (`pseudo-pty`).

## Rationale

Attackers can run a malicious program using `sudo` which would fork a background process that remains even when the main program has finished executing.

## Impact

WARNING: Editing the `sudo` configuration incorrectly can cause `sudo` to stop functioning. Always use `visudo` to modify `sudo` configuration files.

## Audit Procedure

### Command Line

Verify that `sudo` can only run other commands from a pseudo terminal.
Run the following command to verify `Defaults use_pty` is set:

```bash
# grep -rPi -- '^\h*Defaults\h+([^#\n\r]+,\h*)?use_pty\b' /etc/sudoers*
```

Verify the output matches:

```
/etc/sudoers:Defaults use_pty
```

Run the follow command to to verify `Defaults !use_pty` is not set:

```bash
# grep -rPi -- '^\h*Defaults\h+([^#\n\r]+,\h*)?!use_pty\b' /etc/sudoers*
```

Nothing should be returned.

## Expected Result

`Defaults use_pty` should be set in `/etc/sudoers` and `!use_pty` should not be found.

## Remediation

### Command Line

Edit the file `/etc/sudoers` with `visudo` or a file in `/etc/sudoers.d/` with `visudo -f <PATH TO FILE>` and add the following line:

```
Defaults use_pty
```

Edit the file `/etc/sudoers` with `visudo` and any files in `/etc/sudoers.d/` with `visudo -f <PATH TO FILE>` and remove any occurrence of `!use_pty`

Note:

- sudo will read each file in `/etc/sudoers.d`, skipping file names that end in `~` or contain a `.` character to avoid causing problems with package manager or editor temporary/backup files.
- Files are parsed in sorted lexical order. That is, `/etc/sudoers.d/01_first` will be parsed before `/etc/sudoers.d/10_second`.
- Be aware that because the sorting is lexical, not numeric, `/etc/sudoers.d/1_whoops` would be loaded after `/etc/sudoers.d/10_second`.
- Using a consistent number of leading zeroes in the file names can be used to avoid such problems.

## References

1. SUDO(8)
2. VISUDO(8)
3. sudoers(5)
4. NIST SP 800-53 Rev. 5: AC-6

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts
Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

MITRE ATT&CK Mappings: T1078, T1078.003, T1548, T1548.003 | TA0001, TA0003 | M1026, M1028
