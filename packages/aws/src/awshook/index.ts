import z from "zod"
import { tool } from "@cyberstrike-io/plugin"
import { Session } from "cyberstrike/public"
import { run } from "./shared"
import type { Finding, HookResult } from "./shared"
import { ingestFindings } from "./ingest"

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
  multiRegionScan,
  kmsEnum,
  opensearchEnum,
  efsEnum,
  elbEnum,
  dynamodbEnum,
  cognitoEnum,
  stsEnum,
  secretsManagerEnum,
  ssmEnum,
  sagemakerEnum,
  stepFunctionsEnum,
  glueEnum,
  codepipelineEnum,
  eventbridgeEnum,
  wafEnum,
  cloudtrailEnum,
  configEnum,
  guarddutyEnum,
  securityHubEnum,
  inspectorEnum,
  backupEnum,
  athenaEnum,
  emrEnum,
  mskEnum,
  ecrEnum,
  appRunnerEnum,
  amplifyEnum,
  acmEnum,
  transferFamilyEnum,
  publicExposureScan,
  stalePermissionAudit as stalePermissionAuditRecon,
  tagComplianceAudit,
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
  cloudtrailSelectorTamper,
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
  backupVaultEnum,
  cloudwatchLogsDump,
  snsSqsSiphon,
  kinesisTap,
} from "./exfil"
import {
  cisBenchmark,
  accessKeyRotation,
  mfaAudit,
  passwordPolicyCheck,
  rootAccountAudit,
  encryptionAudit,
  publicAccessAudit,
  loggingAudit,
  networkSegmentationAudit,
  dataClassificationAudit,
  backupComplianceAudit,
  iamBestPractices,
  vpcFlowLogAudit,
  s3PublicAudit,
  rdsPublicAudit,
  secretRotationAudit,
  serviceQuotaAudit,
  accountSecurityAudit,
} from "./compliance"
import {
  stsSessionEnum,
  crossAccountTrustEnum,
  iamDeepAudit,
  stalePermissionAudit,
  ssoDeepEnum,
  cognitoSecurityAudit,
  serviceLinkedRoleEnum,
  organizationPolicyEnum,
  passwordSprayAws,
  identitySummary,
  roleTrustAudit,
  crossAccountTrustAudit,
  serviceLinkedRoles,
  iamAccessLastUsed,
  identityProviderEnum,
  ssoPermissionAudit,
  cognitoIdentityAudit,
  stsSessionAudit,
  resourcePolicyAudit,
  groupMembershipAudit,
  permissionBoundaryAudit,
} from "./identity"
import {
  resourceHijack,
  dataDestroy,
  ransomwareSim,
  serviceDisruption,
  cryptominerDeploy,
  resourceDeletionCapability,
  serviceDisruptionAnalysis,
  dataDestructionPaths,
  accountLockoutRisk,
  cryptoMiningCheck,
  billingImpactAnalysis,
  dnsHijackCapability,
  networkDisruptionCapability,
} from "./impact"

const PROGRAMS = {
  // ── Recon (51) ──
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
  multi_region_scan: {
    description:
      "Scan all enabled AWS regions for EC2/Lambda/RDS/ECS resources — detect shadow deployments in non-primary regions",
    args: "[--profile PROFILE] [--region REGION]",
  },
  kms_enum: {
    description:
      "Enumerate KMS customer-managed keys, key policies (Principal:*), grants with cross-account access detection",
    args: "[--profile PROFILE] [--region REGION]",
  },
  opensearch_enum: {
    description:
      "Enumerate OpenSearch domains — public access, encryption, fine-grained access control, open resource policies",
    args: "[--profile PROFILE] [--region REGION]",
  },
  efs_enum: {
    description:
      "Enumerate EFS file systems, mount targets, security groups (0.0.0.0/0 NFS), encryption, resource policies",
    args: "[--profile PROFILE] [--region REGION]",
  },
  elb_enum: {
    description:
      "Enumerate ALB/NLB/Classic ELBs — internet-facing detection, SSL policy analysis, HTTP without redirect, listeners",
    args: "[--profile PROFILE] [--region REGION]",
  },
  dynamodb_enum: {
    description: "Enumerate DynamoDB tables — encryption (SSE), PITR status, streams, GSIs, billing mode analysis",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cognito_enum: {
    description: "Enumerate Cognito user pools (MFA, password policy, triggers) and identity pools (unauth access, role mappings)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sts_enum: {
    description: "Enumerate STS configuration — OIDC providers (thumbprint validation), SAML providers (certificate expiry)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  secrets_manager_enum: {
    description: "Enumerate Secrets Manager — rotation status, resource policies, last accessed date, stale secrets >90d",
    args: "[--profile PROFILE] [--region REGION]",
  },
  ssm_enum: {
    description: "Enumerate SSM — managed instances, custom documents, parameters (count/types), maintenance windows, patch compliance",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sagemaker_enum: {
    description: "Enumerate SageMaker — notebooks (root access, internet, KMS), endpoints, training jobs, execution roles",
    args: "[--profile PROFILE] [--region REGION]",
  },
  step_functions_enum: {
    description: "Enumerate Step Functions state machines — IAM roles, logging configuration, execution history",
    args: "[--profile PROFILE] [--region REGION]",
  },
  glue_enum: {
    description: "Enumerate Glue — databases, crawlers, jobs (SecurityConfiguration), DevEndpoints (public exposure)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  codepipeline_enum: {
    description: "Enumerate CodePipeline — pipelines, stages, cross-account actions, artifact store encryption",
    args: "[--profile PROFILE] [--region REGION]",
  },
  eventbridge_enum: {
    description: "Enumerate EventBridge — event buses (open policies), rules, targets, cross-account permissions",
    args: "[--profile PROFILE] [--region REGION]",
  },
  waf_enum: {
    description: "Enumerate WAFv2 — web ACLs (regional + CloudFront), managed rule groups, IP sets, regex patterns",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cloudtrail_enum: {
    description: "Enumerate CloudTrail — trails, multi-region status, event selectors, insight selectors, logging status",
    args: "[--profile PROFILE] [--region REGION]",
  },
  config_enum: {
    description: "Enumerate AWS Config — recorder status, delivery channels, compliance rules, non-compliant count, aggregators",
    args: "[--profile PROFILE] [--region REGION]",
  },
  guardduty_enum: {
    description: "Enumerate GuardDuty — detectors, features, high/critical finding counts, publishing destinations",
    args: "[--profile PROFILE] [--region REGION]",
  },
  security_hub_enum: {
    description: "Enumerate Security Hub — enabled standards, controls, critical finding count, integrations",
    args: "[--profile PROFILE] [--region REGION]",
  },
  inspector_enum: {
    description: "Enumerate Inspector v2 — account status, coverage by resource type, severity aggregations",
    args: "[--profile PROFILE] [--region REGION]",
  },
  backup_enum: {
    description: "Enumerate AWS Backup — plans, vaults, recovery points, vault access policies (open policies flagged)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  athena_enum: {
    description: "Enumerate Athena — workgroups (result encryption), data catalogs, named queries",
    args: "[--profile PROFILE] [--region REGION]",
  },
  emr_enum: {
    description: "Enumerate EMR — active clusters (visibility, security config), security configurations, encryption",
    args: "[--profile PROFILE] [--region REGION]",
  },
  msk_enum: {
    description: "Enumerate MSK Kafka — clusters, authentication, encryption in transit, open monitoring",
    args: "[--profile PROFILE] [--region REGION]",
  },
  ecr_enum: {
    description: "Enumerate ECR — repositories, scan-on-push status, open policies, image scan findings, lifecycle policies",
    args: "[--profile PROFILE] [--region REGION]",
  },
  app_runner_enum: {
    description: "Enumerate App Runner — services, VPC connectors, auto-scaling, health check configuration",
    args: "[--profile PROFILE] [--region REGION]",
  },
  amplify_enum: {
    description: "Enumerate Amplify — apps, branches, backend environments, basic auth status",
    args: "[--profile PROFILE] [--region REGION]",
  },
  acm_enum: {
    description: "Enumerate ACM certificates — expiry status (<30d flagged), domain validation, key algorithm, auto-renewal",
    args: "[--profile PROFILE] [--region REGION]",
  },
  transfer_family_enum: {
    description: "Enumerate Transfer Family — servers, protocols (FTP flagged), identity providers, endpoint type",
    args: "[--profile PROFILE] [--region REGION]",
  },
  public_exposure_scan: {
    description: "Comprehensive public exposure audit — EIPs, internet-facing ELBs, public RDS, S3 websites, CloudFront, public API GWs",
    args: "[--profile PROFILE] [--region REGION]",
  },
  stale_permission_audit_recon: {
    description: "IAM staleness audit — credential report analysis, access key age >90d, stale passwords, missing MFA",
    args: "[--profile PROFILE] [--region REGION]",
  },
  tag_compliance_audit: {
    description: "Tag compliance — scan EC2/RDS/S3/Lambda for required tags (Environment, Owner, CostCenter), report untagged resources",
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

  // ── Defense Evasion (13) ──
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
  cloudtrail_selector_tamper: {
    description:
      "Surgically modify CloudTrail event selectors — exclude KMS/S3 data events, set WriteOnly (stealthier than stopping trail)",
    args: "--action <status|exclude_kms|exclude_s3_data|management_read_only|restore> [--trail-name NAME] [--profile PROFILE] [--region REGION]",
  },

  // ── Exfiltration & Cleanup (16) ──
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
  backup_vault_enum: {
    description:
      "Enumerate AWS Backup vaults, recovery points across services, vault access policies for cross-account sharing",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cloudwatch_logs_dump: {
    description:
      "Export CloudWatch log groups to S3 for offline analysis — enumerate groups, sizes, retention, create export tasks",
    args: "[--log-group NAME] [--dest-bucket BUCKET] [--profile PROFILE] [--region REGION]",
  },
  sns_sqs_siphon: {
    description:
      "Intercept messages: subscribe to SNS topics (email/HTTPS/Lambda) and poll SQS queues for in-flight data",
    args: "[--topic-arn ARN] [--queue-url URL] [--endpoint ENDPOINT] [--max-messages N] [--profile PROFILE] [--region REGION]",
  },
  kinesis_tap: {
    description: "Tap Kinesis data streams — enumerate streams/shards and read records for real-time data interception",
    args: "[--stream-name NAME] [--limit N] [--profile PROFILE] [--region REGION]",
  },

  // ── Compliance (18) ──
  cis_benchmark: {
    description: "CIS AWS Foundations Benchmark — CloudTrail all-region, password policy, root MFA, default SG ingress (CIS 3.1, 1.8-1.14, 1.5, 5.4)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  access_key_rotation: {
    description: "Access key rotation audit — age analysis (>90d WARN, >180d FAIL), last-used date, stale/unused key detection",
    args: "[--profile PROFILE] [--region REGION]",
  },
  mfa_audit: {
    description: "MFA compliance audit — root MFA, virtual vs hardware MFA, per-user console access without MFA (CIS 1.5-1.6)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  password_policy_check: {
    description: "Password policy compliance — MinLength>=14, RequireSymbols/Numbers/Upper/Lower, MaxAge<=90, ReusePrevent>=24 (7 checks)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  root_account_audit: {
    description: "Root account security — access keys (should be 0), MFA enabled, credential report analysis, recent root usage detection",
    args: "[--profile PROFILE] [--region REGION]",
  },
  encryption_audit: {
    description: "Encryption-at-rest audit — EBS default, S3 bucket encryption, RDS StorageEncrypted, DynamoDB SSE, EFS Encrypted, SQS KMS",
    args: "[--profile PROFILE] [--region REGION]",
  },
  public_access_audit: {
    description: "Public access audit — S3 account/bucket blocks, RDS PubliclyAccessible, EC2 public IPs, Redshift public clusters",
    args: "[--profile PROFILE] [--region REGION]",
  },
  logging_audit: {
    description: "Logging compliance — CloudTrail multi-region, VPC flow logs, ELBv2 access logs, S3 access logging, RDS CloudWatch exports",
    args: "[--profile PROFILE] [--region REGION]",
  },
  network_segmentation_audit: {
    description: "Network segmentation — default VPC usage, SG 0.0.0.0/0 on non-80/443 ports, NACL allow-all rules",
    args: "[--profile PROFILE] [--region REGION]",
  },
  data_classification_audit: {
    description: "Data classification — unencrypted EBS volumes, unencrypted RDS, Amazon Macie session status",
    args: "[--profile PROFILE] [--region REGION]",
  },
  backup_compliance_audit: {
    description: "Backup compliance — RDS retention period, DynamoDB PITR, S3 versioning, AWS Backup plans existence",
    args: "[--profile PROFILE] [--region REGION]",
  },
  iam_best_practices: {
    description: "IAM best practices — inline policies on users, direct policy attachment (use groups), empty groups, unused service access",
    args: "[--profile PROFILE] [--region REGION]",
  },
  vpc_flow_log_audit: {
    description: "VPC Flow Log coverage — flag VPCs without flow logs, check traffic type (ALL vs ACCEPT/REJECT), inactive flow logs",
    args: "[--profile PROFILE] [--region REGION]",
  },
  s3_public_audit: {
    description: "S3 public exposure — bucket policy Principal:*, ACL public grants, website hosting enabled, PolicyStatus IsPublic",
    args: "[--profile PROFILE] [--region REGION]",
  },
  rds_public_audit: {
    description: "RDS security audit — PubliclyAccessible, StorageEncrypted, DeletionProtection, AutoMinorVersionUpgrade, monitoring, backups",
    args: "[--profile PROFILE] [--region REGION]",
  },
  secret_rotation_audit: {
    description: "Secret rotation — Secrets Manager RotationEnabled/LastRotatedDate (>90d stale), KMS key rotation status",
    args: "[--profile PROFILE] [--region REGION]",
  },
  service_quota_audit: {
    description: "Service quota utilization — EC2 instances, EIPs, VPCs, SGs, IAM limits. Flag >80% utilization",
    args: "[--profile PROFILE] [--region REGION]",
  },
  account_security_audit: {
    description: "Account-level security — EBS default encryption, S3 public access block, IMDSv2 enforcement, Organizations/SCPs, wildcard policies",
    args: "[--profile PROFILE] [--region REGION]",
  },

  // ── Identity (21) ──
  sts_session_enum: {
    description: "Enumerate STS capabilities — session duration, federation token generation, wildcard trust roles",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cross_account_trust_enum: {
    description: "Enumerate all cross-account trust relationships — roles trusting external accounts, missing ExternalId conditions",
    args: "[--profile PROFILE] [--region REGION]",
  },
  iam_deep_audit: {
    description: "Deep IAM audit — inline policies with wildcards, stale access keys, orphaned users, key age",
    args: "[--profile PROFILE] [--region REGION]",
  },
  stale_permission_audit: {
    description: "Audit stale permissions — admin policies, service wildcards, unused roles >90 days",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sso_deep_enum: {
    description: "Deep SSO/IAM Identity Center enum — permission sets, session durations, inline policies, identity store users/groups",
    args: "[--instance-arn ARN] [--profile PROFILE] [--region REGION]",
  },
  cognito_security_audit: {
    description: "Audit Cognito security — user pool MFA, password policy, app client auth flows, identity pool unauth access",
    args: "[--profile PROFILE] [--region REGION]",
  },
  service_linked_role_enum: {
    description: "Enumerate AWS service-linked roles — which services have created roles, service footprint",
    args: "[--profile PROFILE] [--region REGION]",
  },
  organization_policy_enum: {
    description: "Enumerate Organization SCPs — policy content, targets, feature set, guardrail coverage",
    args: "[--profile PROFILE] [--region REGION]",
  },
  password_spray_aws: {
    description: "IAM password spray assessment — enumerate console users, identify weak-password candidates (non-destructive)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  identity_summary: {
    description: "Full identity landscape — user/role/group/policy counts, identity providers, SSO status, Organizations membership",
    args: "[--profile PROFILE] [--region REGION]",
  },
  role_trust_audit: {
    description: "Role trust policy analysis — over-permissive trust (Principal:*), cross-account trusts, unusual service principals, confused deputy",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cross_account_trust_audit: {
    description: "Deep cross-account analysis — roles assumable externally, S3/KMS/SQS/SNS cross-account resource policies",
    args: "[--profile PROFILE] [--region REGION]",
  },
  service_linked_roles: {
    description: "Service-linked role inventory — SLR permissions, last used status, service footprint analysis",
    args: "[--profile PROFILE] [--region REGION]",
  },
  iam_access_last_used: {
    description: "IAM access analysis — service last accessed per role/user, unused services (bloated permissions), right-sizing",
    args: "[--profile PROFILE] [--region REGION]",
  },
  identity_provider_enum: {
    description: "External identity providers — SAML (metadata, certificate expiry), OIDC (client IDs, thumbprints, audience)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sso_permission_audit: {
    description: "SSO/IAM Identity Center deep dive — admin permission sets, inline policies, account assignments, MFA settings",
    args: "[--profile PROFILE] [--region REGION]",
  },
  cognito_identity_audit: {
    description: "Cognito identity pool security — unauthenticated role permissions, authenticated role policies, role mapping rules",
    args: "[--profile PROFILE] [--region REGION]",
  },
  sts_session_audit: {
    description: "Active STS sessions — assumed role sessions, federation sessions, overly long session durations (>4h flagged)",
    args: "[--profile PROFILE] [--region REGION]",
  },
  resource_policy_audit: {
    description: "Resource-based policy scan — S3/KMS/SQS/SNS/Lambda/ECR policies, flag Principal:* and cross-account access",
    args: "[--profile PROFILE] [--region REGION]",
  },
  group_membership_audit: {
    description: "IAM group analysis — group permissions, membership, users without groups, groups with admin, empty groups",
    args: "[--profile PROFILE] [--region REGION]",
  },
  permission_boundary_audit: {
    description: "Permission boundary inventory — roles/users with/without boundaries, boundary policy analysis, coverage gaps",
    args: "[--profile PROFILE] [--region REGION]",
  },

  // ── Impact (13) ──
  resource_hijack: {
    description: "Assess resource hijack vectors — EC2 user-data injection, Lambda code injection, S3 website defacement",
    args: "[--execute] [--profile PROFILE] [--region REGION]",
  },
  data_destroy: {
    description: "Assess data destruction vectors — unversioned S3, unprotected RDS/DynamoDB, deletion protection gaps",
    args: "[--execute] [--profile PROFILE] [--region REGION]",
  },
  ransomware_sim: {
    description: "Ransomware simulation assessment — KMS key creation, S3 re-encryption capability, MFA Delete gaps",
    args: "[--execute] [--profile PROFILE] [--region REGION]",
  },
  service_disruption: {
    description: "Assess service disruption vectors — SG modification, ASG scale-to-zero, DNS hijack, LB deletion",
    args: "[--execute] [--profile PROFILE] [--region REGION]",
  },
  cryptominer_deploy: {
    description: "Assess compute hijack surface — EC2 launch capability, Lambda create, vCPU quotas, cost alert gaps",
    args: "[--execute] [--profile PROFILE] [--region REGION]",
  },
  resource_deletion_capability: {
    description: "Analyze deletable resources — EC2/RDS/S3/Lambda/DynamoDB with deletion protection status, MFA Delete gaps",
    args: "[--profile PROFILE] [--region REGION]",
  },
  service_disruption_analysis: {
    description: "Service disruption potential — stoppable EC2, deletable ECS services, modifiable Route53, LB listeners",
    args: "[--profile PROFILE] [--region REGION]",
  },
  data_destruction_paths: {
    description: "Data destruction analysis — S3 without versioning, RDS without deletion protection, DynamoDB without PITR, unsnapshotted EBS",
    args: "[--profile PROFILE] [--region REGION]",
  },
  account_lockout_risk: {
    description: "Account lockout paths — IAM user/role deletion, MFA deactivation, password changes, access key deactivation",
    args: "[--profile PROFILE] [--region REGION]",
  },
  crypto_mining_check: {
    description: "Crypto mining exposure — GPU instance launch permissions, Lambda concurrency, Batch/SageMaker compute access",
    args: "[--profile PROFILE] [--region REGION]",
  },
  billing_impact_analysis: {
    description: "Billing impact — current spend (Cost Explorer), high-cost resources, expensive instance launch permissions, reserved instances",
    args: "[--profile PROFILE] [--region REGION]",
  },
  dns_hijack_capability: {
    description: "DNS hijack assessment — Route53 record modification, hosted zones, NS records, CloudFront distribution manipulation",
    args: "[--profile PROFILE] [--region REGION]",
  },
  network_disruption_capability: {
    description: "Network disruption — VPC/subnet deletion, route table modification, NACL/SG changes, NAT gateway removal, VPN/DX",
    args: "[--profile PROFILE] [--region REGION]",
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
  "AWS-REGION-001": "CWE-200",
  "AWS-KMS-001": "CWE-732",
  "AWS-KMS-002": "CWE-284",
  "AWS-OS-001": "CWE-284",
  "AWS-OS-002": "CWE-311",
  "AWS-OS-003": "CWE-284",
  "AWS-OS-004": "CWE-284",
  "AWS-EFS-001": "CWE-311",
  "AWS-EFS-002": "CWE-284",
  "AWS-EFS-003": "CWE-284",
  "AWS-ELB-001": "CWE-284",
  "AWS-ELB-002": "CWE-326",
  "AWS-ELB-003": "CWE-319",
  "AWS-ELB-004": "CWE-284",
  "AWS-EVASION-SELECTOR-001": "CWE-693",
  "AWS-BACKUP-001": "CWE-284",
  "AWS-BACKUP-002": "CWE-200",
  "AWS-CWLOGS-001": "CWE-200",
  "AWS-SNS-SIPHON-001": "CWE-200",
  "AWS-SQS-SIPHON-001": "CWE-200",
  "AWS-KINESIS-001": "CWE-200",
  // new recon
  "AWS-DYNAMO-001": "CWE-311",
  "AWS-DYNAMO-002": "CWE-693",
  "AWS-DYNAMO-003": "CWE-693",
  "AWS-COGNITO-ENUM-001": "CWE-287",
  "AWS-COGNITO-ENUM-002": "CWE-284",
  "AWS-STS-ENUM-001": "CWE-287",
  "AWS-SM-001": "CWE-320",
  "AWS-SM-002": "CWE-200",
  "AWS-SSM-ENUM-001": "CWE-200",
  "AWS-SAGEMAKER-001": "CWE-250",
  "AWS-SAGEMAKER-002": "CWE-284",
  "AWS-STEPFN-001": "CWE-778",
  "AWS-GLUE-001": "CWE-284",
  "AWS-GLUE-002": "CWE-284",
  "AWS-CODEPIPELINE-001": "CWE-311",
  "AWS-CODEPIPELINE-002": "CWE-284",
  "AWS-EB-001": "CWE-284",
  "AWS-WAF-ENUM-001": "CWE-693",
  "AWS-CT-ENUM-001": "CWE-778",
  "AWS-CT-ENUM-002": "CWE-778",
  "AWS-CT-ENUM-003": "CWE-778",
  "AWS-CONFIG-ENUM-001": "CWE-778",
  "AWS-CONFIG-ENUM-002": "CWE-778",
  "AWS-GD-ENUM-001": "CWE-778",
  "AWS-GD-ENUM-002": "CWE-200",
  "AWS-SECHUB-ENUM-001": "CWE-778",
  "AWS-INSPECTOR-ENUM-001": "CWE-778",
  "AWS-BACKUP-010": "CWE-284",
  "AWS-BACKUP-011": "CWE-200",
  "AWS-ATHENA-001": "CWE-311",
  "AWS-ATHENA-002": "CWE-311",
  "AWS-EMR-001": "CWE-200",
  "AWS-EMR-002": "CWE-284",
  "AWS-MSK-001": "CWE-287",
  "AWS-MSK-002": "CWE-311",
  "AWS-ECR-ENUM-001": "CWE-284",
  "AWS-ECR-ENUM-002": "CWE-284",
  "AWS-APPRUNNER-001": "CWE-200",
  "AWS-AMPLIFY-001": "CWE-200",
  "AWS-ACM-001": "CWE-324",
  "AWS-ACM-002": "CWE-326",
  "AWS-TRANSFER-001": "CWE-319",
  "AWS-EXPOSURE-001": "CWE-284",
  "AWS-EXPOSURE-002": "CWE-284",
  "AWS-EXPOSURE-003": "CWE-284",
  "AWS-STALE-001": "CWE-262",
  "AWS-STALE-002": "CWE-262",
  "AWS-STALE-003": "CWE-287",
  "AWS-TAG-001": "CWE-1059",
  // compliance
  "AWS-CIS-001": "CWE-778",
  "AWS-CIS-002": "CWE-521",
  "AWS-CIS-003": "CWE-308",
  "AWS-CIS-004": "CWE-284",
  "AWS-KEYROT-001": "CWE-262",
  "AWS-KEYROT-002": "CWE-262",
  "AWS-MFA-001": "CWE-308",
  "AWS-MFA-002": "CWE-308",
  "AWS-MFA-003": "CWE-308",
  "AWS-PWPOL-001": "CWE-521",
  "AWS-PWPOL-002": "CWE-521",
  "AWS-PWPOL-003": "CWE-521",
  "AWS-PWPOL-004": "CWE-521",
  "AWS-PWPOL-005": "CWE-521",
  "AWS-PWPOL-006": "CWE-521",
  "AWS-PWPOL-007": "CWE-521",
  "AWS-ROOT-001": "CWE-522",
  "AWS-ROOT-002": "CWE-308",
  "AWS-ROOT-003": "CWE-522",
  "AWS-ENC-001": "CWE-311",
  "AWS-ENC-002": "CWE-311",
  "AWS-ENC-003": "CWE-311",
  "AWS-ENC-004": "CWE-311",
  "AWS-ENC-005": "CWE-311",
  "AWS-ENC-006": "CWE-311",
  "AWS-PUBACC-001": "CWE-284",
  "AWS-PUBACC-002": "CWE-284",
  "AWS-PUBACC-003": "CWE-284",
  "AWS-PUBACC-004": "CWE-284",
  "AWS-PUBACC-005": "CWE-284",
  "AWS-LOGAUDIT-001": "CWE-778",
  "AWS-LOGAUDIT-002": "CWE-778",
  "AWS-LOGAUDIT-003": "CWE-778",
  "AWS-LOGAUDIT-004": "CWE-778",
  "AWS-LOGAUDIT-005": "CWE-778",
  "AWS-NETSEG-001": "CWE-284",
  "AWS-NETSEG-002": "CWE-284",
  "AWS-NETSEG-003": "CWE-284",
  "AWS-DATACLASS-001": "CWE-311",
  "AWS-DATACLASS-002": "CWE-311",
  "AWS-DATACLASS-003": "CWE-693",
  "AWS-BKPCOMP-001": "CWE-693",
  "AWS-BKPCOMP-002": "CWE-693",
  "AWS-BKPCOMP-003": "CWE-693",
  "AWS-BKPCOMP-004": "CWE-693",
  "AWS-IAMBP-001": "CWE-269",
  "AWS-IAMBP-002": "CWE-269",
  "AWS-IAMBP-003": "CWE-269",
  "AWS-IAMBP-004": "CWE-269",
  "AWS-VPCFL-001": "CWE-778",
  "AWS-S3PUB-001": "CWE-284",
  "AWS-S3PUB-002": "CWE-284",
  "AWS-S3PUB-003": "CWE-284",
  "AWS-S3PUB-004": "CWE-284",
  "AWS-RDSPUB-001": "CWE-284",
  "AWS-RDSPUB-002": "CWE-311",
  "AWS-RDSPUB-003": "CWE-693",
  "AWS-RDSPUB-004": "CWE-693",
  "AWS-RDSPUB-005": "CWE-778",
  "AWS-RDSPUB-006": "CWE-693",
  "AWS-SECROT-001": "CWE-320",
  "AWS-SECROT-002": "CWE-320",
  "AWS-QUOTA-001": "CWE-770",
  "AWS-ACCTSEC-001": "CWE-311",
  "AWS-ACCTSEC-002": "CWE-284",
  "AWS-ACCTSEC-003": "CWE-284",
  "AWS-ACCTSEC-004": "CWE-693",
  // identity
  "AWS-IDENT-001": "CWE-200",
  "AWS-RTRUST-001": "CWE-284",
  "AWS-RTRUST-002": "CWE-284",
  "AWS-RTRUST-003": "CWE-284",
  "AWS-XACCT-001": "CWE-284",
  "AWS-XACCT-002": "CWE-284",
  "AWS-SLR-001": "CWE-200",
  "AWS-ACCESSLAST-001": "CWE-269",
  "AWS-IDP-001": "CWE-287",
  "AWS-IDP-002": "CWE-324",
  "AWS-SSOPERM-001": "CWE-269",
  "AWS-SSOPERM-002": "CWE-269",
  "AWS-COGID-001": "CWE-284",
  "AWS-COGID-002": "CWE-284",
  "AWS-STSSESS-001": "CWE-613",
  "AWS-RESPOL-001": "CWE-284",
  "AWS-RESPOL-002": "CWE-284",
  "AWS-RESPOL-003": "CWE-284",
  "AWS-RESPOL-004": "CWE-284",
  "AWS-GRPMEM-001": "CWE-269",
  "AWS-GRPMEM-002": "CWE-269",
  "AWS-GRPMEM-003": "CWE-284",
  "AWS-PERMBND-001": "CWE-269",
  "AWS-PERMBND-002": "CWE-269",
  // impact
  "AWS-IMPACT-DEL-001": "CWE-284",
  "AWS-IMPACT-DEL-002": "CWE-693",
  "AWS-IMPACT-DISRUPT-001": "CWE-284",
  "AWS-IMPACT-DATADEST-001": "CWE-693",
  "AWS-IMPACT-DATADEST-002": "CWE-693",
  "AWS-IMPACT-DATADEST-003": "CWE-693",
  "AWS-IMPACT-LOCKOUT-001": "CWE-284",
  "AWS-IMPACT-CRYPTO-001": "CWE-770",
  "AWS-IMPACT-BILLING-001": "CWE-770",
  "AWS-IMPACT-DNS-001": "CWE-284",
  "AWS-IMPACT-DNS-002": "CWE-284",
  "AWS-IMPACT-NET-001": "CWE-284",
  "AWS-IMPACT-NET-002": "CWE-284",
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
  multi_region_scan: multiRegionScan,
  kms_enum: kmsEnum,
  opensearch_enum: opensearchEnum,
  efs_enum: efsEnum,
  elb_enum: elbEnum,
  dynamodb_enum: dynamodbEnum,
  cognito_enum: cognitoEnum,
  sts_enum: stsEnum,
  secrets_manager_enum: secretsManagerEnum,
  ssm_enum: ssmEnum,
  sagemaker_enum: sagemakerEnum,
  step_functions_enum: stepFunctionsEnum,
  glue_enum: glueEnum,
  codepipeline_enum: codepipelineEnum,
  eventbridge_enum: eventbridgeEnum,
  waf_enum: wafEnum,
  cloudtrail_enum: cloudtrailEnum,
  config_enum: configEnum,
  guardduty_enum: guarddutyEnum,
  security_hub_enum: securityHubEnum,
  inspector_enum: inspectorEnum,
  backup_enum: backupEnum,
  athena_enum: athenaEnum,
  emr_enum: emrEnum,
  msk_enum: mskEnum,
  ecr_enum: ecrEnum,
  app_runner_enum: appRunnerEnum,
  amplify_enum: amplifyEnum,
  acm_enum: acmEnum,
  transfer_family_enum: transferFamilyEnum,
  public_exposure_scan: publicExposureScan,
  stale_permission_audit_recon: stalePermissionAuditRecon,
  tag_compliance_audit: tagComplianceAudit,
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
  cloudtrail_selector_tamper: cloudtrailSelectorTamper,
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
  backup_vault_enum: backupVaultEnum,
  cloudwatch_logs_dump: cloudwatchLogsDump,
  sns_sqs_siphon: snsSqsSiphon,
  kinesis_tap: kinesisTap,
  // compliance
  cis_benchmark: cisBenchmark,
  access_key_rotation: accessKeyRotation,
  mfa_audit: mfaAudit,
  password_policy_check: passwordPolicyCheck,
  root_account_audit: rootAccountAudit,
  encryption_audit: encryptionAudit,
  public_access_audit: publicAccessAudit,
  logging_audit: loggingAudit,
  network_segmentation_audit: networkSegmentationAudit,
  data_classification_audit: dataClassificationAudit,
  backup_compliance_audit: backupComplianceAudit,
  iam_best_practices: iamBestPractices,
  vpc_flow_log_audit: vpcFlowLogAudit,
  s3_public_audit: s3PublicAudit,
  rds_public_audit: rdsPublicAudit,
  secret_rotation_audit: secretRotationAudit,
  service_quota_audit: serviceQuotaAudit,
  account_security_audit: accountSecurityAudit,
  // identity
  sts_session_enum: stsSessionEnum,
  cross_account_trust_enum: crossAccountTrustEnum,
  iam_deep_audit: iamDeepAudit,
  stale_permission_audit: stalePermissionAudit,
  sso_deep_enum: ssoDeepEnum,
  cognito_security_audit: cognitoSecurityAudit,
  service_linked_role_enum: serviceLinkedRoleEnum,
  organization_policy_enum: organizationPolicyEnum,
  password_spray_aws: passwordSprayAws,
  identity_summary: identitySummary,
  role_trust_audit: roleTrustAudit,
  cross_account_trust_audit: crossAccountTrustAudit,
  service_linked_roles: serviceLinkedRoles,
  iam_access_last_used: iamAccessLastUsed,
  identity_provider_enum: identityProviderEnum,
  sso_permission_audit: ssoPermissionAudit,
  cognito_identity_audit: cognitoIdentityAudit,
  sts_session_audit: stsSessionAudit,
  resource_policy_audit: resourcePolicyAudit,
  group_membership_audit: groupMembershipAudit,
  permission_boundary_audit: permissionBoundaryAudit,
  // impact
  resource_hijack: resourceHijack,
  data_destroy: dataDestroy,
  ransomware_sim: ransomwareSim,
  service_disruption: serviceDisruption,
  cryptominer_deploy: cryptominerDeploy,
  resource_deletion_capability: resourceDeletionCapability,
  service_disruption_analysis: serviceDisruptionAnalysis,
  data_destruction_paths: dataDestructionPaths,
  account_lockout_risk: accountLockoutRisk,
  crypto_mining_check: cryptoMiningCheck,
  billing_impact_analysis: billingImpactAnalysis,
  dns_hijack_capability: dnsHijackCapability,
  network_disruption_capability: networkDisruptionCapability,
}

export const AwshookTool = tool({
  description: `AWS offensive security toolkit — the PRIMARY tool for any AWS security assessment, pentest, or audit when AWS credentials are available. 172 programs across 10 kill-chain categories: recon (51), credential harvesting (11), privilege escalation (10), persistence (11), lateral movement (8), defense evasion (13), exfiltration & cleanup (16), compliance (18), identity (21), impact (13). Start with recon programs (iam_enum, ec2_enum, s3_enum, service_recon, public_exposure_scan) to discover assets and misconfigurations, then progress through the kill chain. For compliance posture: cis_benchmark, encryption_audit, logging_audit, network_segmentation_audit, account_security_audit, mfa_audit, root_account_audit. For identity deep-dive: identity_summary, role_trust_audit, cross_account_trust_audit, resource_policy_audit, permission_boundary_audit, iam_access_last_used. For impact assessment: resource_deletion_capability, data_destruction_paths, billing_impact_analysis, dns_hijack_capability. Prefer this over cloud_audit — awshook covers everything cloud_audit does PLUS finds exploitable paths. Uses aws CLI (no Python/SDK). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_aws before leaving a target.`,
  args: {
    program: z.enum(programKeys).describe(
      "AWS program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  },
  async execute(params, ctx): Promise<string> {
    if (!Bun.which("aws")) {
      ctx.metadata({ title: `awshook: ${params.program}`, metadata: { program: params.program, findings: [] as Finding[] } })
      return "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    }

    try {
      const handler = dispatch[params.program]
      const result = await handler(params.args, params.timeout_seconds)
      const enriched = result.findings.map((f) => ({
        ...f,
        cwe: CWE_MAP[f.checkId] || undefined,
      }))

      if (enriched.length > 0) {
        const sessionID = Session.root(ctx.sessionID)
        const ingested = ingestFindings(sessionID, enriched, ctx.agent ?? "awshook")
        if (ingested.assets > 0 || ingested.exposures > 0) {
          result.output += `\n\n[inventory] ${ingested.assets} assets, ${ingested.exposures} exposures recorded`
        }
      }

      ctx.metadata({ title: `awshook: ${params.program}`, metadata: { program: params.program, findings: enriched } })
      return result.output
    } catch (e) {
      ctx.metadata({ title: `awshook: ${params.program}`, metadata: { program: params.program, findings: [] } })
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
