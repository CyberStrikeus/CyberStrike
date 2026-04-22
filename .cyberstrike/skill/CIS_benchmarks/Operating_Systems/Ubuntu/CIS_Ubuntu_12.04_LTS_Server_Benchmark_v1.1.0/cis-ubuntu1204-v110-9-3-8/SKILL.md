---
name: cis-ubuntu1204-v110-9-3-8
description: "Disable SSH Root Login"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, ssh, root-login]
cis_id: "9.3.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.3.8 Disable SSH Root Login (Scored)

## Profile Applicability
- Level 1

## Description
The `PermitRootLogin` parameter specifies if the root user can log in using ssh(1). The default is no.

## Rationale
Disallowing root logins over SSH requires server admins to authenticate using their own individual account, then escalating to root via `sudo` or `su`. This in turn limits opportunity for non-repudiation and provides a clear audit trail in the event of a security incident.

## Audit Procedure
### Using Command Line
To verify the correct SSH setting, run the following command and verify that the output is as shown:
```bash
grep "^PermitRootLogin" /etc/ssh/sshd_config
```

## Expected Result
```
PermitRootLogin no
```

## Remediation
### Using Command Line
Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:
```bash
PermitRootLogin no
```

## Default Value
PermitRootLogin no

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
