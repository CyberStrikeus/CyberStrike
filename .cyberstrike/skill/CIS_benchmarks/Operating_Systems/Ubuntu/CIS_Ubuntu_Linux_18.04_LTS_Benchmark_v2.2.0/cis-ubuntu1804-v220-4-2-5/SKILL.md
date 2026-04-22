---
name: cis-ubuntu1804-v220-4-2-5
description: "Ensure sshd Ciphers are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.5

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

This variable limits the ciphers that SSH can use during communication.

## Rationale

Based on research conducted at various institutions, it was determined that the weights of symmetric encryption algorithms could be characterized and are related to the number of rounds and the block sizes. Weak ciphers that are used for authentication to the cryptographic module cannot be relied upon to provide confidentiality or integrity, and system data may be compromised.

The DES, Triple DES, and Blowfish ciphers, as used in SSH, have a birthday bound of approximately four billion blocks, which makes it easier for remote attackers to obtain clear text data via a birthday attack against a long-duration encrypted session (Sweet32 attack).

It is recommended that only FIPS 140-2 ciphers are used.

## Audit Procedure

### Command Line

Run the following command to verify that only approved ciphers are used:

```bash
sshd -T | grep -i ciphers
```

### Expected Result

Verify that output does not contain any of the following weak ciphers:

- `3des-cbc`
- `aes128-cbc`
- `aes192-cbc`
- `aes256-cbc`

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file and add/modify the `Ciphers` line to contain a comma separated list of the site approved ciphers.

Example:

```bash
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr
```

## Default Value

Ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com

## References

1. NIST SP 800-53 Rev. 5: AC-17(2), IA-5(1), SC-13

## CIS Controls

v8 - 3.10 Encrypt Sensitive Data in Transit - Encrypt sensitive data in transit.

v7 - 14.4 Encrypt All Sensitive Information in Transit - Encrypt all sensitive information in transit.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
