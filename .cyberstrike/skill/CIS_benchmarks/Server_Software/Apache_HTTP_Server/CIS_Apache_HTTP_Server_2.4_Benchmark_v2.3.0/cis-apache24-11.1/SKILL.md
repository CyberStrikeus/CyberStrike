---
name: cis-apache24-11.1
description: "Ensure SELinux Is Enabled in Enforcing Mode (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mac, mandatory-access-control]
cis_id: "11.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure SELinux Is Enabled in Enforcing Mode (Automated)

## Profile Applicability

- Level 2

## Description

SELinux (Security-Enhanced Linux) is a Linux kernel security module that provides mandatory access control security policies with type enforcement that are checked after the traditional discretionary access controls. It was created by the US National Security Agency and can enforce rules on files and processes in a Linux system, and restrict actions, based on defined policies.

## Rationale

Web applications and services continue to be one of the leading attack vectors for black-hat criminals to gain access to information and servers. The threat is high because web servers are often externally accessible and typically have the greatest share of server-side vulnerabilities. The SELinux mandatory access controls provide a much stronger security model which can be used to implement a deny-by-default model which only allows what is explicitly permitted.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Use the `sestatus` command to check that SELinux is enabled and that both the current mode and the configured mode are set to `enforcing`.

```bash
$ sestatus | grep -i mode
Current mode: enforcing
Mode from config file: enforcing
```

## Remediation

Perform the following to implement the recommended state:

If SELinux is not enabled in the configuration file, edit the file `/etc/selinux/config` and set the value of SELINUX as `enforcing` and reboot the system for the new configuration to be effective.

```
SELINUX=enforcing
```

If the current mode is not enforcing, and an immediate reboot is not possible, the current mode can be set to enforcing with the `setenable` command shown below.

```bash
# setenforce 1
```

## Default Value

SELinux is not enabled by default.

## References

1. https://en.wikipedia.org/wiki/Security-Enhanced_Linux
2. https://www.redhat.com/en/topics/linux/what-is-selinux

## CIS Controls

**v8:**

- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
- 6.8 Define and Maintain Role-Based Access Control
  - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently.

**v7:**

- 14.7 Enforce Access Control to Data through Automated Tools
  - Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.

## Profile

- Level 2
