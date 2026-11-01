#!/usr/bin/env bash
# Protect main and develop with two repository rulesets.
#
#   nuxt-openfga: history       No force pushes, no branch deletion.
#                               No bypass for anyone, including admins.
#   nuxt-openfga: review gate   Changes arrive by pull request with one
#                               approval, passing required checks and resolved
#                               conversations. Organization owners may bypass,
#                               so a solo maintainer can still merge and push.
#
# The bypass is granted to the organization-owner role, not to individual
# users. Granting someone org ownership grants them the bypass; ordinary
# members and outside collaborators never get it.
#
# Rulesets need a public repository or a paid plan.
# Usage: scripts/oss/setup-branch-protection.sh [owner/repo]
# Re-running updates the rulesets in place.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required: https://cli.github.com/"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
BRANCHES='["refs/heads/main", "refs/heads/develop"]'

for branch in main develop; do
  if ! gh api "repos/${REPO}/branches/${branch}" >/dev/null 2>&1; then
    echo "Branch '${branch}' does not exist in ${REPO}. Push it first."
    exit 1
  fi
done

upsert() {
  local name="$1" payload="$2" id
  id="$(gh api "repos/${REPO}/rulesets" --jq ".[] | select(.name == \"${name}\") | .id" 2>/dev/null || true)"
  if [[ -n "${id}" ]]; then
    gh api --method PUT "repos/${REPO}/rulesets/${id}" --input - <<<"${payload}" >/dev/null
    echo "Updated ruleset: ${name}"
  else
    gh api --method POST "repos/${REPO}/rulesets" --input - <<<"${payload}" >/dev/null
    echo "Created ruleset: ${name}"
  fi
}

upsert "nuxt-openfga: history" "$(cat <<JSON
{
  "name": "nuxt-openfga: history",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ${BRANCHES}, "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
)"

upsert "nuxt-openfga: review gate" "$(cat <<JSON
{
  "name": "nuxt-openfga: review gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ${BRANCHES}, "exclude": [] } },
  "bypass_actors": [
    { "actor_type": "OrganizationAdmin", "actor_id": 1, "bypass_mode": "always" }
  ],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "validate" },
          { "context": "parity" },
          { "context": "dependency-review" }
        ]
      }
    }
  ]
}
JSON
)"

echo "Rulesets configured for ${REPO} (main, develop)."
