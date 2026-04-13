---
name: cis-docker-v170-5.2
description: "Ensure that, if applicable, an AppArmor Profile is enabled"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, apparmor]
cis_id: "5.2"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.2

## Profile Applicability
- Level 1 - Docker - Linux

## Description
AppArmor is an effective and easy-to-use Linux application security system. It is available on some Linux distributions by default, for example, on Debian and Ubuntu.

## Rationale
AppArmor protects the Linux OS and applications from various threats by enforcing a security policy which is also known as an AppArmor profile. You can create your own AppArmor profile for containers or use Docker's default profile. Enabling this feature enforces security policies on containers as defined in the profile.

## Impact
The container will have the security controls defined in the AppArmor profile. It should be noted that if the AppArmor profile is misconfigured, this may cause issues with the operation of the container.

## Audit Procedure

You should run the command below:

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: AppArmorProfile={{ .AppArmorProfile }}'
```

This command should return a valid AppArmor Profile for each container instance.

## Remediation

If AppArmor is applicable for your Linux OS, you should enable it.

1. Verify AppArmor is installed.
2. Create or import a AppArmor profile for Docker containers.
3. Enable enforcement of the policy.
4. Start your Docker container using the customized AppArmor profile. For example:

```bash
docker run --interactive --tty --security-opt="apparmor:PROFILENAME" ubuntu /bin/bash
```

Alternatively, Docker's default AppArmor policy can be used.

## Default Value
By default, the `docker-default` AppArmor profile is applied to running containers. The Docker binary generates this profile and then loads it into the kernel.

## References
1. https://docs.docker.com/engine/security/apparmor/
2. https://docs.docker.com/engine/reference/run/#security-configuration
3. https://docs.docker.com/engine/security/#other-kernel-security-features

## CIS Controls

**v8:**
- 10.5 Enable Anti-Exploitation Features - Enable anti-exploitation features on enterprise assets and software, where possible, such as Microsoft® Data Execution Prevention (DEP), Windows® Defender Exploit Guard (WDEG), or Apple® System Integrity Protection (SIP) and Gatekeeper™.

**v7:**
- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status
Manual
