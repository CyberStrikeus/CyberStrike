---
name: cis-cassandra311-1.2
description: "Ensure the latest version of Java is installed"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, java, updates]
cis_id: "1.2"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2 Ensure the latest version of Java is installed

## Profile Applicability

- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description

A prerequisite to installing Cassandra is the installation of Java. The version of Java installed should be the most recent that is compatible with the organization's operational needs.

## Rationale

Using the most recent Java SDK version can help limit the possibilities for vulnerabilities in the software, the installation version applied during setup should be established according to the needs of the organization. Ensure you are using a release that is covered by a level of support which includes regular updates to address vulnerabilities.

## Audit

To verify that you have the correct version of java installed:

```bash
# java -version
java version "1.8.0_172"
Java(TM) SE Runtime Environment (build 1.8.0_172-b11)
```

If an old/unsupported version of Java is installed this is a finding.

## Remediation

1. Uninstall the old/unsupported version of Java, if present.
2. Download the latest compatible release of the Java JDK, or OpenJDK.
3. Follow the provided installation instructions to complete the install.

## Default Value

No default Java installation exists.

## References

1. http://www.oracle.com/technetwork/java/javase/downloads/index-jsp-138363.html#javasejdk
2. http://openjdk.java.net/
3. http://openjdk.java.net/install/index.html
4. http://cassandra.apache.org/doc/latest/getting_started/installing.html#prerequisite s
5. https://www.java.com/en/download/help/index_installing.xml?os=All+Platforms&j =8&n=20

## CIS Controls

- v8: 16.5 Use Up-to-Date and Trusted Third-Party Software Components
- v7: 18.4 Only Use Up-to-date And Trusted Third-Party Components

## Profile

- Level 1 | Automated
