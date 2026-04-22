---
name: cis-docker-v170-7.1
description: "Ensure that the minimum number of manager nodes have been created in a swarm"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, swarm, high-availability, manager-nodes]
cis_id: "7.1"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 7.1

## Profile Applicability

- **Level:** 1
- **Type:** Manual
- **Platform:** Docker Swarm

## Description

You should ensure that the minimum number of required manager nodes is created in a swarm.

## Rationale

Manager nodes within a swarm have control over the swarm and can change its configuration, including modifying security parameters. Having excessive manager nodes could render the swarm more susceptible to compromise.

If fault tolerance is not required in the manager nodes, a single node should be elected as a manger. If fault tolerance is required then the smallest odd number to achieve the appropriate level of tolerance should be configured. This should always be an odd number in order to ensure that a quorum is reached.

## Impact

None

## Audit Procedure

Run `docker info` and verify the number of managers.

```bash
docker info --format '{{ .Swarm.Managers }}'
```

Alternatively run the below command.

```bash
docker node ls | grep 'Leader'
```

## Remediation

If an excessive number of managers is configured, the excess nodes can be demoted to workers using the following command:

```bash
docker node demote <ID>
```

Where <ID> is the node ID value of the manager to be demoted.

## Default Value

Only a single manager is required to start a given cluster.

## References

1. https://docs.docker.com/engine/swarm/manage-nodes/
2. https://docs.docker.com/engine/swarm/admin_guide/#add-manager-nodes-for-fault-tolerance

## CIS Controls

**v8:**

- **4 Secure Configuration of Enterprise Assets and Software**
  - Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications).

**v7:**

- **5.1 Establish Secure Configurations**
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.
