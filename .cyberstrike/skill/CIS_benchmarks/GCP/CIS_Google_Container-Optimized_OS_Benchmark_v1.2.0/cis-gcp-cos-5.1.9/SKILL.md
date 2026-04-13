---
name: cis-gcp-cos-5.1.9
description: "Ensure SSH HostbasedAuthentication is disabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config, authentication]
cis_id: "5.1.9"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.9 Ensure SSH HostbasedAuthentication is disabled (Automated)

## Description

The `HostbasedAuthentication` parameter specifies if authentication is allowed through trusted hosts via the user of `.rhosts`, or `/etc/hosts.equiv`, along with successful public key client host authentication. This option only applies to SSH Protocol Version 2.

## Rationale

Even though the `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, disabling the ability to use `.rhosts` files in SSH provides an additional layer of protection.

## Audit Procedure

Run the following command and verify that output matches:

```bash
# sshd -T | grep hostbasedauthentication

HostbasedAuthentication no
```

## Expected Result

Output should show `HostbasedAuthentication no`.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
HostbasedAuthentication no
```

## Default Value

HostbasedAuthentication no

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.3 Require MFA for Externally-Exposed Applications | | x | x |
| v7 | 16.3 Require Multi-factor Authentication | | x | x |

## Profile

- Level 1 - Server
