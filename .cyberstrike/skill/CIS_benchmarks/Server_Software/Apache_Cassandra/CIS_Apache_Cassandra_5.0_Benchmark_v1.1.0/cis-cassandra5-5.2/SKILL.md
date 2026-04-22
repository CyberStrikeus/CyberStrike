---
name: cis-cassandra5-5.2
description: "Client Encryption"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, linux, database, nosql, encryption, tls]
cis_id: "5.2"
cis_benchmark: "CIS Apache Cassandra 5.0 Benchmark v1.1.0"
tech_stack: [linux, cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Client Encryption (Automated)

## Profile Applicability

- Level 1 - Cassandra on Linux

## Description

Cassandra offers the option to encrypt data in transit between the client and nodes on the cluster. By default client encryption is turned off.

## Rationale

Data in transit between the client and node on the cluster should be encrypted to avoid network snooping, whether legitimate or not.

## Impact

None

## Audit Procedure

The Cassandra configuration files can be found in the conf directory of tarballs. For packages, the configuration files will be located in `/etc/cassandra`.

Open up the `cassandra.yaml` file, look for client_encryption_options section.

Look for `enabled:` and `optional:`

```yaml
enabled: true

optional: false
```

If neither is true, then all client connections are unencrypted which makes this a finding.

If enabled is true and optional is false, then all client connections must be encrypted which makes this not a finding.

If enabled is false and optional is true, then enabled wins and all client connections are unencrypted which makes this a finding.

If both are set to true, then both unencrypted and encrypted connections are allowed on the same port which makes this not a finding.

You can also excuse this command:

```bash
cat cassandra.yaml | grep -A7 -in "client_encryption_options:"
```

or

```bash
cat cassandra.yaml | grep -A2 -in "client_encryption_options:"
```

If enabled is set to true, then success. Anything else is a finding.

## Remediation

The client encryption should be implemented before anyone accesses the Cassandra server.

To enable the client encryption mechanism:

1. Stop the Cassandra database.
2. If not done so already, build out your keystore and truststore.
3. Modify `cassandra.yaml` file to modify/add entry for client_encryption_options section:
   - Set `enabled` to `true`
   - Set `optional` to `false` (to require encryption for all connections)
4. Start the Cassandra database.

## Default Value

```yaml
client_encryption_options:
  enabled: false
  optional: false
```

## References

1. http://cassandra.apache.org/doc/latest/operating/security.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.10 Encrypt Sensitive Data in Transit<br/>Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). |      | ●    | ●    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit<br/>Encrypt all sensitive information in transit.                                                                                |      | ●    | ●    |
