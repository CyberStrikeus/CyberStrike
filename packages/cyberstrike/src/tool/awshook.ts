import z from "zod"
import { Tool } from "./tool"
import path from "path"

const AWSHOOK_DIR = path.resolve(import.meta.dir, "../../data/awshook")

const AVAILABLE_PROGRAMS: Record<string, { description: string; args: string }> = {
  iam_enum: {
    description:
      "Enumerate IAM users, roles, policies, and analyze for privilege escalation paths (PassRole, wildcard policies, inline policy abuse)",
    args: "[--profile PROFILE] [--region REGION] [--json-output]",
  },
  iam_privesc: {
    description:
      "Exploit IAM misconfigurations for privilege escalation: PassRole+Lambda, AssumeRole chaining, AttachUserPolicy, CreateLoginProfile, CreateAccessKey",
    args: "--method <passrole|assumerole|lambda|attach_policy|create_login|create_key> [--role-arn ARN] [--profile PROFILE] [--json-output]",
  },
  s3_dump: {
    description:
      "List all S3 buckets, identify sensitive files (.env, backups, credentials, .pem, .key), and optionally download high-value targets",
    args: "[--bucket BUCKET] [--download] [--pattern REGEX] [--profile PROFILE] [--json-output]",
  },
  lambda_backdoor: {
    description:
      "Inject reverse shell layer into existing Lambda function or create new backdoor function with high-privilege role",
    args: "--function-name NAME --callback-url URL [--method inject|create] [--profile PROFILE] [--json-output]",
  },
  ssm_exec: {
    description:
      "Execute commands on EC2 instances via AWS Systems Manager RunCommand — no SSH or direct network access required",
    args: "--instance-id ID --command CMD [--all-instances] [--profile PROFILE] [--json-output]",
  },
  metadata_harvest: {
    description:
      "Extract IAM role credentials from EC2/ECS/Lambda metadata endpoints (169.254.169.254). Supports IMDSv1 and IMDSv2",
    args: "[--imds-version v1|v2] [--json-output]",
  },
  cloudtrail_blind: {
    description:
      "Stop CloudTrail logging, manipulate event selectors to exclude management events, or delete existing log files from S3",
    args: "--action <stop|delete_logs|modify_selectors|status> [--trail-name NAME] [--profile PROFILE] [--json-output]",
  },
  secrets_dump: {
    description:
      "Extract all secrets from AWS Secrets Manager and SSM Parameter Store (SecureString parameters with decryption)",
    args: "[--service secretsmanager|ssm|all] [--profile PROFILE] [--region REGION] [--json-output]",
  },
  ec2_snapshot: {
    description:
      "Create EBS volume snapshots for data exfiltration, optionally share cross-account for offline analysis",
    args: "--volume-id VOL_ID [--share-account ACCOUNT_ID] [--profile PROFILE] [--json-output]",
  },
  cleanup_aws: {
    description:
      "Remove all CyberStrike-created AWS resources, restore CloudTrail logging, clean state files. ALWAYS run before leaving",
    args: "[--dry-run] [--profile PROFILE] [--json-output]",
  },
}

export const AwshookTool = Tool.define("awshook", {
  description: `Execute an AWS post-exploitation program after compromising IAM credentials or EC2 instance. Requires valid AWS credentials (environment variables, profile, or metadata). Available programs: ${Object.keys(AVAILABLE_PROGRAMS).join(", ")}. ALWAYS run cleanup_aws before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(AVAILABLE_PROGRAMS) as [string, ...string[]]).describe(
      "AWS program to execute. Options: " +
        Object.entries(AVAILABLE_PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const scriptPath = path.join(AWSHOOK_DIR, `${params.program}.py`)
    const file = Bun.file(scriptPath)
    if (!(await file.exists())) {
      return {
        title: `awshook: ${params.program}`,
        output: `AWS program not found: ${params.program}.py\n\nAvailable programs:\n${Object.entries(
          AVAILABLE_PROGRAMS,
        )
          .map(([k, v]) => `  ${k}: ${v.description}\n    Usage: ${v.args}`)
          .join("\n")}`,
        metadata: { program: params.program, exitCode: -1, hasStderr: false },
      }
    }

    const proc = Bun.spawn(["python3", scriptPath, ...params.args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    })

    const timeout = setTimeout(() => {
      proc.kill()
    }, params.timeout_seconds * 1000)

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

    clearTimeout(timeout)
    const exitCode = await proc.exited

    const output = [stdout]
    if (stderr.trim()) output.push(`\n--- stderr ---\n${stderr}`)
    if (exitCode !== 0) {
      output.push(`\nExit code: ${exitCode}`)
      if (stderr.includes("ModuleNotFoundError") && stderr.includes("boto3")) {
        output.push("\n⚠ boto3 is required. Install with: pip3 install boto3")
      }
      if (stderr.includes("NoCredentialsError") || stderr.includes("Unable to locate credentials")) {
        output.push(
          "\n⚠ AWS credentials not found. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY environment variables or use --profile",
        )
      }
    }

    return {
      title: `awshook: ${params.program}`,
      output: output.join(""),
      metadata: {
        program: params.program,
        exitCode,
        hasStderr: stderr.trim().length > 0,
      },
    }
  },
})
