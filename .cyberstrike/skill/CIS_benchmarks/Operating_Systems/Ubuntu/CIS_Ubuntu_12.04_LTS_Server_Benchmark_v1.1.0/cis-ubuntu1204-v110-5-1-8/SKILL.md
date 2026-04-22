---
name: cis-ubuntu1204-v110-5-1-8
description: "Ensure xinetd is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, xinetd, legacy-services, daemon]
cis_id: "5.1.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.8 Ensure xinetd is not enabled (Scored)

## Profile Applicability
- Level 1

## Description
The eXtended InterNET Daemon (`xinetd`) is an open source super daemon that replaced the original `inetd` daemon. The `xinetd` daemon listens for well known services and dispatches the appropriate daemon to properly respond to service requests.

**Note:** Several other services recommended to be disabled in this benchmark have xinetd versions as well, if xinetd is required in your environment ensure they are disabled in xinetd configuration as well.

## Rationale
If there are no `xinetd` services required, it is recommended that the daemon be disabled.

## Audit Procedure
### Using Command Line
Ensure no start conditions listed for `xinetd`:
```bash
initctl show-config xinetd xinetd
```

## Expected Result
No start conditions should be listed for xinetd.

## Remediation
### Using Command Line
Remove or comment out start lines in `/etc/init/xinetd.conf`:
```bash
sed -i 's/^start/#start/' /etc/init/xinetd.conf
```

## Default Value
Not enabled by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
