---
name: cis-tomcat8-v100-2.5
description: "Disable client facing Stack Traces"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, information-leakage, stack-traces, error-pages]
cis_id: "2.5"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.5 Disable client facing Stack Traces (Scored)

## Description

When a runtime error occurs during request processing, Apache Tomcat will display debugging information to the requestor. It is recommended that such debug information be withheld from the requestor.

## Rationale

Debugging information, such as that found in call stacks, often contains sensitive information that may be useful to an attacker. By preventing Tomcat from providing this information, the risk of leaking sensitive information to a potential attacker is reduced.

## Audit Procedure

Perform the following to determine if Tomcat is configured to prevent sending debug information to the requestor:

1. Ensure an `<error-page>` element is defined in `$CATALINA_HOME/conf/web.xml`.
2. Ensure the `<error-page>` element has an `<exception-type>` child element with a value of `java.lang.Throwable`.
3. Ensure the `<error-page>` element has a `<location>` child element.

Note: Perform the above for each application hosted within Tomcat. Per application instances of web.xml can be found at `$CATALINA_HOME/webapps/<APP_NAME>/WEB-INF/web.xml`

## Remediation

1. Create a web page that contains the logic or message you wish to invoke when encountering a runtime error. For example purposes, assume this page is located at /error.jsp.
2. Add a child element, `<error-page>`, to the `<web-app>` element, in the `$CATALINA_HOME/conf/web.xml` file.
3. Add a child element, `<exception-type>`, to the `<error-page>` element. Set the value of the `<exception-type>` element to `java.lang.Throwable`.
4. Add a child element, `<location>`, to the `<error-page>` element. Set the value of the `<location>` element to the location of page created in #1.

The resulting entry will look as follows:

```xml
<error-page>
 <exception-type>java.lang.Throwable</exception-type>
 <location>/error.jsp</location>
</error-page>
```

## Default Value

Tomcat's default configuration does not include an `<error-page>` element in `$CATALINA_HOME/conf/web.xml`. Therefore, Tomcat will provide debug information to the requestor by default.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/api/org/apache/tomcat/util/descriptor/web/ErrorPage.html

## CIS Controls

- Not mapped in this benchmark version

## Profile Applicability

- Level 1
