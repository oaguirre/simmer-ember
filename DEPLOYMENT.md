# Deployment Guide

This document describes the automated deployment process for the Simmer API using GitHub Actions and AWS EC2.

## Overview

The deployment workflow is split into two GitHub Actions:

1. **CI Workflow** (`ci.yml`) - Runs tests on pull requests and non-main branches
2. **Deploy Main Workflow** (`deploy-main.yml`) - Runs tests, then deploys to production EC2 instances on pushes to `main` branch

## Architecture

```
GitHub Actions
    ↓
  Tests pass
    ↓
AWS EC2 Discovery (SIMMER_ROLE=API tag)
    ↓
SSH to each instance
    ↓
Pull latest main branch
    ↓
Run build-mv.sh (rebuild + PM2 restart)
```

## Prerequisites

### EC2 Setup

1. **EC2 Instances** - Must be running and accessible via SSH
2. **Instance Tagging** - Tag each API instance with:
   - Key: `SIMMER_ROLE`
   - Value: `API`
3. **SSH Access** - Instances must allow SSH connections from GitHub-hosted runners on port 22 (or custom `DEPLOY_PORT`)
4. **User Account** - An `ubuntu` user that can execute deployment scripts
5. **Repository** - The simmer repository cloned at the deployment path (default: `/home/ubuntu/simmer`)
6. **Dependencies** - Node.js, npm, PM2, git installed on the instance

### AWS IAM Permissions

The AWS user/role used by GitHub Actions needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

## GitHub Configuration

### 1. Repository Secrets

Add the following secrets in GitHub (Settings → Secrets and variables → Actions → Secrets):

| Secret Name | Description | Example |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | AWS IAM access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key | `wJalrXUtn...` |
| `DEPLOY_USER` | SSH username on EC2 instances | `ubuntu` |
| `DEPLOY_SSH_KEY` | Private SSH key (.pem file content) | `-----BEGIN PRIVATE KEY-----...` |
| `DEPLOY_PORT` | (Optional) SSH port, defaults to 22 | `22` |

### 2. Repository Variables

Add the following variables in GitHub (Settings → Secrets and variables → Actions → Variables):

| Variable Name | Description | Default |
|---|---|---|
| `AWS_REGION` | AWS region where EC2 instances are located | `us-east-1` |
| `DEPLOY_PATH` | Path to simmer repository on EC2 instances | `/home/ubuntu/simmer` |
| `DEPLOY_HOST_FIELD` | EC2 instance field to use for SSH connection | `PublicIpAddress` |

**Note on `DEPLOY_HOST_FIELD`:**
- Use `PublicIpAddress` if instances have public IP addresses and are reachable from the internet
- Use `PrivateIpAddress` if instances are in a private VPC (requires self-hosted runner inside VPC)

## Deployment Workflows

### Automatic Deployment (Push to Main)

```bash
# Make your changes locally
git add .
git commit -m "feat: new feature"
git push origin main
```

The workflow will:
1. Check out the code
2. Run `npm install` with pnpm
3. Run `npm test` to validate changes
4. If tests pass:
   - Query AWS for all running EC2 instances tagged `SIMMER_ROLE=API`
   - Verify SSH reachability to each instance
   - Deploy to each instance by:
     - Fetching latest `main` branch
     - Checking out main
     - Running `./build-mv.sh` (rebuilds dist and restarts PM2)

### Manual Deployment (Workflow Dispatch)

To manually trigger deployment without pushing:

1. Go to GitHub repository
2. Click **Actions** tab
3. Select **Deploy Main** workflow
4. Click **Run workflow** dropdown
5. Select branch (default: `main`)
6. Click **Run workflow**

### CI-Only (Non-Main Branches)

```bash
git checkout -b feature/my-change
# Make changes
git push origin feature/my-change
```

The CI workflow will:
1. Check out the code
2. Run `npm install` with pnpm
3. Run `npm test`
4. Report results (no deployment)

## Monitoring & Troubleshooting

### View Workflow Logs

1. Go to GitHub repository
2. Click **Actions** tab
3. Select the workflow run
4. View logs for each job and step

### Common Issues

#### "No running EC2 instances found"
- **Cause**: No instances tagged with `SIMMER_ROLE=API` are running
- **Solution**: 
  - Verify instances are running in AWS Console
  - Verify instances have correct tags
  - Verify AWS credentials have `ec2:DescribeInstances` permission

#### "Verify public SSH reachability - nc: command not found"
- **Cause**: GitHub runner doesn't have `nc` (netcat) installed
- **Solution**: The workflow uses `nc` to check connectivity; this is a pre-flight check to fail fast

#### "Unable to locate executable file: pnpm"
- **Cause**: pnpm setup action hasn't completed
- **Solution**: Ensure `Setup pnpm` step runs before `Setup Node.js`

#### "ssh: connect to host [IP] port 22: Connection timed out"
- **Cause**: EC2 instances not publicly reachable or security group blocks SSH
- **Solution**:
  - Check EC2 security groups allow inbound SSH (port 22)
  - Confirm instances have public IP addresses
  - For private instances, use a self-hosted runner inside the VPC

#### "npm ERR! 404 Not Found - GET ... [SASS issue]"
- **Cause**: Network or package registry issue
- **Solution**: Re-run the workflow; transient network issues are common

### SSH Key Format

The `DEPLOY_SSH_KEY` secret must contain the raw `.pem` file content:

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7...
...
-----END PRIVATE KEY-----
```

**Do not** include extra quotes or escaping — paste the entire file content as-is.

### Local Testing of Deployment

To test the deployment script locally:

```bash
cd /home/ubuntu/simmer
git fetch origin main
git checkout main
git pull --ff-only origin main
./build-mv.sh
```

## Build Script Details

The `build-mv.sh` script:

```bash
#!/bin/bash
rm -rf dist
npm run build
sudo pm2 restart 0
```

1. Removes old build artifacts
2. Runs `npm run build` (swc compilation)
3. Restarts all PM2 processes

If `build-mv.sh` requires `sudo` privileges, ensure the `ubuntu` user has passwordless sudo access for `pm2`:

```bash
# On the EC2 instance, add to sudoers
echo "ubuntu ALL=(ALL) NOPASSWD: /usr/local/bin/pm2, /usr/bin/pm2" | sudo tee /etc/sudoers.d/pm2
```

## Rollback

To rollback to a previous version:

1. Revert the commit locally:
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. Or manually checkout a previous commit on EC2:
   ```bash
   cd /home/ubuntu/simmer
   git checkout <commit-hash>
   ./build-mv.sh
   ```

## Environment Variables

EC2 instances must have `.env` and `.production.env` files configured. The app loads them with:

```bash
node --env-file=.env --env-file=.production.env dist/index.js
```

Configure PM2 to pass these files to the process (already configured in `pm2.config.js`).

## Performance & Costs

- GitHub Actions: ~2-3 minutes per deployment
- AWS EC2 Discovery: ~5-10 seconds
- SSH connectivity check: ~5 seconds per instance
- Remote build & restart: ~2-5 minutes per instance
- Total: ~5-10 minutes for single instance, longer for multiple instances (sequential)

## Security Best Practices

1. **Rotate SSH Keys Regularly** - Update `DEPLOY_SSH_KEY` secret periodically
2. **Limit SSH Access** - Restrict security groups to known GitHub IP ranges if possible
3. **Use IAM Roles** - Consider using IAM roles for EC2 instances instead of static AWS credentials
4. **Audit Logs** - Review GitHub Actions logs and AWS CloudTrail for deployment activity
5. **Branch Protection** - Require reviews before merging to `main` to add an approval gate

## Support & Documentation

- GitHub Actions: https://docs.github.com/en/actions
- AWS EC2: https://docs.aws.amazon.com/ec2/
- PM2: https://pm2.keymetrics.io/
