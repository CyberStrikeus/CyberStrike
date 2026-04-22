---
name: cis-tomcat8-v110-11.1
description: "Limit HTTP Request Methods (Scored)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, http-methods, security]
cis_id: "11.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.1 Limit HTTP Request Methods (Scored)

## Description

Restrict HTTP request methods to only those required by the application. Unused HTTP methods should be disabled to reduce the attack surface.

## Rationale

Disabling unused HTTP methods reduces the attack surface of the web application. Methods such as PUT, DELETE, OPTIONS, and TRACE can be leveraged by attackers if they are not required by the application.

## Audit Procedure

Review the `$CATALINA_HOME/conf/web.xml` file for security constraints that limit HTTP methods:

```bash
$ grep -A5 "http-method" $CATALINA_HOME/conf/web.xml
```

Verify that a security constraint exists that restricts access to only the required HTTP methods.

## Remediation

Add a security constraint to `$CATALINA_HOME/conf/web.xml` that limits allowed HTTP methods:

```xml
<security-constraint>
  <web-resource-collection>
    <web-resource-name>restricted methods</web-resource-name>
    <url-pattern>/*</url-pattern>
    <http-method-omission>GET</http-method-omission>
    <http-method-omission>POST</http-method-omission>
    <http-method-omission>HEAD</http-method-omission>
  </web-resource-collection>
  <auth-constraint />
</security-constraint>
```

## Default Value

By default, all HTTP methods are allowed.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html

## CIS Controls

**v7:**

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 1
