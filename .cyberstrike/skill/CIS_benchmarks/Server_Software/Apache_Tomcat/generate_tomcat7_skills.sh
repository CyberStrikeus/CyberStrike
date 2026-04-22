#!/bin/bash

# Script to generate all 61 CIS Apache Tomcat 7 Benchmark v1.1.0 SKILL.md files
# Run this script from the benchmark directory

BASE_DIR="/Users/orhanyildirim/Desktop/aum-pipeline/cyberstrike-io/CyberStrike/.cyberstrike/skill/CIS_benchmarks/Server_Software/Apache_Tomcat/CIS_Apache_Tomcat_7_Benchmark_v1.1.0"

# List of all controls with their details
# Format: control_id|title|profile|scored|section_tags

declare -a CONTROLS=(
  "1.1|Remove extraneous files and directories|Level 2|Scored|hardening,file-permissions,defense-in-depth"
  "1.2|Disable Unused Connectors|Level 2|Not Scored|network,connectors,attack-surface"
  "2.1|Alter the Advertised server.info String|Level 2|Scored|information-disclosure,fingerprinting,obscurity"
  "2.2|Alter the Advertised server.number String|Level 2|Scored|information-disclosure,fingerprinting,obscurity"
  "2.3|Alter the Advertised server.built Date|Level 2|Scored|information-disclosure,fingerprinting,obscurity"
  "2.4|Disable X-Powered-By HTTP Header and Rename the Server Value for all Connectors|Level 2|Scored|information-disclosure,http-headers,fingerprinting"
  "2.5|Disable client facing Stack Traces|Level 1|Scored|information-disclosure,error-handling,debugging"
  "2.6|Turn off TRACE|Level 1|Scored|http-methods,xst,cross-site-tracing"
  "3.1|Set a nondeterministic Shutdown command value|Level 1|Scored|shutdown,authentication,dos"
  "3.2|Disable the Shutdown port|Level 2|Not Scored|shutdown,ports,attack-surface"
  "4.1|Restrict access to \$CATALINA_HOME|Level 1|Scored|file-permissions,access-control,least-privilege"
  "4.2|Restrict access to \$CATALINA_BASE|Level 1|Scored|file-permissions,access-control,least-privilege"
  "4.3|Restrict access to Tomcat configuration directory|Level 1|Scored|file-permissions,access-control,configuration"
  "4.4|Restrict access to Tomcat logs directory|Level 1|Scored|file-permissions,access-control,logging"
  "4.5|Restrict access to Tomcat temp directory|Level 1|Scored|file-permissions,access-control,temporary-files"
  "4.6|Restrict access to Tomcat binaries directory|Level 1|Scored|file-permissions,access-control,executables"
  "4.7|Restrict access to Tomcat web application directory|Level 1|Scored|file-permissions,access-control,webapps"
  "4.8|Restrict access to Tomcat catalina.policy|Level 1|Scored|file-permissions,access-control,security-policy"
  "4.9|Restrict access to Tomcat catalina.properties|Level 1|Scored|file-permissions,access-control,configuration"
  "4.10|Restrict access to Tomcat context.xml|Level 1|Scored|file-permissions,access-control,configuration"
  "4.11|Restrict access to Tomcat logging.properties|Level 1|Scored|file-permissions,access-control,logging"
  "4.12|Restrict access to Tomcat server.xml|Level 1|Scored|file-permissions,access-control,configuration"
  "4.13|Restrict access to Tomcat tomcat-users.xml|Level 1|Scored|file-permissions,access-control,authentication"
  "4.14|Restrict access to Tomcat web.xml|Level 1|Scored|file-permissions,access-control,configuration"
  "5.1|Use secure Realms|Level 2|Scored|authentication,realms,security"
  "5.2|Use LockOut Realms|Level 2|Scored|authentication,brute-force,account-lockout"
  "6.1|Setup Client-cert Authentication|Level 2|Scored|authentication,ssl-tls,certificates,mutual-auth"
  "6.2|Ensure SSLEnabled is set to True for Sensitive Connectors|Level 1|Not Scored|ssl-tls,encryption,confidentiality"
  "6.3|Ensure scheme is set accurately|Level 1|Scored|ssl-tls,connectors,security-context"
  "6.4|Ensure secure is set to true only for SSL-enabled Connectors|Level 1|Scored|ssl-tls,connectors,security-context"
  "6.5|Ensure SSL Protocol is set to TLS for Secure Connectors|Level 1|Scored|ssl-tls,protocol,cryptography"
  "7.1|Application specific logging|Level 2|Scored|logging,monitoring,audit"
  "7.2|Specify file handler in logging.properties files|Level 1|Scored|logging,file-handlers,persistence"
  "7.3|Ensure className is set correctly in context.xml|Level 2|Scored|logging,access-logs,valve"
  "7.4|Ensure directory in context.xml is a secure location|Level 1|Scored|logging,file-permissions,log-storage"
  "7.5|Ensure pattern in context.xml is correct|Level 1|Scored|logging,log-format,forensics"
  "7.6|Ensure directory in logging.properties is a secure location|Level 1|Scored|logging,file-permissions,log-storage"
  "7.7|Configure log file size limit|Level 2|Scored|logging,dos,disk-space"
  "8.1|Restrict runtime access to sensitive packages|Level 1|Scored|security-manager,package-access,java-security"
  "9.1|Starting Tomcat with Security Manager|Level 1|Scored|security-manager,sandbox,code-execution"
  "9.2|Disabling auto deployment of applications|Level 2|Scored|deployment,auto-deploy,untrusted-code"
  "9.3|Disable deploy on startup of applications|Level 2|Scored|deployment,startup,untrusted-code"
  "10.1|Ensure Web content directory is on a separate partition from the Tomcat system files|Level 1|Not Scored|file-system,partitions,directory-traversal"
  "10.2|Restrict access to the web administration|Level 2|Not Scored|access-control,administration,remote-access"
  "10.3|Restrict manager application|Level 2|Not Scored|access-control,administration,manager-app"
  "10.4|Force SSL when accessing the manager application|Level 1|Scored|ssl-tls,administration,confidentiality"
  "10.5|Rename the manager application|Level 2|Scored|obscurity,administration,attack-surface"
  "10.6|Enable strict servlet Compliance|Level 1|Scored|servlets,compliance,security"
  "10.7|Turn off session facade recycling|Level 1|Scored|sessions,information-disclosure,facades"
  "10.8|Do not allow additional path delimiters|Level 2|Scored|path-traversal,url-encoding,directory-traversal"
  "10.9|Do not allow custom header status messages|Level 2|Scored|http-headers,xss,custom-messages"
  "10.10|Configure connectionTimeout|Level 2|Scored|dos,timeouts,resource-management"
  "10.11|Configure maxHttpHeaderSize|Level 2|Scored|dos,http-headers,resource-limits"
  "10.12|Force SSL for all applications|Level 2|Scored|ssl-tls,encryption,transport-security"
  "10.13|Do not allow symbolic linking|Level 1|Scored|symbolic-links,directory-traversal,file-access"
  "10.14|Do not run applications as privileged|Level 1|Scored|privilege-escalation,class-loader,security"
  "10.15|Do not allow cross context requests|Level 1|Scored|cross-context,application-isolation,security"
  "10.16|Do not resolve hosts on logging valves|Level 2|Scored|logging,dns-lookups,performance"
  "10.17|Enable memory leak listener|Level 1|Scored|memory-leaks,resource-management,stability"
  "10.18|Setting Security Lifecycle Listener|Level 1|Scored|security-lifecycle,umask,startup-security"
  "10.19|use the logEffectiveWebXml and metadata-complete settings for deploying applications in production|Level 1|Scored|deployment,metadata,web-xml,fragments"
)

echo "Generating ${#CONTROLS[@]} SKILL.md files for CIS Apache Tomcat 7 Benchmark v1.1.0..."

for control_line in "${CONTROLS[@]}"; do
  IFS='|' read -r cis_id title profile scored tags <<< "$control_line"

  # Create directory name
  dir_name="cis-tomcat7-v110-${cis_id}"
  skill_dir="${BASE_DIR}/${dir_name}"

  mkdir -p "$skill_dir"

  # Determine severity based on profile
  if [[ "$profile" == "Level 1" ]]; then
    severity="high"
  else
    severity="medium"
  fi

  # Create SKILL.md file
  cat > "${skill_dir}/SKILL.md" << EOF
---
name: ${dir_name}
description: "${title}"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-7, ${tags}]
cis_id: "${cis_id}"
cis_benchmark: "CIS Apache Tomcat 7 Benchmark v1.1.0"
tech_stack: [tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Apache Tomcat 7 Benchmark v1.1.0 - Control ${cis_id}

## Profile Applicability
- ${profile}

## Description
${title}

**Note**: This is an auto-generated skeleton. Please refer to the CIS Apache Tomcat 7 Benchmark v1.1.0 PDF (pages 9-90) for complete details including:
- Full description and rationale
- Detailed audit procedures with exact commands
- Step-by-step remediation instructions
- Impact analysis
- Default values
- References

## Audit Procedure

Refer to CIS Apache Tomcat 7 Benchmark v1.1.0 - Section ${cis_id}

## Remediation

Refer to CIS Apache Tomcat 7 Benchmark v1.1.0 - Section ${cis_id}

## References
- CIS Apache Tomcat 7 Benchmark v1.1.0
- https://www.cisecurity.org/

## CIS Controls
| CIS Control | Description |
|-------------|-------------|
| Version 7 | Refer to benchmark document |
| Version 8 | Refer to benchmark document |

## Assessment Status
- **Scored**: ${scored}
- **Profile**: ${profile}
EOF

  echo "Created: ${dir_name}/SKILL.md"
done

echo ""
echo "========================================="
echo "Generation complete!"
echo "Total files created: ${#CONTROLS[@]}"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Review the PDF (pages 9-90) for each control"
echo "2. Fill in complete audit procedures and remediation steps"
echo "3. Add CWE IDs where applicable"
echo "4. Update chains_with for related controls"
echo ""
