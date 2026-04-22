---
name: cis-tomcat101-2.1
description: "Alter the Advertised server.info String (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, information-leakage, server-info]
cis_id: "2.1"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Alter the Advertised server.info String (Manual)

## Description

The `server.info` attribute contains the name of the application service. This value is presented to Tomcat clients when clients connect to the tomcat server.

## Rationale

Altering the `server.info` attribute may increase the complexity for attackers to determine which vulnerabilities affect the server platform.

## Audit Procedure

Perform the following to determine if the `server.info` value has been changed: Extract the ServerInfo.properties file and examine the `server.info` attribute.

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
$ grep server.info org/apache/catalina/util/ServerInfo.properties
```

## Remediation

Perform the following to alter the server platform string that gets displayed when clients connect to the tomcat server.

1. Extract the ServerInfo.properties file from the catalina.jar file:

```bash
$ cd $CATALINA_HOME/lib
$ jar xf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

2. Navigate to the util directory that was created

```bash
cd org/apache/catalina/util
```

3. Open ServerInfo.properties in an editor
4. Update the `server.info` attribute in the ServerInfo.properties file.

```
server.info=<SomeWebServer>
```

5. Update the catalina.jar with the modified ServerInfo.properties file.

```bash
$ jar uf catalina.jar org/apache/catalina/util/ServerInfo.properties
```

## Default Value

The default value for the `server.info` attribute is Apache Tomcat/<version>. For example, Apache Tomcat/9.0.0.M9.

## References

1. https://www.owasp.org/index.php/Securing_tomcat

## CIS Controls

**v8:**

- 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure
  - Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

**v7:**

- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.
- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile Applicability

- Level 2
