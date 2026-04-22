---
name: cis-ubuntu1604-v200-2-1-1-3
description: "Ensure chrony is configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.3 Ensure chrony is configured (Automated)

## Description

chrony is a daemon which implements the Network Time Protocol (NTP) and is designed to synchronize system clocks across a variety of systems and use a source that is highly accurate. More information on chrony can be found at http://chrony.tuxfamily.org/. chrony can be configured to be a client and/or a server.

Notes:

- If ntp or systemd-timesyncd are used, chrony should be removed and this section skipped
- This recommendation only applies if chrony is in use on the system
- Only one time synchronization method should be in use on the system

## Rationale

If chrony is in use on the system proper configuration is vital to ensuring time synchronization is working properly.

## Audit Procedure

### Command Line

Verify that only one time synchronization method is in use on the system:

Run the following command to verify that ntp is not installed:

```bash
dpkg -s ntp | grep -E '(Status:|not installed)'
```

Run the following command to verify that systemd-timesyncd is masked:

```bash
systemctl is-enabled systemd-timesyncd
```

Verify that chrony is configured:

Run the following command and verify remote server is configured properly:

```bash
grep -E "^(server|pool)" /etc/chrony/chrony.conf
```

Run the following command and verify the first field for the chronyd process is \_chrony:

```bash
ps -ef | grep chronyd
```

## Expected Result

- ntp should not be installed: `dpkg-query: package 'ntp' is not installed and no information is available`
- systemd-timesyncd should be `masked`
- chrony.conf should show configured server(s): `server <remote-server>`
- chronyd process should run as `_chrony` user

Note: The compiled-in default value is `_chrony`

## Remediation

### Command Line

Remove and/or disable additional time synchronization methods:

Run the following command to remove ntp:

```bash
apt purge ntp
```

Run the following command to stop and mask systemd-timesyncd:

```bash
systemctl --now mask systemd-timesyncd
```

Configure chrony:

Add or edit server or pool lines to `/etc/chrony/chrony.conf` as appropriate:

```
server <remote-server>
```

Add or edit the user line to `/etc/chrony/chrony.conf`:

```
user _chrony
```

## Default Value

The compiled-in default value is `_chrony`.

## References

1. http://chrony.tuxfamily.org/
2. CIS Controls v7 - 6.1 Utilize Three Synchronized Time Sources

## Profile

- Level 1 - Server
- Level 1 - Workstation
