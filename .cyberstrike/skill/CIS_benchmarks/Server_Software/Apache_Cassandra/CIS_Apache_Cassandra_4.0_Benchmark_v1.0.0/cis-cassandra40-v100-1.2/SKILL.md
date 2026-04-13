---
name: cis-cassandra40-v100-1.2
description: "Ensure the latest version of Java is installed"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, java, updates]
cis_id: "1.2"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2 Ensure the latest version of Java is installed

## Profile Applicability
- Level 1 - Cassandra on Linux

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
Apache Cassandra expects a version of 1.8.
NOTE: Experimental support for Java 11 was added in Cassandra 4.0 (CASSANDRA-9608). Running Cassandra on Java 11 is experimental. Do so at your own risk.

## Remediation
1. Uninstall the old/unsupported version of Java, if present.
2. Download the latest compatible release of the Java JDK, or OpenJDK.
3. Follow the provided installation instructions to complete the install.

## Default Value
N/A

## References
1. http://www.oracle.com/technetwork/java/javase/downloads/index-jsp-138363.html#javasejdk
2. http://openjdk.java.net/
3. http://openjdk.java.net/install/index.html
4. http://cassandra.apache.org/doc/latest/getting_started/installing.html#prerequisite
5. https://www.java.com/en/download/help/index_installing.xml?os=All+Platforms&j=8&n=20

## CIS Controls
- **v8 16.5** Use Up-to-Date and Trusted Third-Party Software Components
  - Use up-to-date and trusted third-party software components. When possible, choose established and proven frameworks and libraries that provide adequate security. Acquire these components from trusted sources or evaluate the software for vulnerabilities before use.
- **v7 18.4** Only Use Up-to-date And Trusted Third-Party Components
  - Only use up-to-date and trusted third-party components for the software developed by the organization.

## Profile
- Level 1 - Cassandra on Linux | Automated
