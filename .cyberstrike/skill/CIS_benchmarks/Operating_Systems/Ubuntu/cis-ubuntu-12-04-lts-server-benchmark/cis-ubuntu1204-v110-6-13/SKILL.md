---
name: cis-ubuntu1204-v110-6-13
description: "Ensure HTTP Proxy Server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, squid, proxy, http-proxy, attack-surface]
cis_id: "6.13"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.13 Ensure HTTP Proxy Server is not enabled (Not Scored)

## Profile Applicability

- Level 1

## Description

Squid is a standard proxy server used in many distributions and environments.

## Rationale

If there is no need for a proxy server, it is recommended that the squid proxy be deleted to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Ensure no start conditions listed for `squid3`:

```bash
initctl show-config squid3 squid3
```

## Expected Result

No start conditions should be listed for squid3.

## Remediation

### Using Command Line

Remove or comment out start lines in `/etc/init/squid3.conf`:

```bash
sed -i 's/^start/#start/' /etc/init/squid3.conf
```

## Default Value

Not installed by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
