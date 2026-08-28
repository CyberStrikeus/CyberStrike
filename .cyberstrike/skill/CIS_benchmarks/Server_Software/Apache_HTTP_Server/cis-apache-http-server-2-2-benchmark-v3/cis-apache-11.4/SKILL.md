---
name: cis-apache-11.4
description: "Ensure Only the Necessary SELinux Booleans Are Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mandatory-access-control, mac]
cis_id: "11.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Only the Necessary SELinux Booleans Are Enabled

## Description

SELinux booleans allow or disallow behavior specific to the Apache web server. Common examples include whether CGI execution is allowed, or if the httpd server is allowed to communicate with the current terminal (`tty`). Communication with the terminal may be necessary for entering a passphrase during startup to decrypt a private key.

## Rationale

Enabling only the necessary httpd related booleans provides a defense in depth approach that will deny actions that are not in use or expected.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Review the SELinux httpd booleans that are enabled to ensure only the necessary booleans are enabled for the current and the configured state. Due to the variety and complexity of web server usages and organizational needs, a preset recommendation of enabled booleans is not practical. Run either of the two commands below to show only the enabled httpd related booleans. The `getsebool` command is installed with the core SELinux, while the `semanage` command is an optional package; however, the `semanage` output includes descriptive text.

```bash
# getsebool -a | grep httpd_ | grep '> on'
httpd_builtin_scripting --> on
httpd_dbus_avahi --> on
httpd_tty_comm --> on
httpd_unified --> on
```

Alternative using the `semanage` command.

```bash
# semanage boolean -l | grep httpd_ | grep -v '(off , off)'
httpd_enable_cgi (on , on) Allow httpd cgi support
httpd_dbus_avahi (on , on) Allow Apache to communicate with avahi service via dbus
httpd_unified (on , on) Unify HTTPD handling of all content files.
httpd_builtin_scripting (on , on) Allow httpd to use built in scripting (usually php)
```

```bash
httpd_tty_comm (on , on) Unify HTTPD to communicate with the terminal...
```

## Remediation

Perform the following to implement the recommended state:

To disable the SELinux httpd booleans that are determined to be unnecessary, use the `setsebool` command as shown below with the `-P` option to make the change persistent.

```bash
# setsebool -P httpd_enable_cgi off
# getsebool httpd_enable_cgi
httpd_enable_cgi --> off
```

## Default Value

SELinux is not enabled by default.

## References

1. https://access.redhat.com/documentation/en-US/Red_Hat_Enterprise_Linux/6/html/Security-Enhanced_Linux/sect-Security-Enhanced_Linux-Working_with_SELinux-Booleans.html

## CIS Controls

Version 6

18 Application Software Security
Application Software Security

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 2 | Not Scored
