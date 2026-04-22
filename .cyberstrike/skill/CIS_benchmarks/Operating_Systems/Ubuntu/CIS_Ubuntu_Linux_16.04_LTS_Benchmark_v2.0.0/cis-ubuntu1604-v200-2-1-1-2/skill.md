---
name: cis-ubuntu1604-v200-2-1-1-2
description: "Ensure systemd-timesyncd is configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1.2 Ensure systemd-timesyncd is configured (Manual)

## Description

systemd-timesyncd is a daemon that has been added for synchronizing the system clock across the network. It implements an SNTP client. In contrast to NTP implementations such as chrony or the NTP reference server this only implements a client side, and does not bother with the full NTP complexity, focusing only on querying time from one remote server and synchronizing the local clock to it. The daemon runs with minimal privileges, and has been hooked up with networkd to only operate when network connectivity is available. The daemon saves the current clock to disk every time a new NTP sync has been acquired, and uses this to possibly correct the system clock early at bootup, in order to accommodate for systems that lack an RTC such as the Raspberry Pi and embedded devices, and make sure that time monotonically progresses on these systems, even if it is not always correct. To make use of this daemon a new system user and group "systemd-timesync" needs to be created on installation of systemd.

Notes:
- If chrony or ntp are used, systemd-timesyncd should be stopped and masked, and this section skipped
- This recommendation only applies if timesyncd is in use on the system
- Only one time synchronization method should be in use on the system

## Rationale

Proper configuration is vital to ensuring time synchronization is working properly.

## Audit Procedure

### Command Line

Verify that only one time synchronization method is in use on the system:

Run the following command to verify that ntp is not installed:

```bash
dpkg -s ntp
```

Run the following command to verify that chrony is not installed:

```bash
dpkg -s chrony
```

Ensure that timesyncd is enabled and started:

```bash
systemctl is-enabled systemd-timesyncd.service
```

Verify that systemd-timesyncd is configured:

Review `/etc/systemd/timesyncd.conf` and ensure that the NTP servers, NTP FallbackNTP servers, and RootDistanceMaxSec listed are in accordance with local policy.

```bash
timedatectl status
```

## Expected Result

- ntp should not be installed: `dpkg-query: package 'ntp' is not installed and no information is available`
- chrony should not be installed: `dpkg-query: package 'chrony' is not installed and no information is available`
- systemd-timesyncd.service should be `enabled`
- timedatectl status should show NTP enabled: yes, NTP synchronized: yes

## Remediation

### Command Line

Remove additional time synchronization methods:

```bash
apt purge ntp
apt purge chrony
```

Configure systemd-timesyncd:

```bash
systemctl enable systemd-timesyncd.service
```

Edit the file `/etc/systemd/timesyncd.conf` and add/modify the following lines:

```
NTP=0.debian.pool.ntp.org 1.debian.pool.ntp.org #Servers listed should be In Accordence With Local Policy
FallbackNTP=2.debian.pool.ntp.org 3.debian.pool.ntp.org #Servers listed should be In Accordence With Local Policy
RootDistanceMax=1 #should be In Accordence With Local Policy
```

Run the following commands to start systemd-timesyncd.service:

```bash
systemctl start systemd-timesyncd.service
timedatectl set-ntp true
```

## Default Value

systemd-timesyncd is not configured by default.

## References

1. CIS Controls v7 - 6.1 Utilize Three Synchronized Time Sources

## Profile

- Level 1 - Server
- Level 1 - Workstation
