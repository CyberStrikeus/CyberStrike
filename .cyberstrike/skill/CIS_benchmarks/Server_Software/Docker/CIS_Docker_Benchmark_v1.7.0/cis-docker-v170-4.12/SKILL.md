---
name: cis-docker-v170-4.12
description: "Ensure all signed artifacts are validated"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, artifact-validation]
cis_id: "4.12"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-345]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.12

## Profile Applicability
- Level 1 - Docker - Linux

## Description
Validate artifacts signatures before uploading to the package registry.

## Rationale
Cryptographic signature is a tool to verify artifact authenticity. Every artifact is supposed to be signed by its creator in order to verify that it wasn't compromised until it got to the client. Validating artifact signature before delivering it is another level of protection, which checks that the signature hasn't been changed, which means that no one tried or succeeded in tampering with the artifact. That sets trust between the supplier and the client.

## Audit Procedure

Ensure every artifact in the package has been validated with its signature.

## Remediation

Validate every artifact with its signature. It is recommended to do so automatically.

## CIS Controls

**v8:**
- 2.7 Allowlist Authorized Scripts - Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently.

**v7:**
- 2.7 Utilize Application Whitelisting - Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets.

## Assessment Status
Manual
