# CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0 - Skills

This directory contains **186 SKILL.md files** for the CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0 (ARCHIVE).

## Overview

- **Benchmark Version**: 1.1.0 (ARCHIVED)
- **Release Date**: 01-07-2015
- **Total Controls**: 186
- **Profile Levels**: Level 1 and Level 2
- **Platform**: Ubuntu 12.04 LTS Server
- **Assessment Status**: Scored / Not Scored (pre-Automated/Manual terminology)

## Control Breakdown by Section

| Section   | Title                                           | Controls |
| --------- | ----------------------------------------------- | -------- |
| 1         | Patching and Software Updates                   | 1        |
| 2         | Filesystem Configuration                        | 25       |
| 3         | Secure Boot Settings                            | 4        |
| 4         | Additional Process Hardening                    | 5        |
| 5         | OS Services                                     | 13       |
| 6         | Special Purpose Services                        | 17       |
| 7         | Network Configuration and Firewalls             | 24       |
| 8         | Logging and Auditing                            | 29       |
| 9         | System Access, Authentication and Authorization | 27       |
| 10        | User Accounts and Environment                   | 7        |
| 11        | Warning Banners                                 | 3        |
| 12        | Verify System File Permissions                  | 11       |
| 13        | Review User and Group Settings                  | 20       |
| **Total** |                                                 | **186**  |

## Section 5 Detail

| Sub-Section | Title                                                  | Controls |
| ----------- | ------------------------------------------------------ | -------- |
| 5.1         | Ensure Legacy Services are Not Enabled                 | 8        |
| 5.2-5.6     | inetd Services (chargen, daytime, echo, discard, time) | 5        |

## Section 7 Detail

| Sub-Section | Title                                       | Controls |
| ----------- | ------------------------------------------- | -------- |
| 7.1         | Modify Network Parameters (Host Only)       | 2        |
| 7.2         | Modify Network Parameters (Host and Router) | 8        |
| 7.3         | Configure IPv6                              | 3        |
| 7.4         | Install TCP Wrappers                        | 5        |
| 7.5         | Uncommon Network Protocols                  | 4        |
| 7.6-7.7     | Firewall (iptables, IPsec)                  | 2        |

## Section 8 Detail

| Sub-Section  | Title                    | Controls |
| ------------ | ------------------------ | -------- |
| 8.1.1        | Configure Data Retention | 3        |
| 8.1.2-8.1.18 | Configure auditd Rules   | 17       |
| 8.2          | Configure rsyslog        | 6        |
| 8.3          | Advanced Logging (AIDE)  | 2        |
| 8.4          | Configure logrotate      | 1        |

## Section 9 Detail

| Sub-Section | Title                                 | Controls |
| ----------- | ------------------------------------- | -------- |
| 9.1         | Configure cron and at                 | 8        |
| 9.2         | Configure PAM                         | 3        |
| 9.3         | Configure SSH                         | 14       |
| 9.4         | Restrict root Login to System Console | 1        |
| 9.5         | Restrict Access to su Command         | 1        |

## Archive Status

This benchmark is marked **ARCHIVED** by CIS. Ubuntu 12.04 LTS reached End-of-Life on April 28, 2017. This skill set is preserved for legacy system auditing and historical compliance reference.

## Ubuntu 12.04-Specific Features

- Uses **Upstart** init system (`initctl show-config`) instead of systemd
- Uses **inetd/xinetd** for legacy service management (`/etc/inetd.conf`)
- Uses **AppArmor** for Mandatory Access Control (not SELinux)
- Audit commands use `dpkg -s`, `apt-get purge`, `initctl show-config`
- Firewall managed via raw `iptables` commands (not `ufw`)
- Boot configuration in `/boot/grub/menu.lst` (GRUB Legacy) or `/boot/grub/grub.cfg`
- System accounts have UID < 500 (not 1000)
- Uses `/etc/init/` Upstart job files instead of `/etc/systemd/`

## Directory Structure

```
cis-ubuntu1204-v110-{control_id}/
└── SKILL.md
```

Example: `cis-ubuntu1204-v110-1-1/SKILL.md` for control 1.1, `cis-ubuntu1204-v110-8-1-1-1/SKILL.md` for control 8.1.1.1

## Source Document

**CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0**

- Platform: Ubuntu 12.04 LTS Server
- Original PDF: `CIS_Ubuntu_12.04_LTS_Server_Benchmark_v1.1.0 _ARCHIVE.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
