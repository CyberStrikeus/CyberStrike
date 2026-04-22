---
name: cis-docker-v160-2.12
description: "Ensure that authorization for Docker client commands is enabled"
category: cis-docker
version: "1.6.0"
author: cyberstrike-official
tags: [cis, docker, daemon, authorization, access-control]
cis_id: "2.12"
cis_benchmark: "CIS Docker Benchmark v1.6.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that authorization for Docker client commands is enabled

**Profile Applicability:** Level 2 - Docker - Linux

**Assessment Status:** Manual

## Description

You should use native Docker authorization plugins or a third party authorization mechanism with the Docker daemon to manage access to Docker client commands.

## Rationale

Docker's out-of-the-box authorization model is currently "all or nothing". This means that any user with permission to access the Docker daemon can run any Docker client command. The same is true for remote users accessing Docker's API to contact the daemon. If you require greater access control, you can create authorization plugins and add them to your Docker daemon configuration. Using an authorization plugin, a Docker administrator can configure granular access policies for managing access to the Docker daemon.

Third party integrations of Docker may implement their own authorization models to require authorization with the Docker daemon outside of docker's native authorization plugin (i.e. Kubernetes, Cloud Foundry, Openshift).

## Impact

Each Docker command needs to pass through the authorization plugin mechanism. This may have a performance impact.

It may be possible to use alternative mechanisms that do not have this performance hit.

## Audit Procedure

To confirm this setting the dockerd start-up options and any settings in `/etc/docker/daemon.json` should be reviewed.
To review the dockerd startup options, use:

```bash
ps -ef | grep dockerd
```

You should ensure that the `--authorization-plugin` parameter is set as appropriate if you are using docker native authorization.
The contents of `/etc/docker/daemon.json` should also be reviewed.

## Remediation

Step 1: Install/Create an authorization plugin.
Step 2: Configure the authorization policy as desired.
Step 3: Start the docker daemon as below:

```bash
dockerd --authorization-plugin=<PLUGIN_ID>
```

## Default Value

By default, authorization plugins are not set up.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/#access-authorization
2. https://docs.docker.com/engine/extend/plugins_authorization/

## Additional Information

It should be noted that the native Docker authentication plugin is only one method of enforcing this control so other methods which could potentially be in use should be reviewed before assessing this as a pass or fail in an audit.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6 Access Control Management<br>Use processes and tools to create, assign, manage, and revoke access credentials and privileges for user, administrator, and service accounts for enterprise assets and software. |      |      |      |
| v7               | 16 Account Monitoring and Control<br>Account Monitoring and Control                                                                                                                                              |      |      |      |

## Profile/Assessment Status

**Profile:** Level 2 - Docker - Linux
**Assessment Status:** Manual
