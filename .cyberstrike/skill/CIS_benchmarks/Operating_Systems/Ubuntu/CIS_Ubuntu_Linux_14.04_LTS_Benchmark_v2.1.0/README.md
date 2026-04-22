# CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0 - Skills

This directory contains **220 SKILL.md files** for the CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0 (ARCHIVE).

## Overview

- **Benchmark Version**: 2.1.0 (ARCHIVED)
- **Release Date**: 12-28-2017
- **Total Controls**: 220
- **Profile Levels**: Level 1 and Level 2 (Server and Workstation)
- **Platform**: Ubuntu Linux 14.04 LTS
- **Assessment Status**: Scored / Not Scored

## Control Breakdown by Section

| Section | Title | Controls |
|---------|-------|----------|
| 1 | Initial Setup | 52 |
| 2 | Services | 35 |
| 3 | Network Configuration | 28 |
| 4 | Logging and Auditing | 33 |
| 5 | Access, Authentication and Authorization | 38 |
| 6 | System Maintenance | 34 |
| **Total** | | **220** |

## Section 1 Detail

| Sub-Section | Title | Controls |
|-------------|-------|----------|
| 1.1 | Filesystem Configuration | 26 |
| 1.2 | Configure Software Updates | 2 |
| 1.3 | Filesystem Integrity Checking | 2 |
| 1.4 | Secure Boot Settings | 3 |
| 1.5 | Additional Process Hardening | 4 |
| 1.6 | Mandatory Access Control | 7 |
| 1.7 | Warning Banners | 7 |
| 1.8 | Updates, Patches and Additional Security Software | 1 |

## Section 2 Detail

| Sub-Section | Title | Controls |
|-------------|-------|----------|
| 2.1 | inetd Services | 11 |
| 2.2 | Special Purpose Services | 19 |
| 2.3 | Service Clients | 5 |

## Section 3 Detail

| Sub-Section | Title | Controls |
|-------------|-------|----------|
| 3.1 | Network Parameters (Host Only) | 2 |
| 3.2 | Network Parameters (Host and Router) | 8 |
| 3.3 | IPv6 | 3 |
| 3.4 | TCP Wrappers | 5 |
| 3.5 | Uncommon Network Protocols | 4 |
| 3.6 | Firewall Configuration | 5 |
| 3.7 | Wireless Interfaces | 1 |

## Section 4 Detail

| Sub-Section | Title | Controls |
|-------------|-------|----------|
| 4.1.1 | Configure Data Retention | 3 |
| 4.1.2-4.1.18 | Configure auditd Rules | 17 |
| 4.2.1 | Configure rsyslog | 5 |
| 4.2.2 | Configure syslog-ng | 5 |
| 4.2.3-4.2.4 | Logging Meta Controls | 2 |
| 4.3 | Configure logrotate | 1 |

## Section 5 Detail

| Sub-Section | Title | Controls |
|-------------|-------|----------|
| 5.1 | Configure cron | 8 |
| 5.2 | SSH Server Configuration | 15 |
| 5.3 | Configure PAM | 4 |
| 5.4 | User Accounts and Environment | 9 |
| 5.5 | Restrict root Login to System Console | 1 |
| 5.6 | Restrict Access to su Command | 1 |

## Section 6 Detail

| Sub-Section | Title | Controls |
|-------------|-------|----------|
| 6.1 | System File Permissions | 14 |
| 6.2 | User and Group Settings | 20 |

## Archive Status

This benchmark is marked **ARCHIVED** by CIS. Ubuntu 14.04 LTS reached End-of-Life on April 25, 2019. This skill set is preserved for legacy system auditing and historical compliance reference.

## Differences from Ubuntu 12.04 v1.1.0

| Feature | Ubuntu 12.04 v1.1.0 | Ubuntu 14.04 v2.1.0 |
|---------|---------------------|---------------------|
| Total Controls | 186 | 220 |
| Init System | Upstart | Upstart (systemd available) |
| MAC | AppArmor only | SELinux + AppArmor sections |
| Logging | rsyslog only | rsyslog + syslog-ng |
| Firewall | raw iptables | iptables (structured) |
| Section Structure | 13 flat sections | 6 hierarchical sections |
| PAM Hashing | Not covered | SHA-512 (5.3.4) |
| Shadow Group | Not covered | 6.2.20 |
| GDM Banner | Not covered | 1.7.2 |

## Ubuntu 14.04-Specific Features

- Uses **Upstart** init system by default (`initctl`), with **systemd** available as alternative
- Both **SELinux** (1.6.1.x) and **AppArmor** (1.6.2.x) MAC sections included
- Both **rsyslog** (4.2.1.x) and **syslog-ng** (4.2.2.x) logging configurations
- Uses `dpkg -s`, `apt-get`, `initctl show-config` for package/service management
- Firewall managed via `iptables` commands
- Boot configuration in `/boot/grub/grub.cfg` (GRUB2)
- System accounts have UID < 1000
- Time synchronization covers both `ntp` and `chrony` (2.2.1.x)

## Directory Structure

```
cis-ubuntu1404-v210-{control_id}/
+-- SKILL.md
```

Example: `cis-ubuntu1404-v210-1-1-1-1/SKILL.md` for control 1.1.1.1, `cis-ubuntu1404-v210-6-2-20/SKILL.md` for control 6.2.20

## Source Document

**CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0**
- Platform: Ubuntu Linux 14.04 LTS
- Original PDF: `CIS_Ubuntu_Linux_14.04_LTS_Benchmark_v2.1.0_ARCHIVE.pdf`

## Contact

- CyberStrike: cyberstrike.io
- CIS Benchmarks: cisecurity.org
