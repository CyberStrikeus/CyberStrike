---
name: cis-tomcat8-v100-7.3
description: "Ensure className is set correctly in context.xml (Automated)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, logging, log-files]
cis_id: "7.3"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.3 Ensure className is set correctly in context.xml (Automated)

## Description

Ensure the `className` attribute is set to `AccessLogValve`. The `className` attribute determines the access log valve to be used for logging.

## Rationale

Some log valves are not suited for production and should not be used. Apache recommends `org.apache.catalina.valves.AccessLogValve`.

## Audit Procedure

Execute the following to ensure `className` is set properly:

```
# grep org.apache.catalina.valves.AccessLogValve
$CATALINA_BASE/webapps/<app_name>/META-INF/context.xml
```

## Remediation

Add the following statement into the `$CATALINA_BASE/webapps/<app_name>/META-INF/context.xml` file if it does not already exist.

```xml
<Valve
className="org.apache.catalina.valves.AccessLogValve"
directory="$CATALINA_HOME/logs/"
prefix="access_log"
fileDateFormat="yyyy-MM-dd.HH"
suffix=".log"
pattern="%h %t %H cookie:%{SESSIONID}c request:%{SESSIONID}r %m %U %s %q %r"
/>
```

## Default Value

Does not exist by default.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/valve.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 6.3 Enable Detailed Logging<br>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | ● | ● |

## Profile

Level 2
