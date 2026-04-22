---
name: cis-ubuntu1204-v110-7-4-2
description: "Create /etc/hosts.allow"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, tcp-wrappers, hosts-allow, access-control]
cis_id: "7.4.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.4.2 Create /etc/hosts.allow (Not Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/hosts.allow` file specifies which IP addresses are permitted to connect to the host. It is intended to be used in conjunction with the `/etc/hosts.deny` file.

## Rationale

The `/etc/hosts.allow` file supports access control by IP and helps ensure that only authorized systems can connect to the server.

## Audit Procedure

### Using Command Line

Run the following command to verify the contents of the `/etc/hosts.allow` file.

```bash
cat /etc/hosts.allow
```

## Expected Result

Contents will vary, depending on your network configuration.

## Remediation

### Using Command Line

Create `/etc/hosts.allow`:

```bash
echo "ALL: <net>/<mask>, <net>/<mask>, ..." >/etc/hosts.allow
```

where each `<net>/<mask>` combination (for example, "192.168.1.0/255.255.255.0") represents one network block in use by your organization that requires access to this system.

## Default Value

The `/etc/hosts.allow` file may or may not exist by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
