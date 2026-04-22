---
name: cis-tomcat9-v120-10.18
description: "Use the logEffectiveWebXml and metadata-complete settings for deploying applications in production (Automated)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security, deployment]
cis_id: "10.18"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.18 Use the logEffectiveWebXml and metadata-complete settings for deploying applications in production (Automated)

## Description

Both fragments and annotations give rise to security concerns. `web.xml` contains a `metadata-complete` attribute on the `web-app` element whose binary value defines whether other sources of metadata should be considered when deploying this web application, this includes annotations on class files (`@WebServlet`, but also `@WebListener`, `@WebFilter`, ...), `web-fragment.xml` as well as classes located in `WEB-INF/classes`. In addition, you can also allow you to log the effective `web.xml`, when an application starts, and the effective `web.xml` is the result of taking the main `web.xml` for your application merging in all the fragments applying all the annotations. By logging that, you are able to review it, and see if that is in fact what you actually want.

## Rationale

Enable `logEffectiveWebXml` will allow you to log the effective `web.xml` and you are able to see if that is in fact what you actually want. Enable `metadata-complete` so that the `web.xml` is the only metadata considered.

## Audit Procedure

1. Review each application's `web.xml` file located in the applications `$CATALINA_HOME/webapps/<app_name>/WEB-INF/web.xml` and determine if the logEffectiveWebXml is properly is set.

```xml
<web-app
...
metadata-complete="true"
...
>
```

2. Review each application's `context.xml` file located in the applications `$CATALINA_HOME/webapps/<app_name>/META-INF/context.xml` and determine if the metadata-complete property is set.

```xml
<Context
...
logEffectiveWebXml="true"
...
>
```

## Remediation

- Set the `metadata-complete` value in the `web.xml` in each of the applications to `true`.

Note: The `metadata-complete` option is not enough to disable all of annotation scanning. If there is a `ServletContainerInitializer` with a `@HandlesTypes` annotation, Tomcat has to scan your application for classes that use annotations or interfaces specified in that annotation.

- Set the `logEffectiveWebXml` value in the `context.xml` in each of the application to `true`.

## Default Value

If `logEffectiveWebXml` and/or `metadata-complete` is/are not specified, the default value is `false`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/context.html
2. https://alexismp.wordpress.com/2010/07/28/servlet-3-0-fragments-and-web-xml-to-rule-them-all/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 6.3 Enable Detailed Logging<br>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | ● | ● |

## Profile

Level 1
