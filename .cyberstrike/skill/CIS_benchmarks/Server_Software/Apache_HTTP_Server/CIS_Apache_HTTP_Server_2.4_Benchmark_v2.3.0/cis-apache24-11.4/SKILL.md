---
name: cis-apache24-11.4
description: "Ensure Only the Necessary SELinux Booleans are Enabled (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, selinux, mac, booleans]
cis_id: "11.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Only the Necessary SELinux Booleans are Enabled (Manual)

## Profile Applicability
- Level 2

## Description

SELinux booleans allow or disallow behavior specific to the Apache web server. Common examples include whether CGI execution is allowed, or if the httpd server is allowed to communicate with the current terminal (tty). Communication with the terminal, may be necessary for entering a passphrase during start up to decrypt a private key.

## Rationale

Enabling only the necessary httpd related booleans provides a defense in depth approach, that will deny actions that are not in use or expected.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Review the SELinux httpd booleans that are enabled to ensure only the necessary booleans are enabled for the current and the configured state. Due to the variety and complexity of web server usages and organizations needs, a preset recommendation of enabled booleans is not practical. Run either of the two commands below to show only the enabled httpd related booleans. The `getsebool` command is installed with the core SELinux, while the `semanage` command is an optional package; however, the `semanage` output includes descriptive text.

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

**v8:**
- 2.5 Allowlist Authorized Software
  - Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.
- 2.7 Allowlist Authorized Scripts
  - Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently.

**v7:**
- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile
- Level 2
