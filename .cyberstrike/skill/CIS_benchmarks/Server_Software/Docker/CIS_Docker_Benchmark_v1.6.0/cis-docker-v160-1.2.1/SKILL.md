---
name: cis-docker-v160-1.2.1
description: "Ensure the container host has been Hardened"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, host-configuration, hardening, security-baseline, linux]
cis_id: "1.2.1"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.6.0 - 1.2.1

## Profile Applicability

N/A (General Recommendation)

## Description

A container host is able to run one or more containers. It is of utmost importance to harden the host to mitigate host security misconfiguration.

## Rationale

You should follow infrastructure security best practices and harden your host OS. Keeping the host system hardened will ensure that host vulnerabilities are mitigated. Not hardening the host system could lead to security exposures and breaches.

## Impact

None.

## Audit Procedure

Ensure that the host specific security guidelines are followed. Ask the system administrators which security benchmark the current host system should currently be compliant with and check that security standards associated with this standard are currently in place.

## Remediation

You may consider various CIS Security Benchmarks for your container host. If you have other security guidelines or regulatory requirements to adhere to, please follow them as suitable in your environment.

## Default Value

By default, the host has factory setting and is not hardened.

## References

1. https://docs.docker.com/engine/security/
2. https://www.cisecurity.org/cis-benchmarks/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, or SaaS components. Do not allow in-house developed software to weaken configuration hardening. |      | ●    | ●    |
| v7               | 5 Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers<br>Secure Configuration for Hardware and Software on Mobile Devices, Laptops, Workstations and Servers                                                                                                                                                                                                                                  |      |      |      |

## Assessment Status

Manual

## Additional Information

N/A
