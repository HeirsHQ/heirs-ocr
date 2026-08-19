#!/usr/bin/env bash
#
# Deploys the API to the EC2 host. Invoked over SSH by .github/workflows/dev-deploy.yml
# as `bash scripts/deploy.sh <git-sha>`, where <git-sha> is the commit whose image the
# workflow just pushed to ECR.
#
# Lived only on the host until now, which meant it could not be reviewed or rolled
# back and existed on exactly one machine. Keeping it here also means a change to the
# deploy lands the same way as a change to the code.
set -euo pipefail

# Overridable so the host can carry environment-specific values without a commit.
# Defaults reproduce what the box was already running.
APP_DIR="${APP_DIR:-/home/ubuntu/heirs-ocr}"
AWS_REGION="${AWS_REGION:-eu-west-1}"
ECR_REGISTRY="${ECR_REGISTRY:-231399651855.dkr.ecr.eu-west-1.amazonaws.com}"
ECR_REPOSITORY="${ECR_REPOSITORY:-heirs-ocr}"

IMAGE_TAG="${1:?usage: deploy.sh <image-tag>}"

cd "$APP_DIR"

# Fetch-and-reset rather than `git pull --ff-only`, for two reasons.
#
# 1. A pull merges, and a merge aborts rather than overwrite an untracked file that
#    the incoming commit also tracks. That is what broke the deploy when
#    docker-compose-prod.yml — hand-placed on this host during setup — was later
#    committed: every deploy failed until someone deleted the host's copy by hand.
#    A reset overwrites such a file instead, so bringing a host-side file under
#    version control stops being an outage.
#
# 2. A pull tracks the *branch*, which may have moved past the commit whose image was
#    built. Resetting to the tag deploys the code that matches the image, rather than
#    whatever landed on development in the meantime.
#
# Deliberately no `git clean`: .env (which both compose services load via env_file)
# is untracked and gitignored, and cleaning would delete it — along with this script,
# mid-run, on any host where it is not yet tracked.
git fetch --prune origin development
if ! git cat-file -e "${IMAGE_TAG}^{commit}" 2>/dev/null; then
  echo "deploy.sh: commit ${IMAGE_TAG} is not reachable after fetching origin/development" >&2
  exit 1
fi
git reset --hard "$IMAGE_TAG"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

export ECR_REGISTRY ECR_REPOSITORY IMAGE_TAG
docker compose -f docker-compose-prod.yml pull
docker compose -f docker-compose-prod.yml up -d --remove-orphans

# Dangling images only (no -a), so images still referenced by a running or previous
# container survive and a rollback does not have to re-pull.
docker image prune -f
