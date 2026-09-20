import { CloudAsset, CloudExposure, type AssetKind, type ExposureType } from "cyberstrike/public"
import type { Finding } from "./shared"

interface ParsedArn {
  partition: string
  service: string
  region: string
  account: string
  resourceType: string
  resourceName: string
}

function parseArn(resource: string): ParsedArn | undefined {
  if (!resource.startsWith("arn:")) return undefined
  const parts = resource.split(":")
  if (parts.length < 6) return undefined
  const rest = parts.slice(5).join(":")
  const slashIdx = rest.indexOf("/")
  const resourceType = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest
  const resourceName = slashIdx >= 0 ? rest.slice(slashIdx + 1) : ""
  return {
    partition: parts[1]!,
    service: parts[2]!,
    region: parts[3]!,
    account: parts[4]!,
    resourceType,
    resourceName: resourceName || resourceType,
  }
}

const SERVICE_TO_KIND: Record<string, AssetKind> = {
  ec2: "ec2_instance",
  s3: "s3_bucket",
  lambda: "lambda_function",
  iam: "iam_role",
  rds: "rds_instance",
  ecs: "ecs_cluster",
  eks: "eks_cluster",
  dynamodb: "dynamodb_table",
  cloudformation: "cloudformation_stack",
  "execute-api": "api_gateway",
  apigateway: "api_gateway",
  cloudfront: "cloudfront_distribution",
  route53: "route53_zone",
  secretsmanager: "secrets_manager",
  ssm: "ssm_parameter",
  kms: "kms_key",
  es: "opensearch_domain",
  opensearch: "opensearch_domain",
  elasticache: "elasticache_cluster",
  redshift: "redshift_cluster",
  elasticfilesystem: "efs_filesystem",
  "elasticloadbalancing": "elb",
  sns: "sns_topic",
  sqs: "sqs_queue",
  ecr: "ecr_repository",
  "cognito-idp": "cognito_pool",
  "cognito-identity": "cognito_pool",
  sso: "sso_instance",
}

const RESOURCE_TYPE_TO_KIND: Record<string, AssetKind> = {
  user: "iam_user",
  role: "iam_role",
  policy: "iam_policy",
  group: "group",
  instance: "ec2_instance",
  "security-group": "security_group",
  volume: "ebs_volume",
  cluster: "ecs_cluster",
  service: "ecs_service",
  "db-instance": "rds_instance",
  "db-cluster": "rds_instance",
  table: "dynamodb_table",
  function: "lambda_function",
  key: "kms_key",
  secret: "secrets_manager",
  parameter: "ssm_parameter",
  topic: "sns_topic",
  queue: "sqs_queue",
  domain: "opensearch_domain",
  filesystem: "efs_filesystem",
  "replication-group": "elasticache_cluster",
  "cache-cluster": "elasticache_cluster",
  repository: "ecr_repository",
}

function assetKindFromArn(arn: ParsedArn): AssetKind {
  const byResource = RESOURCE_TYPE_TO_KIND[arn.resourceType]
  if (byResource) return byResource
  const byService = SERVICE_TO_KIND[arn.service]
  if (byService) return byService
  return "other"
}

function assetKindFromCheckId(checkId: string): AssetKind {
  if (checkId.startsWith("AWS-EC2-")) return "ec2_instance"
  if (checkId.startsWith("AWS-S3-")) return "s3_bucket"
  if (checkId.startsWith("AWS-LAMBDA-")) return "lambda_function"
  if (checkId.startsWith("AWS-ENUM-") || checkId.startsWith("AWS-PRIVESC-")) return "iam_role"
  if (checkId.startsWith("AWS-RDS-")) return "rds_instance"
  if (checkId.startsWith("AWS-ECS-")) return "ecs_cluster"
  if (checkId.startsWith("AWS-EKS-")) return "eks_cluster"
  if (checkId.startsWith("AWS-VPC-")) return "vpc"
  if (checkId.startsWith("AWS-R53-")) return "route53_zone"
  if (checkId.startsWith("AWS-COGNITO-")) return "cognito_pool"
  if (checkId.startsWith("AWS-CFN-") || checkId.startsWith("AWS-CFNSEC-")) return "cloudformation_stack"
  if (checkId.startsWith("AWS-APIGW-")) return "api_gateway"
  if (checkId.startsWith("AWS-SNS-")) return "sns_topic"
  if (checkId.startsWith("AWS-SQS-")) return "sqs_queue"
  if (checkId.startsWith("AWS-CW-")) return "other"
  if (checkId.startsWith("AWS-KMS-")) return "kms_key"
  if (checkId.startsWith("AWS-OS-")) return "opensearch_domain"
  if (checkId.startsWith("AWS-EFS-")) return "efs_filesystem"
  if (checkId.startsWith("AWS-ELB-")) return "elb"
  if (checkId.startsWith("AWS-ELASTICACHE-")) return "elasticache_cluster"
  if (checkId.startsWith("AWS-REDSHIFT-")) return "redshift_cluster"
  if (checkId.startsWith("AWS-CRED-")) return "iam_user"
  if (checkId.startsWith("AWS-CODECOMMIT-")) return "other"
  if (checkId.startsWith("AWS-CICD-")) return "other"
  return "other"
}

const CHECK_TO_EXPOSURE: Record<string, ExposureType> = {
  "AWS-ENUM-001": "excessive_permission",
  "AWS-ENUM-002": "wildcard_policy",
  "AWS-ENUM-003": "stale_credential",
  "AWS-EC2-001": "public_endpoint",
  "AWS-EC2-003": "public_endpoint",
  "AWS-EC2-004": "secret_in_env",
  "AWS-S3-001": "public_bucket",
  "AWS-S3-002": "public_bucket",
  "AWS-S3-003": "unencrypted_storage",
  "AWS-S3-004": "public_bucket",
  "AWS-S3-005": "public_bucket",
  "AWS-LAMBDA-001": "secret_in_env",
  "AWS-VPC-001": "unrestricted_network",
  "AWS-RDS-001": "public_endpoint",
  "AWS-RDS-002": "unencrypted_storage",
  "AWS-RDS-003": "public_snapshot",
  "AWS-ECS-002": "secret_in_env",
  "AWS-EKS-001": "public_endpoint",
  "AWS-CRED-001": "stale_credential",
  "AWS-CRED-002": "stale_credential",
  "AWS-CRED-003": "stale_credential",
  "AWS-COGNITO-001": "no_auth",
  "AWS-PRIVESC-001": "privilege_escalation_path",
  "AWS-PRIVESC-002": "privilege_escalation_path",
  "AWS-PRIVESC-003": "privilege_escalation_path",
  "AWS-PRIVESC-004": "privilege_escalation_path",
  "AWS-PRIVESC-005": "privilege_escalation_path",
  "AWS-PRIVESC-006": "privilege_escalation_path",
  "AWS-PRIVESC-007": "privilege_escalation_path",
  "AWS-PRIVESC-008": "privilege_escalation_path",
  "AWS-PRIVESC-009": "privilege_escalation_path",
  "AWS-PRIVESC-010": "excessive_permission",
  "AWS-CFN-001": "secret_in_template",
  "AWS-CFN-002": "secret_in_template",
  "AWS-CFN-003": "secret_in_template",
  "AWS-APIGW-001": "stale_credential",
  "AWS-APIGW-002": "no_auth",
  "AWS-EVASION-001": "logging_disabled",
  "AWS-EVASION-002": "logging_disabled",
  "AWS-EVASION-003": "logging_disabled",
  "AWS-EVASION-004": "logging_disabled",
  "AWS-EVASION-005": "logging_disabled",
  "AWS-KMS-001": "excessive_permission",
  "AWS-KMS-002": "cross_account_trust",
  "AWS-OS-001": "public_endpoint",
  "AWS-OS-002": "unencrypted_transport",
  "AWS-OS-003": "no_auth",
  "AWS-EFS-001": "unencrypted_storage",
  "AWS-EFS-002": "unrestricted_network",
  "AWS-ELB-001": "public_endpoint",
  "AWS-ELB-002": "weak_tls",
  "AWS-ELB-003": "http_enabled",
  "AWS-ELASTICACHE-001": "no_auth",
  "AWS-ELASTICACHE-002": "unencrypted_transport",
  "AWS-ELASTICACHE-003": "unencrypted_storage",
  "AWS-REDSHIFT-001": "public_endpoint",
  "AWS-REDSHIFT-002": "unencrypted_storage",
  "AWS-REDSHIFT-003": "logging_disabled",
  "AWS-PERSIST-007": "cross_account_trust",
}

function exposureTypeFromCheckId(checkId: string): ExposureType {
  return CHECK_TO_EXPOSURE[checkId] ?? "other"
}

export function ingestFindings(sessionID: string, findings: Finding[], agent: string): { assets: number; exposures: number } {
  let assetCount = 0
  let exposureCount = 0

  for (const f of findings) {
    if (f.status !== "FAIL") continue

    const arn = parseArn(f.resource)
    const kind = arn ? assetKindFromArn(arn) : assetKindFromCheckId(f.checkId)
    const name = arn ? arn.resourceName || f.resource : f.resource
    const region = arn?.region || undefined
    const account = arn?.account || undefined

    const asset = CloudAsset.add({
      sessionID,
      kind,
      name,
      resourceID: arn ? f.resource : undefined,
      subscription: account,
      region,
      properties: {
        provider: "aws",
        checkId: f.checkId,
        ...(arn ? { service: arn.service } : {}),
      },
      group: arn?.service ?? "aws",
      sourceAgent: agent,
    })
    if (!asset.duplicate) assetCount++

    const exposureType = exposureTypeFromCheckId(f.checkId)
    const exposure = CloudExposure.add({
      sessionID,
      assetID: asset.id,
      type: exposureType,
      severity: f.severity,
      detail: `[${f.checkId}] ${f.title}: ${f.details}`,
      verified: true,
      sourceAgent: agent,
    })
    if (!exposure.duplicate) exposureCount++
  }

  return { assets: assetCount, exposures: exposureCount }
}
