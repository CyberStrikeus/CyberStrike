---
name: cis-cassandra311-4.1
description: "Ensure that logging is enabled"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, auditing, logging]
cis_id: "4.1"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Ensure that logging is enabled

## Profile Applicability

- Level 1 - Cassandra
- Level 2 - Cassandra
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description

Apache Cassandra uses Logback for logging functionality. While this can be set using nodetool setlogginglevel changes made using this method will be reverted to the level specified in the logback.xml file the next time the process restarts.

The configurable logging levels are:

- OFF
- TRACE
- DEBUG
- INFO (Default)
- WARN
- ERROR

## Rationale

If logging is not enabled, issues may go undiscovered, and compromises and other incidents may occur without being quickly detected. It may also not be possible to provide evidence of compliance with security laws, regulations, and other requirements.

## Audit

Execute the following command to confirm the setting is correct:

```bash
$ nodetool getlogginglevels
Logger Name                                        Log Level
ROOT                                                    INFO
org.clsecurity.workbench                                WARN
```

If set to OFF then this is a finding.

## Remediation

To remediate this setting:

1. Edit the logback-test.xml if present; otherwise, edit the logback.xml

```xml
<configuration scan="true">

  <appender name="STDOUT"
  class="ch.qos.logback.core.ConsoleAppender">
    <filter class="ch.qos.logback.classic.filter.ThresholdFilter">
      <level>INFO</level>
    </filter>
    <encoder>
      <pattern>%-5level [%thread] %date{ISO8601} %F:%L -
%msg%n</pattern>
    </encoder>
  </appender>

  <root level="INFO">
    <appender-ref ref="STDOUT" />
  </root>

  <logger name="org.clsecurity.workbench" level="WARN"/>
</configuration>
```

2. Restart the Apache Cassandra

## Default Value

```
INFO
```

## References

1. http://cassandra.apache.org/doc/latest/troubleshooting/reading_logs.html?highlig ht=logging
2. https://logback.qos.ch/manual/configuration.html

## CIS Controls

- v8: 8.5 Collect Detailed Audit Logs
- v7: 6.3 Enable Detailed Logging

## Profile

- Level 1 | Automated
