---
name: cis-tomcat8-v110-2.2
description: "Alter the Advertised server.number String (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, information-leakage, server-number]
cis_id: "2.2"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Alter the Advertised server.number String (Scored)

## Description

The `server.number` attribute represents the specific version of Tomcat which is executing. This value is presented to Tomcat clients when connect.

## Rationale

Advertising a valid server version may provide attackers with information useful for locating vulnerabilities affecting the server platform. Altering the server version string may increase the complexity for attackers to determine which vulnerabilities affect the server platform.

## Audit Procedure

Perform the following to determine if the server.number value has been changed. Extract the `ServerInfo.properties` file and examine the `server.number` attribute.

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
$ grep server.number org/apache/catalina/util/ServerInfo.properties
```

## Remediation

Perform the following to alter the server version string that gets displayed when clients connect to the server.

1. Extract the `ServerInfo.properties` file from the `catalina.jar` file:

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

2. Navigate to the `util` directory that was created

```bash
$ cd org/apache/Catalina/util
```

3. Open `ServerInfo.properties` in an editor
4. Update the `server.number` attribute

```
server.number=<someversion>
```

5. Update the `catalina.jar` with the modified `ServerInfo.properties` file.

```bash
$ jar uf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

## Default Value

The default value for the `server.number` attribute is a four part version number, such as `8.5.11.0`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html
2. https://tomcat.apache.org/tomcat-8.5-doc/security-howto.html

## CIS Controls

**v7:**

- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile Applicability

- Level 2
