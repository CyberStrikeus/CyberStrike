---
name: cis-docker-5.3
description: "Ensure that, if applicable, SELinux security options are set"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, selinux, security, mac]
cis_id: "5.3"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3 Ensure that, if applicable, SELinux security options are set (Manual)

## Profile Applicability

- Level 2 - Docker - Linux

## Description

SELinux is an effective and easy-to-use Linux application security system. It is available by default on some Linux distributions such as Red Hat and Fedora.

## Rationale

SELinux provides a Mandatory Access Control (MAC) system that greatly augments the default Discretionary Access Control (DAC) model. You can therefore add an extra layer of safety to your containers by enabling SELinux on your Linux host.

## Impact

Any restrictions defined in the SELinux policy will be applied to your containers. It should be noted that if your SELinux policy is misconfigured, this may have an impact on the correct operation of the affected containers.

## Audit Procedure

You should run the following command

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: SecurityOpt={{ .HostConfig.SecurityOpt }} MountLabel={{ .MountLabel }} ProcessLabel={{ .ProcessLabel }}'
```

This command returns all the security options currently configured on the containers listed. Note that even if an empty `SecurityOpt` is returned, the `MountLabel` and `ProcessLabel` values will indicate if SELinux is in use.

## Remediation

If SELinux is applicable for your Linux OS, you should use it.

1. Set the SELinux State.
2. Set the SELinux Policy.
3. Create or import a SELinux policy template for Docker containers.
4. Start Docker in daemon mode with SELinux enabled. For example:

```bash
docker daemon --selinux-enabled
```

or by adding the following to the `daemon.json` configuration file:

```json
{
  "selinux-enabled": true
}
```

5. Start your Docker container using the security options. For example,

```bash
docker run --interactive --tty --security-opt label=level:TopSecret centos /bin/bash
```

## Default Value

By default, no SELinux security options are applied on containers.

## References

1. https://docs.docker.com/engine/security/#other-kernel-security-features
2. https://docs.docker.com/engine/reference/run/#security-configuration
3. https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux_atomic_host/7/html/container_security_guide/docker_selinux_security_policy

## CIS Controls

### v8

**10.5 Enable Anti-Exploitation Features**

Enable anti-exploitation features on enterprise assets and software, where possible, such as Microsoft® Data Execution Prevention (DEP), Windows® Defender Exploit Guard (WDEG), or Apple® System Integrity Protection (SIP) and Gatekeeper™.

### v7

**5.2 Maintain Secure Images**

Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.
