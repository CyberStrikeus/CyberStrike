---
name: cis-apache-11.1
description: "Ensure SELinux Is Enabled in Enforcing Mode"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mandatory-access-control, mac]
cis_id: "11.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure SELinux Is Enabled in Enforcing Mode

## Description

SELinux (Security-Enhanced Linux) is a Linux kernel security module that provides mandatory access control security policies with type enforcement that are checked after the traditional discretionary access controls. It was created by the US National Security Agency and can enforce rules on files and processes in a Linux system, and restrict actions, based on defined policies.

## Rationale

Web applications and services continue to be one of the leading attack vectors for black-hat criminals to gain access to information and servers. The threat is high because web servers are often externally accessible and typically have the greatest share of server-side vulnerabilities. The SELinux mandatory access controls provide a much stronger security model which can be used to implement a deny-by-default model only allowing what is explicitly permitted.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Use the `sestatus` command to check that SELinux is enabled and that both the current mode and the configured mode are set to `enforcing`.

```bash
$ sestatus | grep -i mode
Current mode: enforcing
Mode from config file: enforcing
```

## Remediation

Perform the following to implement the recommended state:

If SELinux is not enabled in the configuration file, edit the file `/etc/selinux/config` and set the value of SELINUX as `enforcing`. Reboot the system for the new configuration to be effective.

```bash
SELINUX=enforcing
```

If the current mode is not `enforcing` and an immediate reboot is not possible, the current mode can be set to `enforcing` with the command shown below.

```bash
# setenforce 1
```

## Default Value

SELinux is not enabled by default.

## References

1. https://en.wikipedia.org/wiki/Security-Enhanced_Linux

## CIS Controls

Version 6

14.4 Protect Information With Access Control Lists
All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

Version 7

14.7 Enforce Access Control to Data through Automated Tools
Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.

## Profile

Level 2 | Scored
