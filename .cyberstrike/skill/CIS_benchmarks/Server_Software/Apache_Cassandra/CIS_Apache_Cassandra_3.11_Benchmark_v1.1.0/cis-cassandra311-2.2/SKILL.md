---
name: cis-cassandra311-2.2
description: "Ensure that authorization is enabled for Cassandra databases"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, authentication, authorization]
cis_id: "2.2"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2 Ensure that authorization is enabled for Cassandra databases

## Profile Applicability

- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description

Authorization is pluggable in Cassandra and is configured using the authorizer setting in cassandra.yaml. Cassandra ships with two options included in the default distribution, AllowAllAuthenticator and CassandraAuthorizer. The default, AllowAllAuthenticator performs no checking which grants all permissions to all roles. The second option, CassandraAuthorizer, implements full permissions management functionality and stores its data in Cassandra system tables.

## Rationale

Authorizing roles is an important step towards ensuring only authorized access to the Cassandra database tables is permitted. It also provides the requisite means of implementing least privilege best practices. The authorization mechanism should be implemented before anyone accesses the Cassandra database.

## Audit

Run the following command to verify whether authorization is enabled (authorization values set to CassandraAuthorizer) on the Cassandra server.
The Cassandra configuration files can be found in the conf directory of tarballs. For packages, the configuration files will be located in /etc/cassandra.

```bash
cat cassandra.yaml | grep -in "authorizer:"
```

If authorizer is set to AllowAllAuthorizer, then this is a finding.

## Remediation

To enable the authorization mechanism:

1. Stop the Cassandra database.
2. Modify cassandra.yaml file to modify/add entry for authorization: set it to CassandraAuthorizer
3. Start the Cassandra database.

## Default Value

```
authorizer: AllowAllAuthorizer
```

## References

1. http://cassandra.apache.org/doc/latest/getting_started/configuring.html
2. http://cassandra.apache.org/doc/latest/operating/security.html

## Additional Information

The authorizer must be configured to AllowAllAuthorizer if AllowAllAuthenticator is the configured authenticator.

## CIS Controls

- v8: 16.11 Leverage Vetted Modules or Services for Application Security Components
- v7: 14.7 Enforce Access Control to Data through Automated Tools

## Profile

- Level 1 | Automated
