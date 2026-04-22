---
name: cis-tomcat8-v110-2.7
description: "Ensure Sever Header is Modified To Prevent Information Disclosure (Not Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, information-leakage, server-header]
cis_id: "2.7"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Sever Header is Modified To Prevent Information Disclosure (Not Scored)

## Description

The server header is a vanity header developed to help identify the underlying technology in a server for troubleshooting and identification. This header is unnecessary and could be used to target your website for exploitation. Tomcat does not provide the ability to remove the server header, however, it does provide the ability to modify the header.

## Rationale

The server header may specify the underlying technology used by an application. Attackers are able to conduct reconnaissance on a website using these response headers. This header could be used to target attacks for specific known vulnerabilities associated with the underlying technology. Removing this header will prevent targeting of your application for specific exploits by non-determined attackers.

While this is not the only way to fingerprint a site through the response headers, it makes it harder and prevents some potential attackers from targeting your website.

## Audit Procedure

In `$CATALINA_HOME/conf/server.xml`, check for the server directive as shown below. If the directive is not present or the directive specifies something revealing on the underlying infrastructure then the server header should be changed.

```xml
<Connector port="8443" server="Apache" redirectPort="8080" />
```

## Remediation

In `$CATALINA_HOME/conf/server.xml`, add the server directive to the connector as shown below replacing apache with the text of your choosing. This text should not help in identifying the server.

```xml
<Connector port="8443" server="I am a teapot" redirectPort="8080" />
```

Scripted:

- If you do not have the header defined:

```bash
sed -ir 's/Connector/Connector server="I am a teapot"/g' \
    $CATALINA_HOME/conf/server.xml
```

- If you already have a header but it is still revealing:

```bash
sed -ir 's/server="[^"]*"/server="I Am A Teapot"/g' \
    $CATALINA_HOME/conf/server.xml
```

## Default Value

The default value is `Apache-Coyote/1.1`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html#server.xml
2. https://stackoverflow.com/questions/52637285/replacing-server-header-in-tomcat-with-sed

## CIS Controls

**v7:**
- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile Applicability

- Level 2
