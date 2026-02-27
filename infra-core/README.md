# iac-core

Core infrastructure for our AWS account using AWS CDK in Go.

This repo owns shared platform resources (VPC, ECS cluster, ALB, certificates, GitHub Actions OIDC) that service repos consume via SSM Parameter Store.

## Prereqs

- Go 1.22+
- AWS CDK CLI (npm i -g aws-cdk)
- AWS credentials configured (AWS_PROFILE or env vars)

## Folder structure

- cmd/iac-core/ CDK app entrypoint
- internal/stacks/ Core stacks (network, platform, edge, oidc)
- internal/outputs/ SSM parameter name contract
- test/ Synth tests

## Stacks

- **incochat-{stage}-network**: VPC, subnets, VPC endpoints, publishes VPC and subnet IDs to SSM
- **incochat-{stage}-platform**: ECS cluster, publishes cluster info to SSM
- **incochat-{stage}-edge**: ALB, HTTP→HTTPS redirect, HTTPS listener with ACM cert, publishes ALB/listener info to SSM
- **incochat-{stage}-oidc**: GitHub Actions OIDC provider and IAM role for CI/CD deployments

## First Time Setup

### 1. Prerequisites

```bash
# Install AWS CDK CLI
npm install -g aws-cdk

# Verify Go is installed (1.22+)
go version
```

### 2. Configure Environment

```bash
export AWS_PROFILE=your-profile
export AWS_REGION=us-east-1
export STAGE=dev
```

### 3. Bootstrap CDK (once per account/region)

```bash
make bootstrap
```

### 4. Deploy Core Infrastructure

Deploy stacks in order:

```bash
# 1. Network layer
make deploy-network

# 2. Platform layer (ECS cluster)
make deploy-platform

# 3. Edge layer (ALB + certificate) - will pause for DNS validation
make deploy-edge

# 4. OIDC for GitHub Actions
make deploy-oidc
```

### 5. ACM Certificate DNS Validation (Cloudflare)

The edge stack deployment will pause waiting for DNS validation:

1. Open AWS Console → Certificate Manager (ACM)
2. Find the pending certificate for `api-{stage}.incochat.io`
3. Copy the CNAME record name and value from the validation section
4. In Cloudflare DNS:
   - Add a new CNAME record with that name and value
   - Set proxy status to "DNS only" (gray cloud, not orange)
5. Wait 1-5 minutes for validation to complete
6. The CDK deployment will automatically continue once validated

If deployment times out, just re-run:

```bash
make deploy-edge
```

### 6. Configure GitHub Actions

After deploying the OIDC stack:

1. Get the role ARN from SSM Parameter Store:

   ```bash
   aws ssm get-parameter --name /core/dev/oidc/github/role/arn --query Parameter.Value --output text
   ```

2. Add as a GitHub repository secret named `AWS_ROLE_ARN`

3. Use in workflows:

   ```yaml
   permissions:
     id-token: write
     contents: read

   steps:
     - uses: aws-actions/configure-aws-credentials@v4
       with:
         role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
         aws-region: us-east-1
   ```

## Daily Usage

```bash
# Check what will change
make diff

# Deploy all stacks
make deploy

# Deploy individual stacks
make deploy-network
make deploy-platform
make deploy-edge
make deploy-oidc
```

## SSM Parameters Published

Service repos can discover core infrastructure via these SSM parameters:

**Network:**

- `/core/{stage}/vpc/id` - VPC ID
- `/core/{stage}/vpc/subnets/private` - Private subnet IDs (comma-separated)
- `/core/{stage}/vpc/subnets/public` - Public subnet IDs (comma-separated)
- `/core/{stage}/vpc/subnets/isolated` - Isolated subnet IDs (comma-separated)

**Platform:**

- `/core/{stage}/ecs/cluster/arn` - ECS cluster ARN
- `/core/{stage}/ecs/cluster/name` - ECS cluster name

**Edge:**

- `/core/{stage}/alb/arn` - Application Load Balancer ARN
- `/core/{stage}/alb/listener/https/arn` - HTTPS listener ARN (for attaching target groups)
- `/core/{stage}/alb/cert/arn` - ACM certificate ARN

**OIDC:**

- `/core/{stage}/oidc/github/role/arn` - GitHub Actions IAM role ARN

## Domain Configuration

- **dev/staging**: `api-{stage}.incochat.io`
- **prod**: `api.incochat.io` + `api-prod.incochat.io` (alt name)

Services use path-based routing (e.g., `/api/service-name/*`) with Envoy for internal routing.
