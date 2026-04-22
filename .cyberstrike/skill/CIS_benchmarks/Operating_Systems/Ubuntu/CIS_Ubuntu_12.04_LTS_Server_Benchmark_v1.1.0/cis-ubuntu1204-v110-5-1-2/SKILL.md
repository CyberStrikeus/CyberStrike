---
name: cis-ubuntu1204-v110-5-1-2
description: "Ensure rsh server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, rsh, legacy-services, inetd]
cis_id: "5.1.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Ensure rsh server is not enabled (Scored)

## Profile Applicability
- Level 1

## Description
The Berkeley `rsh-server` (`rsh`, `rlogin`, `rcp`) package contains legacy services that exchange credentials in clear-text.

## Rationale
These legacy services contain numerous security exposures and have been replaced with the more secure SSH package.

## Audit Procedure
### Using Command Line
Ensure the `rsh` services are not enabled:
```bash
grep ^shell /etc/inetd.conf
grep ^login /etc/inetd.conf
grep ^exec /etc/inetd.conf
```

## Expected Result
No results should be returned.

## Remediation
### Using Command Line
Remove or comment out any `shell`, `login`, or `exec` lines in `/etc/inetd.conf`:
```bash
sed -i 's/^shell/#shell/' /etc/inetd.conf
sed -i 's/^login/#login/' /etc/inetd.conf
sed -i 's/^exec/#exec/' /etc/inetd.conf
```

## Default Value
Not enabled by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
