---
name: cis-ubuntu2004-v300-3-3-9
description: "Ensure suspicious packets are logged"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-parameter]
cis_id: "3.3.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.9 Ensure suspicious packets are logged (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

When enabled, this feature logs packets with un-routable source addresses to the kernel log.

## Rationale

Setting `net.ipv4.conf.all.log_martians` and `net.ipv4.conf.default.log_martians` to 1 enables this feature. Logging these packets allows an administrator to investigate the possibility that an attacker is sending spoofed packets to their system.

## Impact

None expected.

## Audit Procedure

### Command Line

Run the following script to verify the following kernel parameters are set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `net.ipv4.conf.all.log_martians` is set to 1
- `net.ipv4.conf.default.log_martians` is set to 1

Note: kernel parameters are loaded by file and parameter order precedence. The following script observes this precedence as part of the auditing procedure. The parameters being checked may be set correctly in a file. If that file is superseded, the parameter is overridden by an incorrect setting later in that file, or in a canonically later file, that "correct" setting will be ignored both by the script and by the system during a normal kernel parameter load sequence.

## Expected Result

Audit Result: ** PASS ** with both `net.ipv4.conf.all.log_martians` and `net.ipv4.conf.default.log_martians` set to 1.

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `net.ipv4.conf.all.log_martians = 1`
- `net.ipv4.conf.default.log_martians = 1`

Example:

```bash
# printf '%s\n' "net.ipv4.conf.all.log_martians = 1" "net.ipv4.conf.default.log_martians = 1" >>
/etc/sysctl.d/60-netipv4_sysctl.conf
```

Run the following script to set the active kernel parameters:

```bash
#!/usr/bin/env bash

{
  sysctl -w net.ipv4.conf.all.log_martians=1
  sysctl -w net.ipv4.conf.default.log_martians=1
  sysctl -w net.ipv4.route.flush=1
}
```

Note: If these settings appear in a canonically later file, or later in the same file, these settings will be overwritten.

## Default Value

net.ipv4.conf.all.log_martians = 0

net.ipv4.conf.default.log_martians = 0

## References

1. NIST SP 800-53 Rev. 5: AU-3

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | x    | x    |
| v7               | 6.2 Activate audit logging      | x    | x    | x    |
| v7               | 6.3 Enable Detailed Logging     |      | x    | x    |
