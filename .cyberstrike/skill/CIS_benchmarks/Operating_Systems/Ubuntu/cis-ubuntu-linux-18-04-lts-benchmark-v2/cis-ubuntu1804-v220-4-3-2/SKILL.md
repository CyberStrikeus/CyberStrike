---
name: cis-ubuntu1804-v220-4-3-2
description: "Ensure sudo commands use pty"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` can be configured to run only from a pseudo terminal (pseudo-pty).

## Rationale

Attackers can run a malicious program using `sudo` which forks a background process that remains on the user's terminal device even after the main program has finished executing. This can be used to intercept user input including passwords. By configuring `sudo` to use a pseudo terminal, this attack is no longer possible.

## Audit Procedure

### Command Line

Run the following command to verify that `sudo` uses a pseudo terminal:

```bash
grep -rPi '^\h*Defaults\h+([^#\n\r]+,)?use_pty(,\h*\h+\h*)*\h*(#.*)?$' /etc/sudoers /etc/sudoers.d/
```

### Expected Result

```
Defaults use_pty
```

## Remediation

### Command Line

Edit the file `/etc/sudoers` or a file in `/etc/sudoers.d/` with `visudo` and add the following line:

```bash
Defaults use_pty
```

## References

1. NIST SP 800-53 Rev. 5: AC-6(1)

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
