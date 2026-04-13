---
name: cis-cassandra40-v130-3.5
description: "Ensure that Cassandra only listens for network connections on authorized interfaces"
category: cis-cassandra
version: "1.3.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, passwords, network]
cis_id: "3.5"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.3.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.5 Ensure that Cassandra only listens for network connections on authorized interfaces

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description

When `listen_address` is blank and `listen_interface` is commented out, this will be set automatically by `InetAddress.getLocalHost()`. Presuming the node is configured correctly, e.g. hostname, name resolution, etc., this will configure the node to use the address associated with the hostname. The `listen_address` must not be set to `0.0.0.0`.

## Rationale

Setting the address or interface to bind to will tell other Cassandra nodes to which address or interface to connect. This must be changed from the default in order for multiple nodes to be able to communicate.

## Audit

Check the value of `listen_address` or `listen_interface` in the `cassandra.yaml`. If `listen_address` is set `0.0.0.0` or a non-authorized address or interface is specified, this is a finding.

Run these command to assist:

```bash
cat cassandra.yaml | grep -in "listen_address:" | grep "0.0.0.0"
cat cassandra.yaml | grep -in "listen_address:"
cat cassandra.yaml | grep -in "listen_interface:"
```

## Remediation

Set the `listen_address` or `listen_interface`, not both, in the `cassandra.yaml` to an authorized address or interface.

## Default Value

```
listen_address: localhost

listen_interface: eth0, but is commented out by default.
```

## References

1. http://cassandra.apache.org/doc/3.11/configuration/cassandra_config_file.html#listen-address
2. http://cassandra.apache.org/doc/3.11/configuration/cassandra_config_file.html#listen-interface

## CIS Controls

**Controls Version v8:**
- 4.4 Implement and Manage a Firewall on Servers
  - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent.

**Controls Version v7:**
- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile
- Level 1 | Manual
