---
name: cis-tomcat10-v110-7.6
description: "Ensure directory in logging.properties is a secure location (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, logging, log-files]
cis_id: "7.6"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.6 Ensure directory in logging.properties is a secure location (Automated)

## Description

The directory attribute tells Tomcat where to store logs. The directory value should be a secure location with restricted access.

## Rationale

Securing the log location will help ensure the integrity and confidentiality of web application activity records.

## Audit Procedure

Review the permissions of the directory specified by the directory setting to ensure the permissions are `o-rwx` and owned by `tomcat_admin:tomcat`:

Default:

```
# grep directory $CATALINA_BASE/conf/logging.properties
# ls -ld <log_location>
```

Application specific:

```
# grep directory $CATALINA_BASE/webapps/<app_name>/WEB-
INF/classes/logging.properties
# ls -ld <log_location>
```

## Remediation

Perform the following:

1. Add the following properties into your `logging.properties` file if they do not exist

```
<application_name>.org.apache.juli.AsyncFileHandler.directory=<log_loca
tion>
<application_name>.org.apache.juli.AsyncFileHandler.prefix=<application
_name>
```

2. Set the location pointed to by the directory attribute to be owned by `tomcat_admin:tomcat` with permissions of `o-rwx`.

```
# chown tomcat_admin:tomcat <log_location>
# chmod o-rwx <log_location>
```

## Default Value

The directory location is configured to store logs in `$CATALINA_BASE/logs`.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

Level 1
