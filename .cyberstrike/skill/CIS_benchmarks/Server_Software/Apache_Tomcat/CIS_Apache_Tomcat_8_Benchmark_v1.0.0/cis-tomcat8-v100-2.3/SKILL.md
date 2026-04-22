---
name: cis-tomcat8-v100-2.3
description: "Alter the Advertised server.built Date"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, information-leakage, server-built]
cis_id: "2.3"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3 Alter the Advertised server.built Date (Scored)

## Description

The server.built date represents the date which Tomcat was compiled and packaged. This value is presented to Tomcat clients when clients connect to the server.

## Rationale

Altering the server.built string may make it harder for attackers to fingerprint which vulnerabilities affect the server platform.

## Audit Procedure

Perform the following to determine if the server.built value has been changed:

1. Extract the ServerInfo.properties file and examine the server.built attribute.

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
$ grep server.built org/apache/catalina/util/ServerInfo.properties
```

## Remediation

1. Extract the ServerInfo.properties file from the catalina.jar file:

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

2. Navigate to the util directory:

```bash
$ cd org/apache/Catalina/util
```

3. Open ServerInfo.properties in an editor

4. Update the server.built attribute in the ServerInfo.properties file:

```
server.built=
```

5. Update the catalina.jar with the modified ServerInfo.properties file:

```bash
$ jar uf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

## Default Value

The default value for the server.built attribute is build date and time. For example, Jul 8 2008 11:40:35.

## References

- None

## CIS Controls

- Not mapped in this benchmark version

## Profile Applicability

- Level 2
