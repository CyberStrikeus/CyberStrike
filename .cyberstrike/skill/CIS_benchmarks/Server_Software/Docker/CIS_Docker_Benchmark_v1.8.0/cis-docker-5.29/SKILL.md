---
name: cis-docker-5.29
description: "Ensure that the PIDs cgroup limit is used"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, runtime, cgroup]
cis_id: "5.29"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.29 Ensure that the PIDs cgroup limit is used (Manual)

## Profile Applicability

- Level 1 - Docker - Linux

## Description

You should use the `--pids-limit` flag at container runtime.

## Rationale

Attackers could launch a fork bomb with a single command inside the container. This fork bomb could crash the entire system and would require a restart of the host to make the system functional again. Using the PIDs cgroup parameter `--pids-limit` would prevent this kind of attack by restricting the number of forks that can happen inside a container within a specified time frame.

## Impact

Set the PIDs limit value as appropriate. Incorrect values might leave containers unusable.

## Audit Procedure

You should run the command below and ensure that `PidsLimit` is not set to 0 or -1. A `PidsLimit` of 0 or -1 means that any number of processes can be forked concurrently inside the container.

```
docker ps --quiet --all | xargs docker inspect --format '{{ .Id }}: PidsLimit={{ .HostConfig.PidsLimit }}'
```

## Remediation

Use `--pids-limit` flag with an appropriate value when launching the container. For example:

```
docker run -it --pids-limit 100 <Image ID>
```

In the above example, the number of processes allowed to run at any given time is set to 100. After a limit of 100 concurrently running processes is reached, Docker would restrict any new process creation.

## Default Value

The Default value for `--pids-limit` is 0 which means there is no restriction on the number of forks. Note that the PIDs cgroup limit works only for kernel versions 4.3 and higher.

## References

1. https://docs.docker.com/engine/reference/commandline/run/

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software<br>Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications).   |      |      |      |
| v7               | 5.2 Maintain Secure Images<br>Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates. |      | ●    | ●    |
