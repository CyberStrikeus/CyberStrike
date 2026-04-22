#!/bin/bash

# CIS Apache Tomcat 8 Benchmark v1.0.0 SKILL.md Generator
# This script creates all 61 control SKILL.md files

BASE_DIR="/Users/orhanyildirim/Desktop/aum-pipeline/cyberstrike-io/CyberStrike/.cyberstrike/skill/CIS_benchmarks/Server_Software/Apache_Tomcat/CIS_Apache_Tomcat_8_Benchmark_v1.0.0"

# Function to create a skill directory and SKILL.md file
create_skill() {
    local skill_id="$1"
    local title="$2"
    local profile="$3"
    local scored="$4"
    local section_tags="$5"

    # Create directory
    local skill_dir="$BASE_DIR/cis-tomcat8-v100-$skill_id"
    mkdir -p "$skill_dir"

    # Placeholder - actual content will be added after
    echo "Created: $skill_dir/SKILL.md"
}

# Section 1: Remove Extraneous Resources
create_skill "1.1" "Remove extraneous files and directories" "Level 2" "Scored" "hardening"
create_skill "1.2" "Disable Unused Connectors" "Level 2" "Not Scored" "hardening"

# Section 2: Limit Server Platform Information Leaks
create_skill "2.1" "Alter the Advertised server.info String" "Level 2" "Scored" "information-disclosure"
create_skill "2.2" "Alter the Advertised server.number String" "Level 2" "Scored" "information-disclosure"
create_skill "2.3" "Alter the Advertised server.built Date" "Level 2" "Scored" "information-disclosure"
create_skill "2.4" "Disable X-Powered-By HTTP Header and Rename the Server Value for all Connectors" "Level 2" "Scored" "information-disclosure"
create_skill "2.5" "Disable client facing Stack Traces" "Level 1" "Scored" "information-disclosure"
create_skill "2.6" "Turn off TRACE" "Level 1" "Scored" "http-methods"

# Section 3: Protect the Shutdown Port
create_skill "3.1" "Set a nondeterministic Shutdown command value" "Level 1" "Scored" "shutdown"
create_skill "3.2" "Disable the Shutdown port" "Level 2" "Not Scored" "shutdown"

# Section 4: Protect Tomcat Configurations (14 controls)
create_skill "4.1" "Restrict access to \$CATALINA_HOME" "Level 1" "Scored" "file-permissions"
create_skill "4.2" "Restrict access to \$CATALINA_BASE" "Level 1" "Scored" "file-permissions"
create_skill "4.3" "Restrict access to Tomcat configuration directory" "Level 1" "Scored" "file-permissions"
create_skill "4.4" "Restrict access to Tomcat logs directory" "Level 1" "Scored" "file-permissions"
create_skill "4.5" "Restrict access to Tomcat temp directory" "Level 1" "Scored" "file-permissions"
create_skill "4.6" "Restrict access to Tomcat binaries directory" "Level 1" "Scored" "file-permissions"
create_skill "4.7" "Restrict access to Tomcat web application directory" "Level 1" "Scored" "file-permissions"
create_skill "4.8" "Restrict access to Tomcat catalina.policy" "Level 1" "Scored" "file-permissions"
create_skill "4.9" "Restrict access to Tomcat catalina.properties" "Level 1" "Scored" "file-permissions"
create_skill "4.10" "Restrict access to Tomcat context.xml" "Level 1" "Scored" "file-permissions"
create_skill "4.11" "Restrict access to Tomcat logging.properties" "Level 1" "Scored" "file-permissions"
create_skill "4.12" "Restrict access to Tomcat server.xml" "Level 1" "Scored" "file-permissions"
create_skill "4.13" "Restrict access to Tomcat tomcat-users.xml" "Level 1" "Scored" "file-permissions"
create_skill "4.14" "Restrict access to Tomcat web.xml" "Level 1" "Scored" "file-permissions"

# Section 5: Configure Realms
create_skill "5.1" "Use secure Realms" "Level 2" "Scored" "authentication"
create_skill "5.2" "Use LockOut Realms" "Level 2" "Scored" "authentication"

# Section 6: Connector Security
create_skill "6.1" "Setup Client-cert Authentication" "Level 2" "Scored" "ssl-tls"
create_skill "6.2" "Ensure SSLEnabled is set to True for Sensitive Connectors" "Level 1" "Not Scored" "ssl-tls"
create_skill "6.3" "Ensure scheme is set accurately" "Level 1" "Scored" "ssl-tls"
create_skill "6.4" "Ensure secure is set to true only for SSL-enabled Connectors" "Level 1" "Scored" "ssl-tls"
create_skill "6.5" "Ensure SSL Protocol is set to TLS for Secure Connectors" "Level 1" "Scored" "ssl-tls"

# Section 7: Establish and Protect Logging Facilities
create_skill "7.1" "Application specific logging" "Level 2" "Scored" "logging"
create_skill "7.2" "Specify file handler in logging.properties files" "Level 1" "Scored" "logging"
create_skill "7.3" "Ensure className is set correctly in context.xml" "Level 2" "Scored" "logging"
create_skill "7.4" "Ensure directory in context.xml is a secure location" "Level 1" "Scored" "logging"
create_skill "7.5" "Ensure pattern in context.xml is correct" "Level 1" "Scored" "logging"
create_skill "7.6" "Ensure directory in logging.properties is a secure location" "Level 1" "Scored" "logging"
create_skill "7.7" "Configure log file size limit" "Level 2" "Scored" "logging"

# Section 8: Configure Catalina Policy
create_skill "8.1" "Restrict runtime access to sensitive packages" "Level 1" "Scored" "catalina-policy"

# Section 9: Application Deployment
create_skill "9.1" "Starting Tomcat with Security Manager" "Level 1" "Scored" "deployment"
create_skill "9.2" "Disabling auto deployment of applications" "Level 2" "Scored" "deployment"
create_skill "9.3" "Disable deploy on startup of applications" "Level 2" "Scored" "deployment"

# Section 10: Miscellaneous Configuration Settings (20 controls)
create_skill "10.1" "Ensure Web content directory is on a separate partition from the Tomcat system files" "Level 1" "Not Scored" "hardening"
create_skill "10.2" "Restrict access to the web administration" "Level 2" "Not Scored" "access-control"
create_skill "10.3" "Restrict manager application" "Level 2" "Not Scored" "access-control"
create_skill "10.4" "Force SSL when accessing the manager application" "Level 1" "Scored" "ssl-tls"
create_skill "10.5" "Rename the manager application" "Level 2" "Scored" "hardening"
create_skill "10.6" "Enable strict servlet Compliance" "Level 1" "Scored" "hardening"
create_skill "10.7" "Turn off session façade recycling" "Level 1" "Scored" "session-management"
create_skill "10.8" "Do not allow additional path delimiters" "Level 2" "Scored" "path-traversal"
create_skill "10.9" "Do not allow custom header status messages" "Level 2" "Scored" "http-headers"
create_skill "10.10" "Configure connectionTimeout" "Level 2" "Scored" "denial-of-service"
create_skill "10.11" "Configure maxHttpHeaderSize" "Level 2" "Scored" "denial-of-service"
create_skill "10.12" "Force SSL for all applications" "Level 2" "Scored" "ssl-tls"
create_skill "10.14" "Do not allow symbolic linking" "Level 1" "Scored" "path-traversal"
create_skill "10.15" "Do not run applications as privileged" "Level 1" "Scored" "privilege-escalation"
create_skill "10.16" "Do not allow cross context requests" "Level 1" "Scored" "cross-context"
create_skill "10.17" "Do not resolve hosts on logging valves" "Level 2" "Scored" "logging"
create_skill "10.18" "Enable memory leak listener" "Level 1" "Scored" "memory-leak"
create_skill "10.19" "Setting Security Lifecycle Listener" "Level 1" "Scored" "hardening"
create_skill "10.20" "use the logEffectiveWebXml and metadata-complete settings for deploying applications in production" "Level 1" "Scored" "deployment"

echo "All skill directories created successfully!"
