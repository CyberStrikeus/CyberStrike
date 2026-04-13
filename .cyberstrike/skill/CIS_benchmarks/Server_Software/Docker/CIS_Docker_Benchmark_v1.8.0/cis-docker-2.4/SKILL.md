---
name: cis-docker-2.4
description: "Ensure Docker is allowed to make changes to iptables"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, linux, containers, daemon-configuration, networking, iptables, firewall]
cis_id: "2.4"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Docker is allowed to make changes to iptables (Manual)

## Profile Applicability

• Level 1 - Docker - Linux

## Description

The iptables firewall is used to set up, maintain, and inspect the tables of IP packet filter rules within the Linux kernel. The Docker daemon should be allowed to make changes to the `iptables` ruleset.

## Rationale

Docker will never make changes to your system `iptables` rules unless you allow it to do so. If you do allow this, Docker server can automatically make any required changes. We recommended letting Docker make changes to `iptables` automatically in order to avoid networking misconfigurations that could affect the communication between containers and with the outside world. Additionally, this reduces the administrative overhead of updating `iptables` every time you add containers or modify networking options.

## Impact

The Docker daemon service requires iptables rules to be enabled before it starts. Any restarts of iptables during Docker daemon operation may result in losing Docker created rules. Adding iptables-persistent to your iptables install can assist with mitigation of this impact.

## Audit Procedure

To confirm this setting you should review the dockerd start-up options and the settings in `/etc/docker/daemon.json`.

To review the dockerd startup options, use:

```bash
grep "--iptables" /etc/docker/daemon.json
```

Ensure that the `--iptables` parameter is either not present or not set to `false`.

The contents of `/etc/docker/daemon.json` should also be reviewed for this setting.

## Remediation

Do not run the Docker daemon with `--iptables=false` parameter. For example, do not start the Docker daemon as below:

```bash
dockerd --iptables=false
```

## Default Value

By default, `iptables` is set to `true`.

## References

1. https://docs.docker.com/engine/reference/commandline/dockerd/
2. https://docs.docker.com/network/iptables/

## CIS Controls

**Controls Version:** v8

**Control:** 12.2 Establish and Maintain a Secure Network Architecture

Establish and maintain a secure network architecture. A secure network architecture must address segmentation, least privilege, and availability, at a minimum.

**IG 1:**
**IG 2:** ●
**IG 3:** ●

---

**Controls Version:** v7

**Control:** 4 Controlled Use of Administrative Privileges

Controlled Use of Administrative Privileges
