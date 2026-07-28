#!/bin/bash
set -e
aws wafv2 create-ip-set \
    --name "Admin-Allowlist-IPs" \
    --scope REGIONAL \
    --region "us-east-1" \
    --ip-address-version IPV4 \
    --addresses "203.0.113.50/32" "198.51.100.0/24"
