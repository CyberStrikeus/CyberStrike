---
name: cis-tomcat8-v100-2.2
description: "Alter the Advertised server.number String"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, information-leakage, server-number]
cis_id: "2.2"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2 Alter the Advertised server.number String (Scored)

## Description

The `server.number` attribute represents the specific version of Tomcat that is executing. This value is presented to Tomcat clients when they connect.

## Rationale

Advertising a valid server version may provide attackers with information useful for locating vulnerabilities that affect the server platform. Altering the server version string may make it harder for attackers to determine which vulnerabilities affect the server platform.

## Audit Procedure

Perform the following to determine if the server.number value has been changed:

1. Extract the ServerInfo.properties file and examine the server.number attribute.

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
$ grep server.number org/apache/catalina/util/ServerInfo.properties
```

## Remediation

Perform the following to alter the server version string that gets displayed when clients connect to the server.

1. Extract the ServerInfo.properties file from the catalina.jar file:

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

2. Navigate to the util directory that was created:

```bash
$ cd org/apache/Catalina/util
```

3. Open ServerInfo.properties in an editor

4. Update the `server.number` attribute:

```
server.number=<someversion>
```

5. Update the catalina.jar with the modified ServerInfo.properties file:

```bash
$ jar uf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

## Default Value

The default value for the server.number attribute is a four part version number, such as 5.5.20.0.

## References

- None

## CIS Controls

- Not mapped in this benchmark version

## Profile Applicability

- Level 2
