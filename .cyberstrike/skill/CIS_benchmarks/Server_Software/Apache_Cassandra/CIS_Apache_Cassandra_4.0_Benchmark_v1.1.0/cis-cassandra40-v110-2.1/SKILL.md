---
name: cis-cassandra40-v110-2.1
description: "Ensure that authentication is enabled for Cassandra databases"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, authentication, access-control]
cis_id: "2.1"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1 Ensure that authentication is enabled for Cassandra databases

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description
Authentication is pluggable in Cassandra and is configured using the `authenticator` setting in `cassandra.yaml`. Cassandra ships with two options included in the default distribution, `AllowAllAuthenticator` and `PasswordAuthenticator`. The default, `AllowAllAuthenticator`, performs no authentication checks and therefore requires no credentials. It is used to disable authentication completely. The second option, `PasswordAuthenticator`, stores encrypted credentials in a system table. This can be used to enable simple username/password authentication.

## Rationale
Authentication is a necessary condition of Cassandra's permissions subsystem, so if authentication is disabled then so are permissions. Failure to authenticate clients, users, and/or servers can allow unauthorized access to the Cassandra database and can prevent tracing actions back to their sources.

## Audit
Run the following command to verify whether authentication is enabled (authenticator values set to `PasswordAuthenticator`) on the Cassandra server.

The Cassandra configuration files can be found in the conf directory of tarballs. For packages, the configuration files will be located in `/etc/cassandra`.

```bash
cat cassandra.yaml | grep -in "authenticator:"
```

If `authenticator` is set to `AllowAllAuthenticator`, then this is a finding.

## Remediation
To enable the authentication mechanism:

1. Stop the Cassandra database.
2. Modify cassandra.yaml file to modify/add entry for authenticator: set it to `PasswordAuthenticator`
3. Start the Cassandra database.

## Default Value
```
authenticator: AllowAllAuthenticator
```

## References
1. http://cassandra.apache.org/doc/latest/getting_started/configuring.html
2. http://cassandra.apache.org/doc/latest/operating/security.html

## CIS Controls
**v8:**
- 16.11 Leverage Vetted Modules or Services for Application Security Components - Leverage vetted modules or services for application security components, such as identity management, encryption, and auditing and logging. Using platform features in critical security functions will reduce developers' workload and minimize the likelihood of design or implementation errors. Modern operating systems provide effective mechanisms for identification, authentication, and authorization and make those mechanisms available to applications. Use only standardized, currently accepted, and extensively reviewed encryption algorithms. Operating systems also provide mechanisms to create and maintain secure audit logs.

**v7:**
- 14.7 Enforce Access Control to Data through Automated Tools - Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.

## Profile
- Level 1 | Automated
