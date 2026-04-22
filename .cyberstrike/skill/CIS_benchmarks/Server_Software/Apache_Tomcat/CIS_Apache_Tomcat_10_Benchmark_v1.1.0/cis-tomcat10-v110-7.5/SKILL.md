---
name: cis-tomcat10-v110-7.5
description: "Ensure pattern in context.xml is correct (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, logging, log-files]
cis_id: "7.5"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.5 Ensure pattern in context.xml is correct (Automated)

## Description

The pattern setting informs Tomcat what information should be logged per application. At a minimum, enough information to uniquely identify a request, what was requested, where the requested originated from, and when the request occurred should be logged. The following will log the request date and time (%t), the requested URL (%U), the remote IP address (%a), the local IP address (%A), the request method (%m), the local port (%p), query string, if present, (%q), and the HTTP status code of the response (%s).

```
pattern="%t %U %a %A %m %p %q %s"
```

## Rationale

The level of logging detail prescribed will assist in identifying correlating security events or incidents.

## Audit Procedure

Review the pattern settings to ensure it contains all of the variables required by the installation.

```
# grep pattern $CATALINA_BASE/webapps/<app_name>/META-INF/context.xml
```

## Remediation

Add the following statement into the `$CATALINA_BASE/webapps/<app_name>/META-INF/context.xml` file if it does not already exist.

```xml
<Valve
className="org.apache.catalina.valves.AccessLogValve"
directory="$CATALINA_HOME/logs/" prefix="access_log" fileDateFormat="yyyy-MM-
dd.HH" suffix=".log"
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

Level 1
