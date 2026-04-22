---
name: cis-tomcat8-v100-2.6
description: "Turn off TRACE"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, http-methods, trace]
cis_id: "2.6"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.6 Turn off TRACE (Scored)

## Description

The HTTP TRACE verb provides debugging and diagnostics information for a given request.

## Rationale

Diagnostic information, such as that found in the response to a TRACE request, often contains sensitive information that may be useful to an attacker. By preventing Tomcat from providing this information, the risk of leaking sensitive information to a potential attacker is reduced.

## Audit Procedure

1. Locate all Connector elements in `$CATALINA_HOME/conf/server.xml`.
2. Ensure each Connector does not have a `allowTrace` attribute or if the `allowTrace` attribute is not set true.

Note: Perform the above for each application hosted within Tomcat. Per application instances of web.xml can be found at `$CATALINA_HOME/webapps/<APP_NAME>/WEBINF/web.xml`

## Remediation

1. Set the `allowTrace` attributes to each Connector specified in `$CATALINA_HOME/conf/server.xml` to false.

```xml
<Connector ... allowTrace="false" />
```

Alternatively, ensure the allowTrace attribute for each Connector specified in `$CATALINA_HOME/conf/server.xml` is absent.

## Default Value

Tomcat does not allow the TRACE HTTP verb by default. Tomcat will only allow TRACE if the allowTrace attribute is present and set to true.

## References

1. http://tomcat.apache.org/tomcat-8.0-doc/config/http.html

## CIS Controls

- Not mapped in this benchmark version

## Profile Applicability

- Level 1
