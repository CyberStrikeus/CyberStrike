---
name: cis-apache-12.1
description: "Ensure the AppArmor Framework Is Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, apparmor, mandatory-access-control, mac]
cis_id: "12.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the AppArmor Framework Is Enabled

## Description

AppArmor is a Linux kernel security module that provides a named based mandatory access control with security policies. AppArmor can enforce rules on programs for file access and network connections and restrict actions based on defined policies.

## Rationale

Web applications and web services continue to be one of the leading attack vectors for criminals to gain access to information and servers. The threat is high because web servers are often externally accessible and typically have the greatest share of server-side vulnerabilities. The AppArmor mandatory access controls provide a much stronger security model which can be used to implement a deny-by-default model only allowing what is explicitly permitted.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Use the aa-status command with the `--enabled` option to check that AppArmor is enabled. If AppArmor is enabled, the command will return a zero (0) exit code for success. The `&&echo Enabled` is added to the command below to provide positive feedback. If no text is echoed, AppArmor is not enabled.

```bash
# aa-status --enabled && echo Enabled
Enabled
```

## Remediation

Perform the following to implement the recommended state:

- If the `aa-status` command is not found, then the AppArmor package is not installed and needs to be installed using the appropriate Linux distribution package management. For example:

```bash
# apt-get install apparmor
# apt-get install libapache2-mod-apparmor
```

- To enable the AppArmor framework, run the `init.d` script as shown below.

```bash
# /etc/init.d/apparmor start
```

## Default Value

AppArmor is enabled by default.

## References

1. https://help.ubuntu.com/community/AppArmor

## CIS Controls

Version 6

2.2 Deploy Application Whitelisting
Deploy application whitelisting technology that allows systems to run software only if it is included on the whitelist and prevents execution of all other software on the system. The whitelist may be very expansive (as is available from commercial whitelist vendors), so that users are not inconvenienced when using common software. Or, for some special-purpose systems (which require only a small number of programs to achieve their needed business functionality), the whitelist may be quite narrow.

Version 7

2.7 Utilize Application Whitelisting
Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets.

## Profile

Level 2 | Scored
