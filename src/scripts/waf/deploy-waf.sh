#!/bin/bash
set -e

# ==========================================
# 1. USER CONFIGURATION
# ==========================================
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="264378135432"
WAF_NAME="Emergency-WAF-v2"
ADMIN_IP_SET_NAME="Admin-Allowlist-IPs"

echo "🔍 Fetching Resource ARNs for ALB and Admin IP Set..."

# Resolve ALB ARN
ALB_ARN=$(aws elbv2 describe-load-balancers \
    --names "lb-api-simmer-prod" \
    --region "$AWS_REGION" \
    --query "LoadBalancers.LoadBalancerArn" \
    --output text)

if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" == "None" ]; then
    echo "❌ Error: Could not find Application Load Balancer 'lb-api-simmer-prod'."
    exit 1
fi

# Resolve Admin IP Set ARN
IP_SET_ARN=$(aws wafv2 list-ip-sets \
    --scope REGIONAL \
    --region "$AWS_REGION" \
    --query "IPSets[?Name=='$ADMIN_IP_SET_NAME'].ARN" \
    --output text)

if [ -z "$IP_SET_ARN" ] || [ "$IP_SET_ARN" == "None" ]; then
    echo "❌ Error: Could not find IP Set '$ADMIN_IP_SET_NAME'. Create it before running this script."
    exit 1
fi

echo "✅ Found ALB ARN: $ALB_ARN"
echo "✅ Found IP Set ARN: $IP_SET_ARN"

# ==========================================
# 2. DEFINE SECURITY RULES (JSON FORMAT)
# ==========================================
RULES_JSON='[
  {
    "Name": "AdminAllowlistRule",
    "Priority": 0,
    "Statement": {
      "IPSetReferenceStatement": {
        "ARN": "'"$IP_SET_ARN"'"
      }
    },
    "Action": {
      "Allow": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AdminAllowlistRuleMetric"
    }
  },
  {
    "Name": "GeoBlockRule",
    "Priority": 1,
    "Statement": {
      "NotStatement": {
        "Statement": {
          "GeoMatchStatement": {
            "CountryCodes": [
              "US",
              "CA",
              "MX"
            ],
            "ForwardedIPConfig": {
              "HeaderName": "X-Forwarded-For",
              "FallbackBehavior": "MATCH"
            }
          }
        }
      }
    },
    "Action": {
      "Block": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "GeoBlockRuleMetric"
    }
  },
  {
    "Name": "AWS-AWSManagedRulesCommonRuleSet",
    "Priority": 2,
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesCommonRuleSet"
      }
    },
    "OverrideAction": {
      "None": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesCommonRuleSetMetric"
    }
  },
  {
    "Name": "RateLimitRule",
    "Priority": 3,
    "Statement": {
      "RateBasedStatement": {
        "Limit": 2000,
        "AggregateKeyType": "FORWARDED_IP",
        "ForwardedIPConfig": {
          "HeaderName": "X-Forwarded-For",
          "FallbackBehavior": "MATCH"
        }
      }
    },
    "Action": {
      "Block": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "RateLimitRuleMetric"
    }
  }
]'

# ==========================================
# 3. DEFINE CUSTOM BODY RESPONSE (JSON)
# ==========================================
CUSTOM_RESPONSE_JSON='{
  "CustomResponseKey": {
    "ResponseCode": 403,
    "ResponseHeaders": [
      {
        "Name": "Content-Type",
        "Value": "application/json"
      }
    ],
    "CustomResponseBodyKey": "JsonErrorBody"
  }
}'

CUSTOM_BODY_JSON='{
  "JsonErrorBody": {
    "ContentType": "APPLICATION_JSON",
    "Content": "{\"error\": \"Access Denied\", \"reason\": \"Security Policy\"}"
  }
}'

# ==========================================
# 4. CREATE PROTECTED AWS WAF WEB ACL
# ==========================================
echo "🛠️ Creating AWS WAF Web ACL with Custom Responses & Admin Rules..."

WAF_ARN=$(aws wafv2 create-web-acl \
    --name "$WAF_NAME" \
    --scope REGIONAL \
    --region "$AWS_REGION" \
    --default-action Allow={} \
    --rules "$RULES_JSON" \
    --custom-response-bodies "$CUSTOM_BODY_JSON" \
    --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=${WAF_NAME}Metrics \
    --query "Summary.ARN" \
    --output text)

echo "✅ Web ACL Created Successfully!"
echo "📌 WAF ARN: $WAF_ARN"

# ==========================================
# 5. LINK WAF TO ALB
# ==========================================
echo "⚡ Instantly attaching Web ACL protection to the Application Load Balancer..."

aws wafv2 associate-web-acl \
    --web-acl-arn "$WAF_ARN" \
    --resource-arn "$ALB_ARN" \
    --region "$AWS_REGION"

echo "🚀 SUCCESS: Your ALB is now protected and configured with structural error formats!"
