---
name: cis-ubuntu1604-v200-2-1-1-4
description: "Ensure ntp is configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.4 Ensure ntp is configured (Automated)

## Description

ntp is a daemon which implements the Network Time Protocol (NTP). It is designed to synchronize system clocks across a variety of systems and use a source that is highly accurate. More information on NTP can be found at http://www.ntp.org. ntp can be configured to be a client and/or a server.

Notes:

- If chrony or systemd-timesyncd are used, ntp should be removed and this section skipped
- This recommendation only applies if ntp is in use on the system
- Only one time synchronization method should be in use on the system

## Rationale

If ntp is in use on the system proper configuration is vital to ensuring time synchronization is working properly.

## Audit Procedure

### Command Line

Verify that only one time synchronization method is in use on the system:

Run the following command to verify chrony is not in use on the system:

```bash
dpkg -s chrony | grep -E '(Status:|not installed)'
```

Run the following command to verify that systemd-timesyncd is not in use on the system:

```bash
systemctl is-enabled systemd-timesyncd
```

Verify that ntp is configured:

Run the following command and verify output matches:

```bash
grep "^restrict" /etc/ntp.conf
```

Run the following command and verify remote server is configured properly:

```bash
grep -E "^(server|pool)" /etc/ntp.conf
```

Verify that ntp is configured to run as the ntp user by running the following command and verifying output matches:

```bash
grep "RUNASUSER=ntp" /etc/init.d/ntp
```

## Expected Result

- chrony should not be installed: `dpkg-query: package 'chrony' is not installed and no information is available`
- systemd-timesyncd should be `masked`
- `/etc/ntp.conf` should contain: `restrict -4 default kod nomodify notrap nopeer noquery` and `restrict -6 default kod nomodify notrap nopeer noquery`
- The `-4` in the first line is optional and options after `default` can appear in any order. Additional restriction lines may exist
- Server/pool lines should be configured: `server <remote-server>`
- Multiple servers may be configured
- `/etc/init.d/ntp` should contain: `RUNASUSER=ntp`

## Remediation

### Command Line

Remove and/or disable additional time synchronization methods:

Run the following command to remove chrony:

```bash
apt purge chrony
```

Run the following command to stop and mask systemd-timesyncd:

```bash
systemctl --now mask systemd-timesyncd
```

Configure ntp:

Add or edit restrict lines in `/etc/ntp.conf` to match the following:

```
restrict -4 default kod nomodify notrap nopeer noquery
restrict -6 default kod nomodify notrap nopeer noquery
```

Add or edit server or pool lines to `/etc/ntp.conf` as appropriate:

```
server <remote-server>
```

Configure ntp to run as the ntp user by adding or editing the `/etc/init.d/ntp` file:

```
RUNASUSER=ntp
```

## Default Value

ntp is not configured by default.

## References

1. http://www.ntp.org
2. CIS Controls v7 - 6.1 Utilize Three Synchronized Time Sources

## Profile

- Level 1 - Server
- Level 1 - Workstation
