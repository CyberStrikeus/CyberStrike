---
name: cis-cassandra40-v130-3.6
description: "Ensure that Data Center Authorizations is activated"
category: cis-cassandra
version: "1.3.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, passwords]
cis_id: "3.6"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.3.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.6 Ensure that Data Center Authorizations is activated

## Profile Applicability
- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

Authorization at Data Center level is pluggable in Cassandra and is configured using the `network_authorizer` setting in `cassandra.yaml`. Cassandra ships with `AllowAllNetworkAuthorizer` which allows any role to access any datacenter effectively disabling datacenter authorization; which is the current behavior.

It should be set to `CassandraNetworkAuthorizer` which allows the ability to store permissions which restrict role access to specific datacenters.

## Rationale

The `network_authorizer` parameter in the cassandra.yaml file allows an operator to restrict the access of a Cassandra role to specific datacenters. Keep in mind that for this to work correctly, the authenticator setting in `cassandra.yaml` file must be set to `PasswordAuthenticator`.

## Audit

Run the following command to verify whether network authorization is enabled (network_authorizer value set to `CassandraNetworkAuthorizer`) on the Cassandra server.

The Cassandra configuration files can be found in the conf directory of tarballs. For packages, the configuration files will be located in /etc/cassandra.

```bash
cat cassandra.yaml | grep -in "network_authorizer:"
```

If network_authorizer is set to AllowAllNetworkAuthorizer, then this is a finding.

## Remediation

1. Stop the Cassandra database on each node.
2. Modify the cassandra.yaml file to modify entry for network_authorizer: set it to CassandraNetworkAuthorizer
3. Start the Cassandra database.

## Default Value

```
network_authorizer: AllowAllNetworkAuthorizer
```

## CIS Controls

**Controls Version v8:**
- 16.11 Leverage Vetted Modules or Services for Application Security Components
  - Leverage vetted modules or services for application security components, such as identity management, encryption, and auditing and logging. Using platform features in critical security functions will reduce developers' workload and minimize the likelihood of design or implementation errors. Modern operating systems provide effective mechanisms for identification, authentication, and authorization and make those mechanisms available to applications. Use only standardized, currently accepted, and extensively reviewed encryption algorithms. Operating systems also provide mechanisms to create and maintain secure audit logs.

**Controls Version v7:**
- 14.7 Enforce Access Control to Data through Automated Tools
  - Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.

## Profile
- Level 1 | Manual
