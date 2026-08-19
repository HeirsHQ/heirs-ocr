#!/usr/bin/env bash
set -euo pipefail

# --- edit these three for your environment ---
APP_DIR="/home/ubuntu/heirs-ocr"
AWS_REGION="eu-west-1"
ECR_REGISTRY="231399651855.dkr.ecr.eu-west-1.amazonaws.com"
# ----------------------------------------------

ECR_REPOSITORY="heirs-ocr"
IMAGE_TAG="${1:?usage: deploy.sh <image-tag>}"

cd "$APP_DIR"
git pull --ff-only origin development

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

export ECR_REGISTRY ECR_REPOSITORY IMAGE_TAG
docker compose -f docker-compose-prod.yml pull
docker compose -f docker-compose-prod.yml up -d --remove-orphans
docker image prune -f
