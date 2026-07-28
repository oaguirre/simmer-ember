#!/bin/bash
set -e

rm -rf dist
npm install --legacy-peer-deps --include=dev
npm run build
sudo pm2 restart 0
