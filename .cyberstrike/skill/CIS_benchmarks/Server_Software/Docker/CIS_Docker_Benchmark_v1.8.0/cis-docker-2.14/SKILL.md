---
name: cis-docker-2.14
description: "Ensure centralized and remote logging is configured"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, logging, siem]
cis_id: "2.14"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure centralized and remote logging is configured (Manual)

## Profile Applicability

• Level 2 - Docker - Linux

## Description

Docker supports various logging mechanisms. A preferable method for storing logs is one that supports centralized and remote management.

## Rationale

Centralized and remote logging ensures that all important log records are safe even in the event of a major data availability issue. Docker supports various logging methods and you should use the one that best corresponds to your IT security policy.

## Impact

None.

## Audit Procedure

Run `docker info` and ensure that the `Logging Driver` property set as appropriate.

```bash
docker info --format '{{ .LoggingDriver }}'
```

Alternatively, the below command would give you the `--log-driver` setting. If configured you should ensure that it is set appropriately.

```bash
grep "--log-driver" /etc/docker/daemon.json
```

The contents of `/etc/docker/daemon.json` should also be reviewed for this setting.

## Remediation

**Step 1:** Set up the desired log driver following its documentation.

**Step 2:** Start the docker daemon using that logging driver.

For example:

```bash
dockerd --log-driver=syslog --log-opt syslog-address=tcp://192.xxx.xxx.xxx
```

## Default Value

By default, container logs are maintained as json files

## References

1. https://docs.docker.com/config/containers/logging/configure/

## CIS Controls

**Controls Version:** v8

**Control:** 8.1 Establish and Maintain an Audit Log Management Process

Establish and maintain an audit log management process that defines the enterprise's logging requirements. At a minimum, address the collection, review, and retention of audit logs for enterprise assets. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**IG 1:** ●
**IG 2:** ●
**IG 3:** ●

---

**Control:** 8.9 Centralize Audit Logs

Centralize, to the extent possible, audit log collection and retention across enterprise assets.

**IG 1:**
**IG 2:** ●
**IG 3:** ●

---

**Controls Version:** v7

**Control:** 6.6 Deploy SIEM or Log Analytic tool

Deploy Security Information and Event Management (SIEM) or log analytic tool for log correlation and analysis.

**IG 1:**
**IG 2:** ●
**IG 3:** ●

---

**Control:** 6.8 Regularly Tune SIEM

On a regular basis, tune your SIEM system to better identify actionable events and decrease event noise.

**IG 1:**
**IG 2:**
**IG 3:** ●
