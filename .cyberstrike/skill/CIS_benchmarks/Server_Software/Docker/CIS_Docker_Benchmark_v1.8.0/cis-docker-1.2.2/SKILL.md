---
name: cis-docker-1.2.2
description: "Ensure that the version of Docker is up to date"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, host-configuration, auditing, patching]
cis_id: "1.2.2"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that the version of Docker is up to date (Manual)

## Description

There are frequent releases for Docker software that address security vulnerabilities, product bugs, and bring in new functionality. You should be aware of these frequent releases and upgrade as often as necessary.

## Rationale

By staying up to date with Docker releases, vulnerabilities in the Docker software can be mitigated. An educated attacker may exploit known vulnerabilities when attempting to attain access or elevate privileges. Not installing regular Docker updates may inadvertently expose you to elevated risk of compromise.

## Impact

You should be aware that third party products that leverage Docker may not have a support matrix that includes the latest Docker version. You should verify the compatibility of the products before upgrading Docker.

## Audit

Execute the following command to verify that the installed Docker version is up to date:

```bash
docker version
```

You should then compare the returned Docker version with the latest available version which can be found at the Docker GitHub releases page (https://github.com/moby/moby/releases/latest) for docker-ce, or at Docker Enterprise Edition release notes page for docker-ee.

## Remediation

You should keep a regular track of Docker releases and update to the latest version as necessary. You should also maintain the currency of Docker updates in line with your organization's Docker environment update frequency and configuration management policy.

## Default Value

Not Applicable

## References

1. https://github.com/moby/moby/releases/latest
2. https://docs.docker.com/engine/installation/
3. https://docs.docker.com/engine/release-notes/

## CIS Controls

**Controls Version | Control | IG 1 | IG 2 | IG 3**

v8 | 7.1 Establish and Maintain a Vulnerability Management Process
Establish and maintain a documented vulnerability management process for enterprise assets. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard. | ● | ● | ●

v7 | 3.4 Deploy Automated Operating System Patch Management Tools
Deploy automated software update tools in order to ensure that the operating systems are running the most recent security updates provided by the software vendor. | ● | ● | ●

v7 | 3.5 Deploy Automated Software Patch Management Tools
Deploy automated software update tools in order to ensure that third-party software on all systems is running the most recent security updates provided by the software vendor. | ● | ● | ●

## Profile

• Level 1 - Docker - Linux
