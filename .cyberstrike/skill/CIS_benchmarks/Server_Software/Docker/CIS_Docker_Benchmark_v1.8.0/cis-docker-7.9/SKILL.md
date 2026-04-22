---
name: cis-docker-7.9
description: "Ensure that management plane traffic is separated from data plane traffic"
category: cis-docker
version: "1.8.0"
author: cyberstrike-official
tags: [cis, docker, swarm, orchestration, networking]
cis_id: "7.9"
cis_benchmark: "CIS Docker Benchmark v1.8.0"
tech_stack: [linux, docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.9 Ensure that management plane traffic is separated from data plane traffic (Manual)

## Profile Applicability

- Level 1 - Docker Swarm

## Description

You should separate management plane traffic from data plane traffic.

## Rationale

Separating management plane traffic from data plane traffic ensures that these types of traffic are segregated from each other. These traffic flows can then be individually monitored and tied to different traffic control policies and monitoring. This also ensures that the management plane is always reachable even if there is a great deal of traffic on the data plane.

## Impact

This requires two network interfaces per node.

## Audit Procedure

You should run the command below on each swarm node and ensure that the management plane address is not the same as the data plane address.

```
docker node inspect  --format '{{ .Status.Addr }}' self
```

## Remediation

You should initialize the swarm with dedicated interfaces for management and data planes respectively.

For example,

```
docker swarm init --advertise-addr=192.168.0.1 --data-path-addr=17.1.0.3
```

## Default Value

By default, data plane traffic is not separated from management plane traffic.

## References

1. https://docs.docker.com/engine/reference/commandline/swarm_init/#--data-path-addr

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 12 Network Infrastructure Management<br>Establish, implement, and actively manage (track, report, correct) network devices, in order to prevent attackers from exploiting vulnerable network services and access points.                     |      |      |      |
| v7               | 14.1 Segment the Network Based on Sensitivity<br>Segment the network based on the label or classification level of the information stored on the servers, locate all sensitive information on separated Virtual Local Area Networks (VLANs). |      | ●    | ●    |
