---
name: cis-ubuntu1604-v200-5-2-2
description: "Ensure sudo commands use pty"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, access-control]
cis_id: "5.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 5.2.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` can be configured to run only from a pseudo-pty.

Note: visudo edits the sudoers file in a safe fashion, analogous to vipw(8). visudo locks the sudoers file against multiple simultaneous edits, provides basic sanity checks, and checks or parse errors. If the sudoers file is currently being edited you will receive a message to try again later.

## Rationale

Attackers can run a malicious program using sudo, which would again fork a background process that remains even when the main program has finished executing.

## Impact

None.

## Audit Procedure

### Command Line

Verify that sudo can only run other commands from a pseudo-pty. Run the following command:

```bash
grep -Ei '^\s*Defaults\s+([^#]+,\s*)?use_pty(,\s+\S+\s*)*(\s+#.*)?$' /etc/sudoers /etc/sudoers.d/*
```

## Expected Result

The output should include a line matching:

```
Defaults use_pty
```

## Remediation

### Command Line

Edit the file `/etc/sudoers` or a file in `/etc/sudoers.d/` with `visudo -f` and add the following line:

```
Defaults use_pty
```

## Default Value

By default, `sudo` does not require a pseudo-pty.

## References

1. SUDO(8)

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts |

## Assessment Status

Automated
