---
name: cis-docker-v170-5.14
description: "Ensure that incoming container traffic is bound to a specific host interface"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, runtime, configuration, network-binding]
cis_id: "5.14"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 5.14

## Profile Applicability

- Level 1 - Docker - Linux

## Description

By default, Docker containers can make connections to the outside world, but the outside world cannot connect to containers and each outgoing connection will appear to originate from one of the host machine's own IP addresses. You should only allow container services to be contacted through a specific external interface on the host machine.

## Rationale

If you have multiple network interfaces on your host machine, the container can accept connections on exposed ports on any network interface. This might not be desirable and may not be secured. In many cases a specific, desired interface is exposed externally and services such as intrusion detection, intrusion prevention, firewall, load balancing, etc. are all run by intention there to screen incoming public traffic. You should therefore not accept incoming connections on any random interface, but only the one designated for this type of traffic.

## Impact

None.

## Audit Procedure

You should list all running instances of containers and their port mappings by executing the command below:

```bash
docker ps --quiet | xargs docker inspect --format='{{ .Id }}: Ports={{ .NetworkSettings.Ports }}'
```

Then review the list and ensure that the exposed container ports are bound to a specific interface and not to the wildcard IP address `0.0.0.0`.

For example, if the command above returns results below, this is non-compliant and the container can accept connections on exposed port 49153 on any host interface `0.0.0.0`.

`Ports=map[443/tcp:<nil> 80/tcp:[map[HostPort:49153 HostIp:0.0.0.0]]]`

However, if the exposed port is bound to a specific interface on the host as below, then this is configured in line with good security practice.

`Ports=map[443/tcp:<nil> 80/tcp:[map[HostIp:10.2.3.4 HostPort:49153]]]`

## Remediation

You should bind the container port to a specific host interface on the desired host port. For example,

```bash
docker run --detach --publish 10.2.3.4:49153:80 nginx
```

In the example above, the container port `80` is bound to the host port on `49153` and would accept incoming connection only from the `10.2.3.4` external interface.

## Default Value

By default, Docker exposes the container ports on `0.0.0.0`, the wildcard IP address that will match any possible incoming network interface on the host machine.

## References

1. https://docs.docker.com/network/

## CIS Controls

**v8:**

- 4.4 Implement and Manage a Firewall on Servers - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent.

**v7:**

- 11 Secure Configuration for Network Devices, such as Firewalls, Routers and Switches - Secure Configuration for Network Devices, such as Firewalls, Routers and Switches

## Assessment Status

Manual
