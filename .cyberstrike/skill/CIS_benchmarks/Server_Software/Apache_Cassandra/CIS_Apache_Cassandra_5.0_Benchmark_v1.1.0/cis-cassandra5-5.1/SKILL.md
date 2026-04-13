---
name: cis-cassandra5-5.1
description: "Inter-node Encryption"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, linux, database, nosql, encryption, tls, internode]
cis_id: "5.1"
cis_benchmark: "CIS Apache Cassandra 5.0 Benchmark v1.1.0"
tech_stack: [linux, cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Inter-node Encryption (Automated)

## Profile Applicability

- Level 1 - Cassandra on Linux

## Description

Cassandra offers the option to encrypt data in transit between nodes on the cluster. By default, inter-node encryption is turned off.

## Rationale

Data being transferred on the wire should be encrypted to avoid network snooping, whether legitimate or not.

## Impact

None

## Audit Procedure

Run the following command to verify whether inter-node encryption is enabled.

```bash
cat cassandra.yaml | grep -in "internode_encryption:"
```

Acceptable values are `all`, `dc` or `rack`. If the `internode_encryption` is set to `none`, this is a finding.

**Note:** The Cassandra configuration files can be found in the conf directory of tarballs. For packages, the configuration files will be located in `/etc/cassandra`.

## Remediation

The inter-node encryption should be implemented before anyone accesses the Cassandra server.

To enable the inter-node encryption mechanism:

1. Stop the Cassandra database.
2. If not done so already, build out your keystore and truststore.
3. Modify `cassandra.yaml` file to modify/add entry for `internode_encryption`: set it to `all`
4. Start the Cassandra database.

## Default Value

```
internode_encryption: none
```

## References

1. http://cassandra.apache.org/doc/latest/operating/security.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit<br/>Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). | | ● | ● |
| v7 | 14.4 Encrypt All Sensitive Information in Transit<br/>Encrypt all sensitive information in transit. | | ● | ● |
