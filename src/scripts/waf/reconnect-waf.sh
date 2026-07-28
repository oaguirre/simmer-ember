#!/bin/bash
set -e

# ==========================================
# 1. USER CONFIGURATION
# ==========================================
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="264378135432"
WAF_NAME="Emergency-WAF-v2"

echo "🔍 Fetching Amazon Resource Names (ARNs)..."

# 1. Resolve the ALB's complete ARN
ALB_ARN=$(aws elbv2 describe-load-balancers \
    --names "lb-api-simmer-prod" \
    --region "$AWS_REGION" \
    --query "LoadBalancers.LoadBalancerArn" \
    --output text)

if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" == "None" ]; then
    echo "❌ Error: Could not find an Application Load Balancer named 'lb-api-simmer-prod' in $AWS_REGION."
    exit 1
fi

# 2. Resolve the existing WAF Web ACL's complete ARN
WAF_ARN=$(aws wafv2 list-web-acls \
    --scope REGIONAL \
    --region "$AWS_REGION" \
    --query "WebACLs[?Name=='$WAF_NAME'].ARN" \
    --output text)

if [ -z "$WAF_ARN" ] || [ "$WAF_ARN" == "None" ]; then
    echo "❌ Error: Could not find an existing WAF Web ACL named '$WAF_NAME' in $AWS_REGION."
    echo "💡 Run 'deploy-waf.sh' first to create the WAF resource."
    exit 1
fi

echo "✅ Found ALB ARN: $ALB_ARN"
echo "✅ Found WAF ARN: $WAF_ARN"

# ==========================================
# 2. RECONNECT WAF TO ALB
# ==========================================
echo "⚡ Re-attaching Web ACL protection to the Application Load Balancer..."

aws wafv2 associate-web-acl \
    --web-acl-arn "$WAF_ARN" \
    --resource-arn "$ALB_ARN" \
    --region "$AWS_REGION"

echo "🚀 SUCCESS: 'lb-api-simmer-prod' is securely reconnected to AWS WAF!"
