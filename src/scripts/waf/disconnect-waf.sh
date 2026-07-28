#!/bin/bash
AWS_REGION="us-east-1"

echo "🔌 Disconnecting WAF from ALB: lb-api-simmer-prod..."

ALB_ARN=$(aws elbv2 describe-load-balancers \
    --names "lb-api-simmer-prod" \
    --region "$AWS_REGION" \
    --query "LoadBalancers.LoadBalancerArn" \
    --output text)

aws wafv2 disassociate-web-acl \
    --resource-arn "$ALB_ARN" \
    --region "$AWS_REGION"

echo "✅ WAF successfully disconnected from 'lb-api-simmer-prod'."
