# CIS Apache Tomcat 8 Benchmark v1.0.0 - CyberStrike Skills

This directory contains **61 CIS benchmark controls** for Apache Tomcat 8, organized as CyberStrike SKILL.md files.

## Benchmark Information

- **Benchmark:** CIS Apache Tomcat 8 Benchmark
- **Version:** v1.0.0
- **Release Date:** 03-17-2016
- **Platform:** Linux
- **Total Controls:** 61 (59 Scored + 6 Not Scored)

## Directory Structure

```
CIS_Apache_Tomcat_8_Benchmark_v1.0.0/
├── cis-tomcat8-v100-1.1/         # Remove extraneous files and directories
├── cis-tomcat8-v100-1.2/         # Disable Unused Connectors
├── cis-tomcat8-v100-2.1/         # Alter the Advertised server.info String
├── cis-tomcat8-v100-2.2/         # Alter the Advertised server.number String
├── cis-tomcat8-v100-2.3/         # Alter the Advertised server.built Date
├── cis-tomcat8-v100-2.4/         # Disable X-Powered-By HTTP Header
├── cis-tomcat8-v100-2.5/         # Disable client facing Stack Traces
├── cis-tomcat8-v100-2.6/         # Turn off TRACE
├── cis-tomcat8-v100-3.1/         # Set a nondeterministic Shutdown command value
├── cis-tomcat8-v100-3.2/         # Disable the Shutdown port
├── cis-tomcat8-v100-4.1/         # Restrict access to $CATALINA_HOME
├── cis-tomcat8-v100-4.2/         # Restrict access to $CATALINA_BASE
├── cis-tomcat8-v100-4.3/         # Restrict access to Tomcat configuration directory
├── cis-tomcat8-v100-4.4/         # Restrict access to Tomcat logs directory
├── cis-tomcat8-v100-4.5/         # Restrict access to Tomcat temp directory
├── cis-tomcat8-v100-4.6/         # Restrict access to Tomcat binaries directory
├── cis-tomcat8-v100-4.7/         # Restrict access to Tomcat web application directory
├── cis-tomcat8-v100-4.8/         # Restrict access to Tomcat catalina.policy
├── cis-tomcat8-v100-4.9/         # Restrict access to Tomcat catalina.properties
├── cis-tomcat8-v100-4.10/        # Restrict access to Tomcat context.xml
├── cis-tomcat8-v100-4.11/        # Restrict access to Tomcat logging.properties
├── cis-tomcat8-v100-4.12/        # Restrict access to Tomcat server.xml
├── cis-tomcat8-v100-4.13/        # Restrict access to Tomcat tomcat-users.xml
├── cis-tomcat8-v100-4.14/        # Restrict access to Tomcat web.xml
├── cis-tomcat8-v100-5.1/         # Use secure Realms
├── cis-tomcat8-v100-5.2/         # Use LockOut Realms
├── cis-tomcat8-v100-6.1/         # Setup Client-cert Authentication
├── cis-tomcat8-v100-6.2/         # Ensure SSLEnabled is set to True
├── cis-tomcat8-v100-6.3/         # Ensure scheme is set accurately
├── cis-tomcat8-v100-6.4/         # Ensure secure is set to true for SSL
├── cis-tomcat8-v100-6.5/         # Ensure SSL Protocol is set to TLS
├── cis-tomcat8-v100-7.1/         # Application specific logging
├── cis-tomcat8-v100-7.2/         # Specify file handler in logging.properties
├── cis-tomcat8-v100-7.3/         # Ensure className is set correctly
├── cis-tomcat8-v100-7.4/         # Ensure directory in context.xml is secure
├── cis-tomcat8-v100-7.5/         # Ensure pattern in context.xml is correct
├── cis-tomcat8-v100-7.6/         # Ensure directory in logging.properties is secure
├── cis-tomcat8-v100-7.7/         # Configure log file size limit
├── cis-tomcat8-v100-8.1/         # Restrict runtime access to sensitive packages
├── cis-tomcat8-v100-9.1/         # Starting Tomcat with Security Manager
├── cis-tomcat8-v100-9.2/         # Disabling auto deployment of applications
├── cis-tomcat8-v100-9.3/         # Disable deploy on startup of applications
├── cis-tomcat8-v100-10.1/        # Web content on separate partition
├── cis-tomcat8-v100-10.2/        # Restrict access to web administration
├── cis-tomcat8-v100-10.3/        # Restrict manager application
├── cis-tomcat8-v100-10.4/        # Force SSL for manager application
├── cis-tomcat8-v100-10.5/        # Rename the manager application
├── cis-tomcat8-v100-10.6/        # Enable strict servlet Compliance
├── cis-tomcat8-v100-10.7/        # Turn off session façade recycling
├── cis-tomcat8-v100-10.8/        # Do not allow additional path delimiters
├── cis-tomcat8-v100-10.9/        # Do not allow custom header status messages
├── cis-tomcat8-v100-10.10/       # Configure connectionTimeout
├── cis-tomcat8-v100-10.11/       # Configure maxHttpHeaderSize
├── cis-tomcat8-v100-10.12/       # Force SSL for all applications
├── cis-tomcat8-v100-10.14/       # Do not allow symbolic linking
├── cis-tomcat8-v100-10.15/       # Do not run applications as privileged
├── cis-tomcat8-v100-10.16/       # Do not allow cross context requests
├── cis-tomcat8-v100-10.17/       # Do not resolve hosts on logging valves
├── cis-tomcat8-v100-10.18/       # Enable memory leak listener
├── cis-tomcat8-v100-10.19/       # Setting Security Lifecycle Listener
└── cis-tomcat8-v100-10.20/       # Use logEffectiveWebXml and metadata-complete
```

## Controls by Section

### Section 1: Remove Extraneous Resources (2 controls)

- 1.1 - Remove extraneous files and directories (Level 2, Scored)
- 1.2 - Disable Unused Connectors (Level 2, Not Scored)

### Section 2: Limit Server Platform Information Leaks (6 controls)

- 2.1 - Alter server.info String (Level 2, Scored)
- 2.2 - Alter server.number String (Level 2, Scored)
- 2.3 - Alter server.built Date (Level 2, Scored)
- 2.4 - Disable X-Powered-By HTTP Header (Level 2, Scored)
- 2.5 - Disable client facing Stack Traces (Level 1, Scored)
- 2.6 - Turn off TRACE (Level 1, Scored)

### Section 3: Protect the Shutdown Port (2 controls)

- 3.1 - Set nondeterministic Shutdown command (Level 1, Scored)
- 3.2 - Disable the Shutdown port (Level 2, Not Scored)

### Section 4: Protect Tomcat Configurations (14 controls)

- 4.1-4.14 - Restrict access to various Tomcat directories and files (Level 1, Scored)

### Section 5: Configure Realms (2 controls)

- 5.1 - Use secure Realms (Level 2, Scored)
- 5.2 - Use LockOut Realms (Level 2, Scored)

### Section 6: Connector Security (5 controls)

- 6.1-6.5 - SSL/TLS configuration controls

### Section 7: Establish and Protect Logging Facilities (7 controls)

- 7.1-7.7 - Logging configuration and protection

### Section 8: Configure Catalina Policy (1 control)

- 8.1 - Restrict runtime access to sensitive packages (Level 1, Scored)

### Section 9: Application Deployment (3 controls)

- 9.1-9.3 - Security Manager and deployment controls

### Section 10: Miscellaneous Configuration Settings (19 controls)

- 10.1-10.20 - Various hardening controls (Note: 10.13 is skipped in the benchmark)

## Profile Definitions

- **Level 1**: Practical and prudent security controls that provide clear security benefit and do not inhibit the utility of the technology
- **Level 2**: Defense in depth controls for environments where security is paramount; may negatively inhibit utility or performance

## Scoring

- **Scored**: Compliance impacts the final CIS benchmark score
- **Not Scored**: Recommended controls that don't affect the benchmark score

## Usage with CyberStrike

Each control is implemented as a CyberStrike skill that can be invoked during security assessments:

```bash
cyberstrike run /cis-tomcat8-v100-1.1
cyberstrike run /cis-tomcat8-v100-4.1
```

## Source

- **PDF:** `/Users/orhanyildirim/Desktop/CIS Benchmarks/Server Software/Apache Tomcat/CIS_Apache_Tomcat_8_Benchmark_v1.0.0.pdf`
- **Generated:** 2026-04-13
- **License:** Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International Public License

## Notes

- Control 10.13 is not included in the benchmark (numbering jumps from 10.12 to 10.14)
- All controls extracted from official CIS PDF with exact audit procedures and remediation steps
- Some controls reference `$CATALINA_HOME` and `$CATALINA_BASE` environment variables
