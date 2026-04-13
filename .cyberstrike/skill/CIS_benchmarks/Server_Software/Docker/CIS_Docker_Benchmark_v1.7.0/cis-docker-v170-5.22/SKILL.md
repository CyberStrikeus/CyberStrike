---
name: cis-docker-v170-5.22
description: "Ensure the default seccomp profile is not Disabled"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, seccomp, syscalls]
cis_id: "5.22"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.22

## Profile Applicability
- **Level:** 1
- **Type:** Manual
- **Platform:** Docker - Linux

## Description

Seccomp filtering provides a means for a process to specify a filter for incoming system calls. The default Docker seccomp profile works on a whitelist basis and allows for a large number of common system calls, whilst blocking all others. This filtering should not be disabled unless it causes a problem with your container application usage.

## Rationale

A large number of system calls are exposed to every userland process with many of them going unused for the entire lifetime of the process. Most of applications do not need all these system calls and would therefore benefit from having a reduced set of available system calls. Having a reduced set of system calls reduces the total kernel surface exposed to the application and thus improvises application security.

## Impact

With Docker 1.10 and greater, the default seccomp profile blocks syscalls, regardless of `--cap-add` passed to the container. You should create your own custom seccomp profile in such cases. You may also disable the default seccomp profile by passing `--security-opt=seccomp:unconfined` on `docker run`.

## Audit Procedure

You should run the following command:

```bash
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: SecurityOpt={{ .HostConfig.SecurityOpt }}'
```

This should return either `<no value>` or your modified seccomp profile. If it returns `[seccomp:unconfined]`, the container is running without any seccomp profiles and is therefore not configured in line with good security practice.

## Remediation

By default, seccomp profiles are enabled. You do not need to do anything unless you want to modify and use a modified seccomp profile.

## Default Value

When you run a container, it uses the default profile unless you override it with the `--security-opt` option.

## References

1. https://docs.docker.com/engine/reference/run/#security-configuration
2. https://github.com/moby/moby/blob/master/profiles/seccomp/default.json
3. https://docs.docker.com/engine/security/seccomp/
4. https://www.kernel.org/doc/Documentation/prctl/seccomp_filter.txt

## CIS Controls

**v8:**
- **4.4 Implement and Manage a Firewall on Servers**
  - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent.

**v7:**
- **9.5 Implement Application Firewalls**
  - Place application firewalls in front of any critical servers to verify and validate the traffic going to the server. Any unauthorized traffic should be blocked and logged.
