import z from "zod"
import { Tool } from "../tool"
import { run } from "./shared"
import type { Finding, HookResult } from "./shared"

import {
  iamEnum,
  ec2Enum,
  s3Enum,
  lambdaEnum,
  vpcEnum,
  rdsEnum,
  ecsEnum,
  eksEnum,
  ssoEnum,
  orgEnum,
  route53Enum,
  serviceRecon,
  cfnEnum,
  apigwEnum,
  snsSqsEnum,
  cloudwatchEnum,
  elasticacheEnum,
  redshiftEnum,
} from "./recon"
import {
  metadataHarvest,
  secretsDump,
  accessKeyEnum,
  roleCredential,
  federationToken,
  ecrToken,
  consoleLogin,
  cognitoToken,
  cfnSecretExtract,
  codecommitCred,
  ciCdSecretExtract,
} from "./credential"
import {
  iamPrivesc,
  policyVersionRollback,
  roleChain,
  lambdaPrivesc,
  gluePrivesc,
  cloudformationPrivesc,
  ssmPrivesc,
  ec2Privesc,
  permissionBoundaryBypass,
  sagemakerPrivesc,
} from "./privesc"
import {
  lambdaBackdoor,
  iamBackdoor,
  eventbridgeBackdoor,
  ssmDocumentBackdoor,
  codebuildBackdoor,
  amiBackdoor,
  crossAccountRole,
  cognitoBackdoor,
  ec2InstanceConnect,
  ssmStateManager,
  ecsScheduledTask,
} from "./persistence"
import {
  ssmExec,
  ecsExec,
  crossAccountEnum,
  vpcPeeringEnum,
  transitGatewayEnum,
  lightsailExec,
  codeExecLambda,
  ssmSession,
} from "./lateral"
import {
  cloudtrailBlind,
  guarddutyEvade,
  configDisable,
  vpcFlowDisable,
  accessAnalyzerSuppress,
  securityHubSuppress,
  wafBypass,
  dnsFirewallDisable,
  cloudwatchTamper,
  macieDisable,
  inspectorDisable,
  s3LoggingDisable,
} from "./evasion"
import {
  s3Dump,
  ec2Snapshot,
  rdsDump,
  dynamodbDump,
  ebsDirectRead,
  s3Exfil,
  dataStage,
  cleanupAws,
  codecommitDump,
  ecrDump,
  athenaQuery,
  secretsBulkExport,
} from "./exfil"

const PROGRAMS = {
  // ── Recon (18) ──
  iam_enum: {
    description:
      "Enumerate IAM users, roles, policies, and analyze for privilege escalation paths (PassRole, wildcard policies, inline policy abuse)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  ec2_enum: {
    description: "Enumerate EC2 instances, AMIs, security groups, key pairs, and extract user-data secrets",
    args: "[--profile PROFILE] [--region REGION]",
  },
  s3_enum: {
    description: "Enumerate S3 buckets with policies, ACLs, encryption, versioning, and public access analysis",
    args: "[--profile PROFILE] [--region REGION]",
  },
  lambda_enum: {
    description: "Enumerate Lambda functions, layers, event sources, and detect secrets in environment variables",
    args: "[--profile PROFILE] [--region REGION]",
  },
  vpc_enum: {
    description: "Enumerate VPCs, subnets, route tables, NAT gateways, VPC endpoints, and peering connections",
    args: "[--profile PROFILE] [--region REGION]",
  },
  rds_enum: {
    description: "Enumerate RDS instances, clusters, snapshots, public access, encryption, and shared snapshots",
    args: "[--profile PROFILE] [--region REGION]",
  },
  ecs_enum: {
    description: "Enumerate ECS clusters, services, tasks, task definitions, and detect secrets in container env vars",
    args: "[--profile PROFILE] [--region REGION]",
  },
  eks_enum: {
    description: "Enumerate EKS clusters, node groups, Fargate profiles, OIDC providers, and public endpoint exposure",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sso_enum: {
    description:
      "Enumerate AWS SSO/IAM Identity Center: instances, permission sets, account assignments, and identity store users/groups",
    args: "[--instance-arn ARN] [--profile PROFILE] [--region REGION]",
  },
  org_enum: {
    description:
      "Enumerate AWS Organizations: accounts, OUs, SCPs, delegated administrators, and cross-account trust relationships",
    args: "[--profile PROFILE] [--region REGION]",
  },
  route53_enum: {
    description:
      "Enumerate Route 53 hosted zones, DNS records, health checks, resolver endpoints, and detect subdomain takeover targets",
    args: "[--profile PROFILE] [--region REGION]",
  },
  service_recon: {
    description:
      "Quick account-wide service usage summary: identity, aliases, enabled regions, resource counts across major services",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cfn_enum: {
    description:
      "Enumerate CloudFormation stacks, extract templates with secret detection, parameters, outputs, IAM resources, and cross-stack exports",
    args: "[--profile PROFILE] [--region REGION]",
  },
  apigw_enum: {
    description:
      "Enumerate API Gateway REST/HTTP/WebSocket APIs, stages, routes, API keys (with values), and authorizer configuration",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sns_sqs_enum: {
    description:
      "Enumerate SNS topics with subscriptions and policies, SQS queues with policies, encryption, and message counts",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cloudwatch_enum: {
    description:
      "Enumerate CloudWatch log groups (security-relevant), alarms (disabled actions), dashboards, and custom metrics",
    args: "[--profile PROFILE] [--region REGION]",
  },
  elasticache_enum: {
    description:
      "Enumerate ElastiCache Redis/Memcached clusters — auth status, encryption, replication groups, subnets, snapshots",
    args: "[--profile PROFILE] [--region REGION]",
  },
  redshift_enum: {
    description:
      "Enumerate Redshift clusters (classic + serverless) — public access, encryption, audit logging, snapshots with cross-account sharing",
    args: "[--profile PROFILE] [--region REGION]",
  },

  // ── Credential Harvesting (11) ──
  metadata_harvest: {
    description:
      "Extract IAM role credentials from EC2/ECS/Lambda metadata endpoints (169.254.169.254). Supports IMDSv1 and IMDSv2",
    args: "[--imds-version v1|v2]",
  },
  secrets_dump: {
    description:
      "Extract all secrets from AWS Secrets Manager and SSM Parameter Store (SecureString parameters with decryption)",
    args: "[--service secretsmanager|ssm|all] [--profile PROFILE] [--region REGION]",
  },
  access_key_enum: {
    description:
      "Find all active access keys across IAM users with age, last-used date, and identify stale/unused keys",
    args: "[--profile PROFILE] [--region REGION]",
  },
  role_credential: {
    description: "Assume IAM role for temporary credentials via STS AssumeRole with optional external ID and duration",
    args: "--role-arn ARN [--session-name NAME] [--duration SECS] [--external-id ID] [--profile PROFILE]",
  },
  federation_token: {
    description: "Get federation token for AWS console access from programmatic credentials (STS GetFederationToken)",
    args: "[--name NAME] [--duration SECS] [--profile PROFILE]",
  },
  ecr_token: {
    description: "Extract ECR registry auth token for container image pull/push, enumerate repositories and tags",
    args: "[--profile PROFILE] [--region REGION]",
  },
  console_login: {
    description:
      "Create or update IAM console login profile for programmatic-only users (password-based console access)",
    args: "--user-name NAME [--password PW] [--profile PROFILE]",
  },
  cognito_token: {
    description:
      "Enumerate Cognito user/identity pools, extract client secrets, obtain AWS credentials from identity pools",
    args: "[--user-pool-id ID] [--identity-pool-id ID] [--profile PROFILE] [--region REGION]",
  },
  cfn_secret_extract: {
    description:
      "Extract secrets from CloudFormation stacks: parameters (including NoEcho via get-template), template hardcoded values, and outputs",
    args: "[--stack-name NAME] [--profile PROFILE] [--region REGION]",
  },
  codecommit_cred: {
    description: "Enumerate CodeCommit repositories and HTTPS Git/SSH credentials across all IAM users",
    args: "[--profile PROFILE] [--region REGION]",
  },
  ci_cd_secret_extract: {
    description:
      "Extract secrets from CI/CD: CodePipeline artifact stores, CodeBuild env vars (plaintext/SSM/Secrets Manager refs), CodeStar connections",
    args: "[--profile PROFILE] [--region REGION]",
  },

  // ── Privilege Escalation (10) ──
  iam_privesc: {
    description:
      "Exploit IAM misconfigurations for privilege escalation: PassRole+Lambda, AssumeRole chaining, AttachUserPolicy, CreateLoginProfile, CreateAccessKey",
    args: "--method <passrole|assumerole|attach_policy|create_login|create_key> [--role-arn ARN] [--profile PROFILE]",
  },
  policy_version_rollback: {
    description: "Roll back IAM policy to a previous, more permissive version by setting it as default",
    args: "--policy-arn ARN [--rollback] [--version-id VER] [--profile PROFILE]",
  },
  role_chain: {
    description: "Multi-hop role assumption chain: A→B→C for cross-account/service privilege escalation",
    args: "ARN1 ARN2 [ARN3...] [--profile PROFILE] [--region REGION]",
  },
  lambda_privesc: {
    description: "Create Lambda function with high-privilege role to execute arbitrary code as that role",
    args: "--role-arn ARN [--function-name NAME] [--command CMD] [--profile PROFILE]",
  },
  glue_privesc: {
    description: "Exploit Glue jobs/dev endpoints with high-privilege roles for code execution and credential theft",
    args: "--role-arn ARN [--command CMD] [--profile PROFILE] [--region REGION]",
  },
  cloudformation_privesc: {
    description: "Create CloudFormation stack with IAM resource creation capabilities using a service role",
    args: "[--role-arn ARN] [--stack-name NAME] [--profile PROFILE] [--region REGION]",
  },
  ssm_privesc: {
    description:
      "Exploit SSM RunCommand to execute on instances with high-privilege instance profiles for credential harvesting",
    args: "[--instance-id ID] [--command CMD] [--profile PROFILE] [--region REGION]",
  },
  ec2_privesc: {
    description:
      "Enumerate instance profiles with high-privilege roles, launch EC2 with target profile for metadata credential extraction",
    args: "[--instance-profile-arn ARN] [--profile PROFILE] [--region REGION]",
  },
  permission_boundary_bypass: {
    description:
      "Analyze IAM permission boundaries for bypass techniques: self-modification, new entity creation, resource-based policies",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sagemaker_privesc: {
    description: "Exploit SageMaker notebooks/training jobs with high-privilege execution roles for credential access",
    args: "[--role-arn ARN] [--profile PROFILE] [--region REGION]",
  },

  // ── Persistence (11) ──
  lambda_backdoor: {
    description:
      "Inject reverse shell layer into existing Lambda function or create new backdoor function with high-privilege role",
    args: "--function-name NAME --callback-url URL [--method inject|create] [--profile PROFILE]",
  },
  iam_backdoor: {
    description:
      "Create shadow admin IAM user with AdministratorAccess, access keys, and console login for persistent access",
    args: "[--user-name NAME] [--profile PROFILE] [--region REGION]",
  },
  eventbridge_backdoor: {
    description: "Create EventBridge scheduled rule for persistent Lambda/SSM execution on a cron or rate schedule",
    args: "[--target-arn ARN] [--schedule EXPR] [--rule-name NAME] [--profile PROFILE]",
  },
  ssm_document_backdoor: {
    description: "Create custom SSM Command document for persistent command execution on managed instances",
    args: "[--document-name NAME] [--command CMD] [--list] [--profile PROFILE]",
  },
  codebuild_backdoor: {
    description:
      "Create CodeBuild project with buildspec that exfiltrates credentials using a high-privilege service role",
    args: "[--role-arn ARN] [--callback-url URL] [--project-name NAME] [--profile PROFILE]",
  },
  ami_backdoor: {
    description: "Create AMI from compromised instance to preserve implants for future launches",
    args: "[--instance-id ID] [--profile PROFILE] [--region REGION]",
  },
  cross_account_role: {
    description: "Create cross-account trust role with AdministratorAccess for external persistence and re-entry",
    args: "[--external-account ACCT] [--role-name NAME] [--profile PROFILE]",
  },
  cognito_backdoor: {
    description: "Add admin user to Cognito user pool for application-level persistence with auto-group assignment",
    args: "[--user-pool-id ID] [--username NAME] [--password PW] [--profile PROFILE]",
  },
  ec2_instance_connect: {
    description:
      "Push SSH public key to EC2 via Instance Connect (60s window) — enumerate eligible instances or push key for access",
    args: "[--instance-id ID] [--ssh-public-key KEY] [--os-user USER] [--enum] [--profile PROFILE] [--region REGION]",
  },
  ssm_state_manager: {
    description:
      "Create SSM State Manager association for scheduled command execution — more stealth than EventBridge (appears as normal SSM compliance)",
    args: "[--command CMD] [--instance-id ID] [--schedule EXPR] [--name NAME] [--list] [--profile PROFILE] [--region REGION]",
  },
  ecs_scheduled_task: {
    description:
      "Create EventBridge-triggered ECS Fargate scheduled task for serverless persistence — logs separate from Lambda, runs in target VPC",
    args: "[--cluster NAME] [--task-definition DEF] [--command CMD] [--schedule EXPR] [--rule-name NAME] [--list] [--profile PROFILE] [--region REGION]",
  },

  // ── Lateral Movement (8) ──
  ssm_exec: {
    description:
      "Execute commands on EC2 instances via AWS Systems Manager RunCommand — no SSH or direct network access required",
    args: "--instance-id ID --command CMD [--all-instances] [--profile PROFILE]",
  },
  ecs_exec: {
    description:
      "Execute commands inside running ECS Fargate/EC2 containers via ECS Exec (SSM-based) — no SSH or direct network access required",
    args: "--cluster CLUSTER --task TASK --container CONTAINER --command CMD [--all-tasks] [--profile PROFILE] [--region REGION]",
  },
  cross_account_enum: {
    description: "Enumerate cross-account trust relationships in IAM roles and attempt to assume them",
    args: "[--try-assume] [--profile PROFILE] [--region REGION]",
  },
  vpc_peering_enum: {
    description: "Enumerate VPC peering connections with route analysis for network pivoting between VPCs/accounts",
    args: "[--profile PROFILE] [--region REGION]",
  },
  transit_gateway_enum: {
    description: "Enumerate Transit Gateway attachments, routing tables, and cross-account network connectivity map",
    args: "[--profile PROFILE] [--region REGION]",
  },
  lightsail_exec: {
    description: "Enumerate Lightsail instances, extract default SSH key pair, and execute commands",
    args: "[--instance-name NAME] [--command CMD] [--profile PROFILE] [--region REGION]",
  },
  code_exec_lambda: {
    description:
      "Direct Lambda function invocation for arbitrary code execution, with VPC-attached function pivot analysis",
    args: "[--function-name NAME] [--command CMD] [--payload JSON] [--profile PROFILE]",
  },
  ssm_session: {
    description:
      "SSM Session Manager for interactive shell, port forwarding (local and remote host), with session logging check",
    args: "[--instance-id ID] [--port-forward LOCAL:REMOTE] [--remote-host HOST] [--profile PROFILE] [--region REGION]",
  },

  // ── Defense Evasion (12) ──
  cloudtrail_blind: {
    description:
      "Stop CloudTrail logging, manipulate event selectors to exclude management events, or delete existing log files from S3",
    args: "--action <stop|delete_logs|modify_selectors|status> [--trail-name NAME] [--profile PROFILE]",
  },
  guardduty_evade: {
    description:
      "Suspend/disable GuardDuty detectors, archive findings, or create auto-archive filter to suppress all alerts",
    args: "[--action status|suspend|suppress|filter] [--profile PROFILE] [--region REGION]",
  },
  config_disable: {
    description: "Stop AWS Config recorder and delete delivery channels to prevent configuration change tracking",
    args: "[--action status|stop|delete_channel] [--profile PROFILE] [--region REGION]",
  },
  vpc_flow_disable: {
    description: "Delete VPC Flow Log subscriptions to stop network traffic logging",
    args: "[--action status|delete] [--profile PROFILE] [--region REGION]",
  },
  access_analyzer_suppress: {
    description: "Archive IAM Access Analyzer findings or delete analyzers to hide external access exposure",
    args: "[--action status|archive|delete] [--profile PROFILE] [--region REGION]",
  },
  security_hub_suppress: {
    description: "Batch suppress/archive Security Hub findings or disable Security Hub entirely",
    args: "[--action status|suppress|disable] [--profile PROFILE] [--region REGION]",
  },
  waf_bypass: {
    description: "Enumerate WAF web ACLs, rules, and IP sets for bypass analysis (regional and CloudFront scopes)",
    args: "[--action status] [--profile PROFILE] [--region REGION]",
  },
  dns_firewall_disable: {
    description: "Enumerate and disassociate Route 53 Resolver DNS Firewall rule groups from VPCs",
    args: "[--action status|disassociate] [--profile PROFILE] [--region REGION]",
  },
  cloudwatch_tamper: {
    description:
      "CloudWatch Logs tampering: delete log groups/streams, reduce retention to 1 day, target security-relevant groups (CloudTrail, GuardDuty, VPC Flow)",
    args: "[--action status|delete|reduce_retention|delete_streams] [--log-group NAME] [--retention DAYS] [--profile PROFILE] [--region REGION]",
  },
  macie_disable: {
    description: "Suspend or permanently disable Amazon Macie sensitive data discovery, enumerate classification jobs",
    args: "[--action status|suspend|disable] [--profile PROFILE] [--region REGION]",
  },
  inspector_disable: {
    description: "Disable Amazon Inspector vulnerability scanning for EC2, ECR, Lambda, and Lambda code",
    args: "[--action status|disable] [--profile PROFILE] [--region REGION]",
  },
  s3_logging_disable: {
    description:
      "Disable S3 access logging and remove S3 object-level data events from CloudTrail — makes s3_dump/s3_exfil invisible",
    args: "[--action status|disable_access_log|disable_data_events] [--bucket BUCKET] [--profile PROFILE] [--region REGION]",
  },

  // ── Exfiltration & Cleanup (12) ──
  s3_dump: {
    description:
      "List all S3 buckets, identify sensitive files (.env, backups, credentials, .pem, .key), and optionally download high-value targets",
    args: "[--bucket BUCKET] [--download] [--pattern REGEX] [--profile PROFILE]",
  },
  ec2_snapshot: {
    description:
      "Create EBS volume snapshots for data exfiltration, optionally share cross-account for offline analysis",
    args: "--volume-id VOL_ID [--share-account ACCOUNT_ID] [--profile PROFILE]",
  },
  rds_dump: {
    description:
      "Create RDS database snapshot, optionally share cross-account or restore to accessible instance for data extraction",
    args: "--db-identifier ID [--share-account ACCOUNT_ID] [--restore] [--profile PROFILE] [--region REGION]",
  },
  dynamodb_dump: {
    description: "Scan DynamoDB tables for data extraction with secret detection and item-level enumeration",
    args: "[--table-name TABLE] [--limit N] [--profile PROFILE] [--region REGION]",
  },
  ebs_direct_read: {
    description: "List EBS snapshot blocks via Direct API for block-level read without EC2 instance (offline analysis)",
    args: "[--snapshot-id SNAP_ID] [--profile PROFILE] [--region REGION]",
  },
  s3_exfil: {
    description: "Modify S3 bucket policy to grant external account read access for cross-account data exfiltration",
    args: "--bucket BUCKET --external-account ACCT [--profile PROFILE]",
  },
  data_stage: {
    description: "Compress and stage harvested data to attacker-controlled S3 bucket for extraction",
    args: "--source PATH --dest-bucket BUCKET [--no-compress] [--profile PROFILE]",
  },
  cleanup_aws: {
    description:
      "Remove all CyberStrike-created AWS resources (IAM, Lambda, snapshots, stacks, rules), restore CloudTrail logging. ALWAYS run before leaving",
    args: "[--dry-run] [--profile PROFILE]",
  },
  codecommit_dump: {
    description:
      "Dump CodeCommit repositories: enumerate repos, branches, root files, extract secret files (.env, credentials, .pem), clone URLs",
    args: "[--repo NAME] [--branch BRANCH] [--profile PROFILE] [--region REGION]",
  },
  ecr_dump: {
    description:
      "Enumerate ECR repositories, images with vulnerability scan results, repository policies, and extract auth tokens for image pull",
    args: "[--repository NAME] [--pull] [--profile PROFILE] [--region REGION]",
  },
  athena_query: {
    description:
      "Query S3 data lakes via Athena: enumerate catalogs, databases, tables, workgroups, recent queries, and execute SQL queries",
    args: "[--query-string SQL] [--database DB] [--output-bucket BUCKET] [--profile PROFILE] [--region REGION]",
  },
  secrets_bulk_export: {
    description:
      "Bulk extract all Secrets Manager secrets + SSM SecureString parameters with optional S3 staging as JSON or .env format",
    args: "[--dest-bucket BUCKET] [--format json|env] [--profile PROFILE] [--region REGION]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS

const CWE_MAP: Record<string, string> = {
  "AWS-ENUM-001": "CWE-269",
  "AWS-ENUM-002": "CWE-732",
  "AWS-ENUM-003": "CWE-269",
  "AWS-EC2-001": "CWE-284",
  "AWS-EC2-002": "CWE-284",
  "AWS-EC2-003": "CWE-200",
  "AWS-EC2-004": "CWE-312",
  "AWS-S3-001": "CWE-284",
  "AWS-S3-002": "CWE-284",
  "AWS-S3-003": "CWE-311",
  "AWS-S3-004": "CWE-284",
  "AWS-S3-005": "CWE-284",
  "AWS-LAMBDA-001": "CWE-312",
  "AWS-VPC-001": "CWE-284",
  "AWS-RDS-001": "CWE-284",
  "AWS-RDS-002": "CWE-311",
  "AWS-RDS-003": "CWE-284",
  "AWS-ECS-001": "CWE-284",
  "AWS-ECS-002": "CWE-312",
  "AWS-EKS-001": "CWE-284",
  "AWS-R53-001": "CWE-284",
  "AWS-SSO-001": "CWE-269",
  "AWS-ORG-001": "CWE-200",
  "AWS-CRED-001": "CWE-522",
  "AWS-CRED-002": "CWE-522",
  "AWS-CRED-003": "CWE-522",
  "AWS-CRED-004": "CWE-522",
  "AWS-CRED-005": "CWE-522",
  "AWS-CRED-006": "CWE-522",
  "AWS-CRED-007": "CWE-522",
  "AWS-COGNITO-001": "CWE-287",
  "AWS-COGNITO-002": "CWE-522",
  "AWS-COGNITO-003": "CWE-522",
  "AWS-PRIVESC-001": "CWE-269",
  "AWS-PRIVESC-002": "CWE-269",
  "AWS-PRIVESC-003": "CWE-269",
  "AWS-PRIVESC-004": "CWE-269",
  "AWS-PRIVESC-005": "CWE-269",
  "AWS-PRIVESC-006": "CWE-269",
  "AWS-PRIVESC-007": "CWE-269",
  "AWS-PRIVESC-008": "CWE-269",
  "AWS-PRIVESC-009": "CWE-269",
  "AWS-PRIVESC-010": "CWE-732",
  "AWS-PRIVESC-011": "CWE-269",
  "AWS-PERSIST-001": "CWE-547",
  "AWS-PERSIST-002": "CWE-547",
  "AWS-PERSIST-003": "CWE-547",
  "AWS-PERSIST-004": "CWE-547",
  "AWS-PERSIST-005": "CWE-547",
  "AWS-PERSIST-006": "CWE-284",
  "AWS-PERSIST-007": "CWE-284",
  "AWS-PERSIST-008": "CWE-547",
  "AWS-LATERAL-001": "CWE-284",
  "AWS-LATERAL-002": "CWE-284",
  "AWS-LATERAL-003": "CWE-284",
  "AWS-LATERAL-004": "CWE-522",
  "AWS-LATERAL-005": "CWE-78",
  "AWS-EVASION-001": "CWE-693",
  "AWS-EVASION-002": "CWE-693",
  "AWS-EVASION-003": "CWE-693",
  "AWS-EVASION-004": "CWE-693",
  "AWS-EVASION-005": "CWE-693",
  "AWS-EVASION-006": "CWE-693",
  "AWS-EVASION-007": "CWE-693",
  "AWS-EVASION-008": "CWE-693",
  "AWS-EVASION-009": "CWE-693",
  "AWS-EVASION-010": "CWE-693",
  "AWS-EXFIL-001": "CWE-200",
  "AWS-EXFIL-002": "CWE-200",
  "AWS-EXFIL-003": "CWE-284",
  "AWS-EXFIL-004": "CWE-200",
  "AWS-CFN-001": "CWE-312",
  "AWS-CFN-002": "CWE-312",
  "AWS-CFN-003": "CWE-312",
  "AWS-CFN-004": "CWE-200",
  "AWS-APIGW-001": "CWE-522",
  "AWS-APIGW-002": "CWE-284",
  "AWS-APIGW-003": "CWE-284",
  "AWS-SNS-001": "CWE-284",
  "AWS-SNS-002": "CWE-200",
  "AWS-SQS-001": "CWE-284",
  "AWS-SQS-002": "CWE-311",
  "AWS-CW-001": "CWE-200",
  "AWS-CW-002": "CWE-311",
  "AWS-CW-003": "CWE-693",
  "AWS-CFNSEC-001": "CWE-312",
  "AWS-CFNSEC-002": "CWE-312",
  "AWS-CFNSEC-003": "CWE-312",
  "AWS-CFNSEC-004": "CWE-200",
  "AWS-CODECOMMIT-001": "CWE-522",
  "AWS-CODECOMMIT-002": "CWE-522",
  "AWS-PERSIST-009": "CWE-284",
  "AWS-PERSIST-010": "CWE-547",
  "AWS-LATERAL-006": "CWE-284",
  "AWS-LATERAL-007": "CWE-693",
  "AWS-LATERAL-008": "CWE-284",
  "AWS-EVASION-011": "CWE-693",
  "AWS-EVASION-012": "CWE-693",
  "AWS-EVASION-013": "CWE-693",
  "AWS-EVASION-014": "CWE-693",
  "AWS-EVASION-015": "CWE-693",
  "AWS-EXFIL-005": "CWE-200",
  "AWS-EXFIL-006": "CWE-200",
  "AWS-EXFIL-007": "CWE-284",
  "AWS-EXFIL-008": "CWE-200",
  "AWS-EXFIL-009": "CWE-200",
  "AWS-EXFIL-010": "CWE-200",
  "AWS-ELASTICACHE-001": "CWE-287",
  "AWS-ELASTICACHE-002": "CWE-311",
  "AWS-ELASTICACHE-003": "CWE-311",
  "AWS-REDSHIFT-001": "CWE-284",
  "AWS-REDSHIFT-002": "CWE-311",
  "AWS-REDSHIFT-003": "CWE-693",
  "AWS-REDSHIFT-004": "CWE-284",
  "AWS-REDSHIFT-005": "CWE-284",
  "AWS-CICD-001": "CWE-200",
  "AWS-CICD-002": "CWE-312",
  "AWS-CICD-003": "CWE-312",
  "AWS-CICD-004": "CWE-200",
  "AWS-CICD-005": "CWE-269",
  "AWS-CICD-006": "CWE-200",
  "AWS-PERSIST-011": "CWE-547",
  "AWS-EVASION-016": "CWE-693",
  "AWS-EVASION-017": "CWE-693",
  "AWS-EXFIL-011": "CWE-200",
  "AWS-EXFIL-012": "CWE-200",
}

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  // recon
  iam_enum: iamEnum,
  ec2_enum: ec2Enum,
  s3_enum: s3Enum,
  lambda_enum: lambdaEnum,
  vpc_enum: vpcEnum,
  rds_enum: rdsEnum,
  ecs_enum: ecsEnum,
  eks_enum: eksEnum,
  sso_enum: ssoEnum,
  org_enum: orgEnum,
  route53_enum: route53Enum,
  service_recon: serviceRecon,
  cfn_enum: cfnEnum,
  apigw_enum: apigwEnum,
  sns_sqs_enum: snsSqsEnum,
  cloudwatch_enum: cloudwatchEnum,
  elasticache_enum: elasticacheEnum,
  redshift_enum: redshiftEnum,
  // credential
  metadata_harvest: (args) => metadataHarvest(args),
  secrets_dump: secretsDump,
  access_key_enum: accessKeyEnum,
  role_credential: roleCredential,
  federation_token: federationToken,
  ecr_token: ecrToken,
  console_login: consoleLogin,
  cognito_token: cognitoToken,
  cfn_secret_extract: cfnSecretExtract,
  codecommit_cred: codecommitCred,
  ci_cd_secret_extract: ciCdSecretExtract,
  // privesc
  iam_privesc: iamPrivesc,
  policy_version_rollback: policyVersionRollback,
  role_chain: roleChain,
  lambda_privesc: lambdaPrivesc,
  glue_privesc: gluePrivesc,
  cloudformation_privesc: cloudformationPrivesc,
  ssm_privesc: ssmPrivesc,
  ec2_privesc: ec2Privesc,
  permission_boundary_bypass: permissionBoundaryBypass,
  sagemaker_privesc: sagemakerPrivesc,
  // persistence
  lambda_backdoor: lambdaBackdoor,
  iam_backdoor: iamBackdoor,
  eventbridge_backdoor: eventbridgeBackdoor,
  ssm_document_backdoor: ssmDocumentBackdoor,
  codebuild_backdoor: codebuildBackdoor,
  ami_backdoor: amiBackdoor,
  cross_account_role: crossAccountRole,
  cognito_backdoor: cognitoBackdoor,
  ec2_instance_connect: ec2InstanceConnect,
  ssm_state_manager: ssmStateManager,
  ecs_scheduled_task: ecsScheduledTask,
  // lateral
  ssm_exec: ssmExec,
  ecs_exec: ecsExec,
  cross_account_enum: crossAccountEnum,
  vpc_peering_enum: vpcPeeringEnum,
  transit_gateway_enum: transitGatewayEnum,
  lightsail_exec: lightsailExec,
  code_exec_lambda: codeExecLambda,
  ssm_session: ssmSession,
  // evasion
  cloudtrail_blind: cloudtrailBlind,
  guardduty_evade: guarddutyEvade,
  config_disable: configDisable,
  vpc_flow_disable: vpcFlowDisable,
  access_analyzer_suppress: accessAnalyzerSuppress,
  security_hub_suppress: securityHubSuppress,
  waf_bypass: wafBypass,
  dns_firewall_disable: dnsFirewallDisable,
  cloudwatch_tamper: cloudwatchTamper,
  macie_disable: macieDisable,
  inspector_disable: inspectorDisable,
  s3_logging_disable: s3LoggingDisable,
  // exfil
  s3_dump: s3Dump,
  ec2_snapshot: ec2Snapshot,
  rds_dump: rdsDump,
  dynamodb_dump: dynamodbDump,
  ebs_direct_read: ebsDirectRead,
  s3_exfil: s3Exfil,
  data_stage: dataStage,
  cleanup_aws: cleanupAws,
  codecommit_dump: codecommitDump,
  ecr_dump: ecrDump,
  athena_query: athenaQuery,
  secrets_bulk_export: secretsBulkExport,
}

export const AwshookTool = Tool.define("awshook", {
  description: `Execute an AWS post-exploitation program after compromising IAM credentials or EC2 instance. Uses aws CLI (no Python/SDK dependency). 82 programs across 7 categories: recon (18), credential (11), privesc (10), persistence (11), lateral (8), evasion (12), exfil (12). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_aws before leaving a target.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "AWS program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    if (!Bun.which("aws")) {
      return {
        title: `awshook: ${params.program}`,
        output:
          "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    try {
      const handler = dispatch[params.program]
      const result = await handler(params.args, params.timeout_seconds)
      const enriched = result.findings.map((f) => ({
        ...f,
        cwe: CWE_MAP[f.checkId] || undefined,
      }))
      return {
        title: `awshook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: enriched },
      }
    } catch (e) {
      return {
        title: `awshook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
