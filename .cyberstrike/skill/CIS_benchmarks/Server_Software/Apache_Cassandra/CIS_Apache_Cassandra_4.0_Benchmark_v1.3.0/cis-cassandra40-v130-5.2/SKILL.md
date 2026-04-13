---
name: cis-cassandra40-v130-5.2
description: "Client Encryption"
category: cis-cassandra
version: "1.3.0"
author: cyberstrike-official
tags: [cis, cassandra, encryption, tls, ssl]
cis_id: "5.2"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.3.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2 Client Encryption

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description

Cassandra offers the option to encrypt data in transit between the client and nodes on the cluster. By default client encryption is turned off.

## Rationale

Data in transit between the client and node on the cluster should be encrypted to avoid network snooping, whether legitimate or not.

## Audit

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

You can also excuse this command

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
3. Modify `cassandra.yaml` file to modify/add entries under `client_encryption_options`:

```yaml
set enabled: true

set optional: false
```

This will force all connections to be encrypted between client and node on the cluster.

4. Start the Cassandra database.

## Default Value

```yaml
enabled: false

optional: false
```

## References

1. http://cassandra.apache.org/doc/latest/operating/security.html

## CIS Controls

**Controls Version v8:**
- 3.10 Encrypt Sensitive Data in Transit
  - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**Controls Version v7:**
- 14.4 Encrypt All Sensitive Information in Transit
  - Encrypt all sensitive information in transit.

## Profile
- Level 1 | Automated
