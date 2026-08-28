---
name: cis-ubuntu1804-v220-4-2-11
description: "Ensure sshd KexAlgorithms is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.11"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.11

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Key exchange is any method in cryptography by which cryptographic keys are exchanged between two parties, allowing use of a cryptographic algorithm. If the sender and receiver wish to exchange encrypted messages, each must be equipped to encrypt messages to be sent and decrypt messages received.

## Rationale

Key exchange methods that are considered weak should be removed. A key exchange method may be weak because too few bits are used, or the hashing algorithm is considered too weak. Using weak algorithms could expose connections to man-in-the-middle attacks.

## Audit Procedure

### Command Line

Run the following command and verify that only approved key exchange algorithms are used:

```bash
sshd -T | grep -i kexalgorithms
```

### Expected Result

Verify that output does not contain any of the following weak key exchange algorithms:

- `diffie-hellman-group1-sha1`
- `diffie-hellman-group14-sha1`
- `diffie-hellman-group-exchange-sha1`

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file and add/modify the `KexAlgorithms` line to contain a comma separated list of the site approved key exchange algorithms.

Example:

```bash
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256,ecdh-sha2-nistp384,ecdh-sha2-nistp521,diffie-hellman-group-exchange-sha256,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512,diffie-hellman-group14-sha256
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
