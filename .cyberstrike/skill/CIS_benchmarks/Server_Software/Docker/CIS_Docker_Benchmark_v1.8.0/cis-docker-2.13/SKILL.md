---
name: cis-docker-2.13
description: "Ensure that authorization for Docker client commands is enabled"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, authorization, access-control]
cis_id: "2.13"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that authorization for Docker client commands is enabled (Manual)

## Profile Applicability

• Level 2 - Docker - Linux

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

**Step 1:** Install/Create an authorization plugin.

**Step 2:** Configure the authorization policy as desired.

**Step 3:** Start the docker daemon as below:

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

**Controls Version:** v8

**Control:** 6 Access Control Management

Use processes and tools to create, assign, manage, and revoke access credentials and privileges for user, administrator, and service accounts for enterprise assets and software.

**IG 1:**
**IG 2:**
**IG 3:**

---

**Controls Version:** v7

**Control:** 16 Account Monitoring and Control

Account Monitoring and Control
