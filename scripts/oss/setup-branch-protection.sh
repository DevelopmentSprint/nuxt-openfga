#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

REPO="${1:-}"
if [[ -z "${REPO}" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

BRANCH="${2:-}"
if [[ -z "${BRANCH}" ]]; then
  BRANCH="$(gh api "repos/${REPO}" --jq '.default_branch')"
fi

if [[ -z "${BRANCH}" || "${BRANCH}" == "null" ]]; then
  echo "Unable to determine target branch for protection."
  echo "Pass it explicitly: scripts/oss/setup-branch-protection.sh <owner/repo> <branch>"
  exit 1
fi

BRANCH_REF="${BRANCH//\//%2F}"

if ! gh api "repos/${REPO}/branches/${BRANCH_REF}" >/dev/null 2>&1; then
  echo "Remote branch '${BRANCH}' does not exist in ${REPO}."
  echo "Push the branch first, then rerun this script."
  echo "Example: git push origin ${BRANCH}"
  exit 1
fi

PAYLOAD="$(cat <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "validate",
      "parity",
      "dependency-review"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON
)"

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH_REF}/protection" \
  --input - <<<"${PAYLOAD}" >/dev/null

echo "Branch protection configured for ${REPO}:${BRANCH}"
