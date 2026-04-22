---
name: cis-tomcat9-v120-7.2
description: "Specify file handler in logging.properties files (Automated)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, logging, log-files]
cis_id: "7.2"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2 Specify file handler in logging.properties files (Automated)

## Description

Handlers specify where log messages are sent. Console handlers send log messages to the Java console and File handlers specify logging to a file.

## Rationale

Utilizing file handlers will ensure that security event information is persisted to disk.

## Impact

Configuring logging to debug logging, i.e. FINEST or ALL, can generate large amounts of information which may impact server performance.

## Audit Procedure

Review each application's `logging.properties` file located in the applications `$CATALINA_BASE/webapps/<app_name>/WEB-INF/classes` directory and determine if the file handler properties are set.

```
$ grep handlers \
$ CATALINA_BASE/webapps/<app_name>/WEB-INF/classes/logging.properties
```

In the instance where an application specific logging has not been created, the `logging.properties` file will be located in `$CATALINA_BASE/conf`

```
$ grep handlers $CATALINA_BASE/conf/logging.properties
```

## Remediation

Add the following entries, replacing `<file_handler>` with either `FileHandler` or `AsyncFileHandler`, to your `logging.properties` file if they do not exist.

```
handlers=1catalina.org.apache.juli.<file_handler>,
2localhost.org.apache.juli.<file_handler>,
3manager.org.apache.juli.<file_handler>, 4host-
manager.org.apache.juli.<file_handler>, java.util.logging.ConsoleHandler
```

Ensure logging is not off and set the `<logging_level>` to the desired level (SEVERE, WARNING, INFO, CONFIG, FINE, FINER, FINEST or ALL), for example:

```
org.apache.juli.FileHandler.level=<logging_level>
```

## Default Value

No value for new applications by default.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/logging.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | ●    | ●    |
| v7               | 6.3 Enable Detailed Logging<br>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.                                                                                |      | ●    | ●    |

## Profile

Level 1
