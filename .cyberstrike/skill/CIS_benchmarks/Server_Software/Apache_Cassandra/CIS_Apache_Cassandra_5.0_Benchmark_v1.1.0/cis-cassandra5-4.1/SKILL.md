---
name: cis-cassandra5-4.1
description: "Ensure that logging is enabled"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, linux, database, nosql, auditing, logging]
cis_id: "4.1"
cis_benchmark: "CIS Apache Cassandra 5.0 Benchmark v1.1.0"
tech_stack: [linux, cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure that logging is enabled (Automated)

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

Apache Cassandra uses Logback for logging functionality. While this can be set using `nodetool setlogginglevel` changes made using this method will be reverted to the level specified in the `logback.xml` file the next time the process restarts.

The configurable logging levels are:

- `OFF`
- `TRACE`
- `DEBUG`
- `INFO` (Default)
- `WARN`
- `ERROR`

## Rationale

If logging is not enabled, issues may go undiscovered, and compromises and other incidents may occur without being quickly detected. It may also not be possible to provide evidence of compliance with security laws, regulations, and other requirements.

## Impact

None

## Audit Procedure

Execute the following command to confirm the setting is correct:

```bash
$ nodetool getlogginglevels
Logger Name                                        Log Level
ROOT                                                    INFO
org.clisecurity.workbench                               WARN
```

If set to `OFF` then this is a finding.

## Remediation

To remediate this setting:

1. Edit the `logback-test.xml` if present; otherwise, edit the `logback.xml`

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

    <logger name="org.clisecurity.workbench" level="WARN"/>
</configuration>
```

2. Restart the Apache Cassandra

## Default Value

```
INFO
```

## References

1. http://cassandra.apache.org/doc/latest/troubleshooting/reading_logs.html?highlight=logging
2. https://logback.qos.ch/manual/configuration.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br/>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 6.3 Enable Detailed Logging<br/>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | ● | ● |
