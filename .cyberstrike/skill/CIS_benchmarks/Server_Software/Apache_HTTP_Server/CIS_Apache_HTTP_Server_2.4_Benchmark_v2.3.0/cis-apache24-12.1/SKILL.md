---
name: cis-apache24-12.1
description: "Ensure the AppArmor Framework Is Enabled (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, apparmor, mac, mandatory-access-control]
cis_id: "12.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the AppArmor Framework Is Enabled (Automated)

## Profile Applicability
- Level 2

## Description

AppArmor is a Linux kernel security module that provides a named based mandatory access control with security policies. AppArmor can enforce rules on programs for file access and network connections and restrict actions based on defined policies.

## Rationale

Web applications and web services continue to be one of the leading attack vectors for black-hat criminals to gain access to information and servers. The threat is high because web servers are often externally accessible and typically have the greatest share of server-side vulnerabilities. The AppArmor mandatory access controls provide a much stronger security model which can be used to implement a deny-by-default model which only allows what is explicitly permitted.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Use the aa-status command with the `--enabled` option to check that AppArmor is enabled. If AppArmor is enabled the command will return a zero (0) exit code for success. The `&& echo Enabled` is added to the command below to provide positive feedback. If no text is echoed, then AppArmor is not enabled.

```bash
# aa-status --enabled && echo Enabled
Enabled
```

## Remediation

Perform the following to implement the recommended state:

- If the aa-status command is not found, then the AppArmor package is not installed and needs to be installed using the appropriate the Linux distribution package management. For example:
  - `# apt-get install apparmor`
  - `# apt-get install libapache2-mod-apparmor`
- To enable the AppArmor framework run the `init.d` script as shown below.
  - `# /etc/init.d/apparmor start`

## Default Value

AppArmor is enabled by default.

## References

1. https://help.ubuntu.com/community/AppArmor

## CIS Controls

**v8:**
- 2.5 Allowlist Authorized Software
  - Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.
- 2.6 Allowlist Authorized Libraries
  - Use technical controls to ensure that only authorized software libraries, such as specific .dll, .ocx, .so, etc., files, are allowed to load into a system process. Block unauthorized libraries from loading into a system process. Reassess bi-annually, or more frequently.
- 2.7 Allowlist Authorized Scripts
  - Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently.

**v7:**
- 2.7 Utilize Application Whitelisting
  - Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets.

## Profile
- Level 2
