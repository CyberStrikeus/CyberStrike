---
name: cis-tomcat8-v110-2.6
description: "Turn off TRACE (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, http-methods, trace, information-leakage]
cis_id: "2.6"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Turn off TRACE (Scored)

## Description

The HTTP `TRACE` verb provides debugging and diagnostics information for a given request.

## Rationale

Diagnostic information, such as that found in the response to a `TRACE` request, often contains sensitive information which may useful to an attacker. By preventing Tomcat from providing this information, the risk of leaking sensitive information to a potential attacker is reduced.

## Audit Procedure

Perform the following to determine if the server platform, as advertised in the HTTP Server header, has been changed:

1. Locate all `Connector` elements in `$CATALINA_HOME/conf/server.xml`.
2. Ensure each `Connector` does not have an `allowTrace` attribute or, if present, the `allowTrace` attribute is **NOT** set `true`.

**Note:** Perform the above for each application hosted within Tomcat. Per application instances of `web.xml` can be found at `$CATALINA_HOME/webapps/<APP_NAME>/WEBINF/web.xml`.

## Remediation

Perform the following to prevent Tomcat from accepting a `TRACE` request. Set the `allowTrace` attribute for each `Connector` specified in `$CATALINA_HOME/conf/server.xml` to `false`.

```xml
<Connector ... allowTrace="false" />
```

Alternatively, ensure the `allowTrace` attribute is absent from each `Connector` specified in `$CATALINA_HOME/conf/server.xml`.

## Default Value

Tomcat does not allow the `TRACE` HTTP verb by default. Tomcat will only allow `TRACE` if the `allowTrace` attribute is present and set to `true`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/config/http.html
2. https://tomcat.apache.org/tomcat-8.5-doc/security-howto.html
3. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html

## CIS Controls

**v7:**

- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile Applicability

- Level 1
