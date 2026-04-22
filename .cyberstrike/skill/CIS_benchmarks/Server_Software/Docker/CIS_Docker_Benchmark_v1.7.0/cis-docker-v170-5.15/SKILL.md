---
name: cis-docker-v170-5.15
description: "Ensure that the 'on-failure' container restart policy is set to '5'"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, restart-policy]
cis_id: "5.15"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.15

## Profile Applicability

- Level 1 - Docker - Linux

## Description

By using the `--restart` flag in the `docker run` command you can specify a restart policy for how a container should or should not be restarted on exit. You should choose the `on-failure` restart policy and limit the restart attempts to 5.

## Rationale

If you indefinitely keep trying to start the container, it could possibly lead to a denial of service on the host. It could be an easy way to do a distributed denial of service attack especially if you have many containers on the same host. Additionally, ignoring the exit status of the container and always attempting to restart the container, leads to non-investigation of the root cause behind containers getting terminated. If a container gets terminated, you should investigate the reason behind it instead of just attempting to restart it indefinitely. You should use the `on-failure` restart policy to limit the number of container restarts to a maximum of 5 attempts.

## Impact

If this option is set, a container will only attempt to restart itself 5 times.

## Audit Procedure

You should use the command below

```bash
docker ps --quiet --all | xargs docker inspect --format='{{ .Id }}: RestartPolicyName={{ .HostConfig.RestartPolicy.Name }} MaximumRetryCount={{ .HostConfig.RestartPolicy.MaximumRetryCount }}'
```

If this command returns `RestartPolicyName=always`, then the system is not configured optimally.

If the above command returns `RestartPolicyName=no` or just `RestartPolicyName=`, then restart policies are not being used and the container would never be restarted automatically. Whilst this may be a secure option, it is not the best option from a usability standpoint.

If the above command returns `RestartPolicyName=on-failure`, then verify that the number of restart attempts is set to 5 or less by looking at `MaximumRetryCount`.

## Remediation

If you wish a container to be automatically restarted, a sample command is as below:

```bash
docker run --detach --restart=on-failure:5 nginx
```

## Default Value

By default, containers are not configured with restart policies.

## References

1. https://docs.docker.com/engine/reference/commandline/run/#restart-policies---restart

## CIS Controls

**v8:**

- 4 Secure Configuration of Enterprise Assets and Software - Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile, network devices, non-computing/IoT devices, and servers) and software (operating systems and applications).

**v7:**

- 5.2 Maintain Secure Images - Maintain secure images or templates for all systems in the enterprise based on the organization's approved configuration standards. Any new system deployment or existing system that becomes compromised should be imaged using one of those images or templates.

## Assessment Status

Manual
