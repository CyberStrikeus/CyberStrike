---
name: cis-ubuntu1804-v220-4-2-14
description: "Ensure sshd MACs are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.14"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.14

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

This variable limits the types of MAC algorithms that SSH can use during communication.

## Rationale

MD5 and 96-bit MAC algorithms are considered weak and have been shown to increase exploitability without any practical increase in performance. Their use diminishes the security of the SSH connection. Weak MAC algorithms that should not be used include `hmac-md5`, `hmac-md5-96`, `hmac-sha1-96`, `umac-64@openssh.com`, `hmac-md5-etm@openssh.com`, `hmac-md5-96-etm@openssh.com`, `hmac-sha1-96-etm@openssh.com`, `umac-64-etm@openssh.com`.

## Audit Procedure

### Command Line

Run the following command and verify that only approved MACs are used:

```bash
sshd -T | grep -i macs
```

### Expected Result

Verify that output does not contain any of the following weak MACs:

- `hmac-md5`
- `hmac-md5-96`
- `hmac-sha1-96`
- `umac-64@openssh.com`
- `hmac-md5-etm@openssh.com`
- `hmac-md5-96-etm@openssh.com`
- `hmac-sha1-96-etm@openssh.com`
- `umac-64-etm@openssh.com`

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file and add/modify the `MACs` line to contain a comma separated list of the site approved MACs.

Example:

```bash
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256
```

## References

1. NIST SP 800-53 Rev. 5: AC-17(2), IA-5(1), SC-13

## CIS Controls

v8 - 3.10 Encrypt Sensitive Data in Transit - Encrypt sensitive data in transit.

v7 - 14.4 Encrypt All Sensitive Information in Transit.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
