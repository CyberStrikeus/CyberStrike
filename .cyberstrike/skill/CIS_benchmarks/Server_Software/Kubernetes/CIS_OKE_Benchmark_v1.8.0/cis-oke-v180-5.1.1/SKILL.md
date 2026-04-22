---
name: cis-oke-v180-5.1.1
description: "Oracle Cloud Security Penetration and Vulnerability Testing (Manual)"
category: cis-oke
version: "1.8.0"
author: cyberstrike-official
tags:
  [
    cis,
    oke,
    kubernetes,
    oci,
    managed-services,
    image-registry,
    image-scanning,
    penetration-testing,
    vulnerability-testing,
  ]
cis_id: "5.1.1"
cis_benchmark: "CIS Oracle Cloud Infrastructure Container Engine for Kubernetes (OKE) Benchmark v1.8.0"
tech_stack: [kubernetes, oci, oke]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1 Oracle Cloud Security Penetration and Vulnerability Testing (Manual)

## Profile Applicability

- Level 1

## Description

Oracle regularly performs penetration and vulnerability testing and security assessments against the Oracle Cloud infrastructure, platforms, and applications. These tests are intended to validate and improve the overall security of Oracle Cloud services.

## Rationale

Vulnerabilities in software packages can be exploited by hackers or malicious users to obtain unauthorized access to local cloud resources. Oracle Cloud Container Analysis and other third party products allow images stored in Oracle Cloud to be scanned for known vulnerabilities.

## Impact

None.

## Audit

As a service administrator, you can run tests for some Oracle Cloud services. Before running the tests, you must first review the Oracle Cloud Testing Policies section. Follow the steps below to notify Oracle of a penetration and vulnerability test.

## Remediation

As a service administrator, you can run tests for some Oracle Cloud services. Before running the tests, you must first review the Oracle Cloud Testing Policies section.

**Note:** You must have an Oracle Account with the necessary privileges to file service maintenance requests, and you must be signed in to the environment that will be the subject of the penetration and vulnerability testing.

Submit a Cloud Security Testing Notification via the Oracle Cloud Console.

## References

1. https://docs.cloud.oracle.com/en-us/iaas/Content/Security/Concepts/security_testing-policy.htm

## CIS Controls

| Controls Version | Control                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 7.6 Perform Automated Vulnerability Scans of Externally-Exposed Enterprise Assets |      | x    | x    |
| v7               | 3 Continuous Vulnerability Management                                             |      |      |      |
| v7               | 3.1 Run Automated Vulnerability Scanning Tools                                    |      | x    | x    |
| v7               | 3.2 Perform Authenticated Vulnerability Scanning                                  |      | x    | x    |
