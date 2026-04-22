---
name: "CIS Ubuntu 14.04 LTS - 2.2.1.2 Ensure ntp is configured"
description: "Verify that NTP is properly configured with restrict options and running as ntp user"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - services
cis_id: "2.2.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.1.2 Ensure ntp is configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`ntp` is a daemon which implements the Network Time Protocol (NTP). It is designed to synchronize system clocks across a variety of systems and use a source that is highly accurate. More information on NTP can be found at http://www.ntp.org. `ntp` can be configured to be a client and/or a server.

This recommendation only applies if ntp is in use on the system.

## Rationale

If ntp is in use on the system proper configuration is vital to ensuring time synchronization is working properly.

## Audit Procedure

Run the following command and verify output matches:

```bash
grep "^restrict" /etc/ntp.conf
```

Expected output:
```
restrict -4 default kod nomodify notrap nopeer noquery
restrict -6 default kod nomodify notrap nopeer noquery
```

The `-4` in the first line is optional and options after `default` can appear in any order. Additional restriction lines may exist.

Run the following command and verify remote server is configured properly:

```bash
grep "^(server|pool)" /etc/ntp.conf
```

Expected output:
```
server <remote-server>
```

Multiple servers may be configured.

Verify that `ntp` is configured to run as the `ntp` user by running the following command:

```bash
grep "RUNASUSER=ntp" /etc/init.d/ntp
```

Expected output:
```
RUNASUSER=ntp
```

## Expected Result

- Restrict lines should include `default kod nomodify notrap nopeer noquery` for both IPv4 and IPv6.
- At least one remote server or pool should be configured.
- NTP should run as the `ntp` user.

## Remediation

Add or edit restrict lines in `/etc/ntp.conf` to match the following:

```
restrict -4 default kod nomodify notrap nopeer noquery
restrict -6 default kod nomodify notrap nopeer noquery
```

Add or edit server or pool lines to `/etc/ntp.conf` as appropriate:

```
server <remote-server>
```

Configure `ntp` to run as the `ntp` user by adding or editing the `/etc/init.d/ntp` file:

```
RUNASUSER=ntp
```

## Default Value

NTP restrict and server settings are not configured by default.

## References

- http://www.ntp.org
- CIS Controls: 6.1 Use At Least Two Synchronized Time Sources For All Servers And Network Equipment

## Profile

- Level 1 - Server
- Level 1 - Workstation
