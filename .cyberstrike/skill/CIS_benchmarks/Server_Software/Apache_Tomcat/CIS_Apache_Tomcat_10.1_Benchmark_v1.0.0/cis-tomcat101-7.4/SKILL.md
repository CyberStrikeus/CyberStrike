---
name: cis-tomcat101-7.4
description: "Ensure directory in context.xml is a secure location (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, logging, log-files]
cis_id: "7.4"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.4 Ensure directory in context.xml is a secure location (Manual)

## Description

The `directory` attribute tells Tomcat where to store logs. It is recommended that the location referenced by the `directory` attribute be secured.

## Rationale

Securing the log location will help ensure the integrity and confidentiality of web application activity.

## Audit Procedure

Review the permissions of the directory specified by the `directory` attribute to ensure the permissions are `o-rwx` and owned by `tomcat_admin:tomcat`:

```
# grep directory context.xml
# ls -ld <log_location>
```

## Remediation

Perform the following:

1. Add the following statement into the `$CATALINA_BASE/webapps/<app_name>/META-INF/context.xml` file if it does not already exist.

```xml
<Valve className="org.apache.catalina.valves.AccessLogValve"
directory="$CATALINA_HOME/logs/"
prefix="access_log" fileDateFormat="yyyy-MM-dd.HH" suffix=".log"
pattern="%h %t %H cookie:%{SESSIONID}c request:%{SESSIONID}r %m %U %s
%q %r"
/>
```

2. Set the location pointed to by the `directory` attribute to be owned by `tomcat_admin:tomcat` with permissions of `o-rwx`.

```
# chown tomcat_admin:tomcat $CATALINA_HOME/logs
# chmod o-rwx $CATALINA_HOME/logs
```

## Default Value

Does not exist by default

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

Level 1
