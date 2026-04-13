---
name: cis-cassandra5-3.6
description: "Ensure that Data Center Authorizations is activated"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, linux, database, nosql, access-control]
cis_id: "3.6"
cis_benchmark: "CIS Apache Cassandra 5.0 Benchmark v1.1.0"
tech_stack: [linux, cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that Data Center Authorizations is activated (Manual)

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

Authorization at Data Center level is pluggable in Cassandra and is configured using the `network_authorizer` setting in `cassandra.yaml`. Cassandra ships with `AllowAllNetworkAuthorizer` which allows any role to access any datacenter effectively disabling datacenter authorization; which is the current behavior.

It should be set to `CassandraNetworkAuthorizer` which allows the ability to store permissions which restrict role access to specific datacenters.

## Rationale

The `network_authorizer` parameter in the cassandra.yaml file allows an operator to restrict the access of a Cassandra role to specific datacenters. Keep in mind that for this to work correctly, the authenticator setting in `cassandra.yaml` file must be set to `PasswordAuthenticator`.

## Impact

None

## Audit Procedure

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

## References

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.11 Leverage Vetted Modules or Services for Application Security Components<br/>Leverage vetted modules or services for application security components, such as identity management, encryption, and auditing and logging. Using platform features in critical security functions will reduce developers' workload and minimize the likelihood of design or implementation errors. Modern operating systems provide effective mechanisms for identification, authentication, and authorization and make those mechanisms available to applications. Use only standardized, currently accepted, and extensively reviewed encryption algorithms. Operating systems also provide mechanisms to create and maintain secure audit logs. | | ● | ● |
| v7 | 14.7 Enforce Access Control to Data through Automated Tools<br/>Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system. | | | ● |
