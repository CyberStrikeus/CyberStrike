---
name: cis-tomcat9-v120-2.6
description: "Turn off TRACE (Automated)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, information-leakage, server-info]
cis_id: "2.6"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Turn off TRACE (Automated)

## Description

The HTTP TRACE verb provides debugging and diagnostics information for a given request.

## Rationale

Diagnostic information, such as that found in the response to a TRACE request, often contains sensitive information which may useful to an attacker. By preventing Tomcat from providing this information, the risk of leaking sensitive information to a potential attacker is reduced.

## Audit Procedure

Perform the following to determine if the server platform, as advertised in the HTTP Server header, has been changed:

1. Locate all Connector elements in `$CATALINA_HOME/conf/server.xml`.
2. Ensure each Connector does not have an `allowTrace` attribute or, if present, the `allowTrace` attribute is NOT set true.

Perform the following for each application hosted within Tomcat with a web-app root element in the web.xml:

1. Locate each application instance of web.xml in `$CATALINA_HOME/webapps/<app_name>/WEB-INF/web.xml`.
2. Ensure a `security-constraint/web-resource-collection` exists the child value pairings:
   1. `web-resource-name` with a value of restricted methods.
   2. `url-pattern` with a value of `/*`.
   3. `http-method` with a value of TRACE.

## Remediation

Perform the following to prevent Tomcat from accepting a TRACE request:

1. Set the `allowTrace` attribute for each Connector specified in `$CATALINA_HOME/conf/server.xml` to false.

```xml
<Connector ... allowTrace="false" />
```

Alternatively, ensure the `allowTrace` attribute is absent from each Connector specified in `$CATALINA_HOME/conf/server.xml`.

2. Add the following as a child of the web-app root element, if present, in each applications web.xml:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>restricted methods</web-resource-name>
        ...
        <http-method>TRACE</http-method>
        ...
    </web-resource-collection>
    ...
</security-constraint>
```

## Default Value

Tomcat does not allow the TRACE HTTP verb by default. Tomcat will only allow TRACE if the `allowTrace` attribute is present and set to true.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html

## CIS Controls

**v8:**

- 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure
  - Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

**v7:**

- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile Applicability

- Level 1
