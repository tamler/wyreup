# wyreup.com — project guide for Claude

This file overrides the global `~/CLAUDE.md` where the two conflict. Read it.

## Release gate — what "push" actually means

The operator says "push to github" / "push it" / "ship it" to mean **"make this live for users."** That requires FOUR things, not one:

1. Code lands on `origin/main` (`git push`)
2. **Cloudflare Pages deploy succeeded** on the latest commit (auto-runs on `main` push; takes ~2 min)
3. **For any file under `packages/web/`**: the live URL at wyreup.com actually serves the new content (a green Deploy workflow is necessary but not sufficient — the edge cache may be stale, or the deploy may have been a no-op because the source file isn't in the build output)
4. **npm packages match `main`'s source** (`@wyreup/mcp`, `@wyreup/cli`, `@wyreup/core` published with the current code)

Step 2 is the one that bit us on 2026-05-25 — the build-tooling dep bump moved TypeScript to 6.0.3, breaking tsup's DTS step in `@wyreup/core`, and every subsequent Cloudflare Pages deploy failed silently. Three legal-update commits in a row landed on `main` but never reached `wyreup.com`. Always check the Deploy workflow's conclusion, not just `git push` output.

Step 3 is its own trap. The Deploy workflow can succeed but produce a build artifact that doesn't include your change — wrong path, wrong glob, cached layer. The only proof is fetching the live URL.

Step 4 is the npm gap: the Changesets workflow gates npm publish behind a "version packages" PR. If that PR is unmerged, **main is ahead of npm** and users on `npm install @wyreup/<pkg>` still get old code.

### Verify on every "push" mention

Before reporting "we're done" / "pushed" / "shipped":

```bash
# 1. Source on main vs origin
git status -sb

# 2. Cloudflare Pages deploy on the latest commit succeeded
SHA=$(git rev-parse --short origin/main)
gh run list --branch main --commit "$SHA" --workflow 'Deploy to Cloudflare Pages' \
  --json status,conclusion --jq '.[0]'
# Expect: {"status":"completed","conclusion":"success"}.
# If "failure" / "in_progress" / empty — main is ahead of the live site.

# 3. For changes touching packages/web/, verify the live URL actually
#    serves the new content. Pick a signature string from the diff and
#    grep it from the deployed page:
git diff origin/main~ origin/main -- packages/web/ | grep '^+'  # find a new line
curl -s https://wyreup.com/<path> | grep '<signature string>'
# A 200 response alone is not proof — only matching content is.

# 4. Are there orphaned changesets? (i.e. work landed on main with a
#    .changeset/*.md file but the changesets release PR hasn't merged)
ls .changeset/ | grep -v '^README\|^config\.' | head

# 5. Is the changesets release PR open?
gh pr list --head changeset-release/main --json number,title,state

# 6. Does npm match source? — for each public package:
diff <(node -e "console.log(require('./packages/mcp/package.json').version)") \
     <(npm view @wyreup/mcp version)
# repeat for @wyreup/cli, @wyreup/core
```

If ANY of (1) shows unpushed commits, (2) isn't green-success, (3) doesn't serve the new content, (4) has files, (5) shows an open PR, or (6) shows a version diff — **the operator's "push" is not done.** Surface the gap explicitly, don't claim success.

### When a dep bump breaks the deploy

If CI / Deploy / Release start failing across commits unrelated to whatever was just pushed, the cause is almost always an earlier dependency upgrade landing on `main` without verification. Common pattern: Dependabot auto-merge + an integration that silently regressed. Triage in this order:

1. `gh run list --branch main --limit 10` — find the first failing commit on main.
2. Read the failed job logs (`gh run view <id> --log-failed`) for the exact error.
3. Check whether the previous Green commit and the first Red commit differ in a `package.json` / `pnpm-lock.yaml`. If yes, the dep bump is the suspect.
4. Either revert the offending PR, pin the regressing dependency back, or fix the integration. Don't ship more commits on top of a broken `main` without fixing the underlying breakage first — those commits won't deploy either.

### Auto-merge backstop

`.github/workflows/release.yml` enables auto-merge on the Changesets release PR via `gh pr merge --auto --squash`. When code lands on `main` with a changeset, the version PR auto-creates, CI runs, and the PR merges itself, triggering publish. The verification above is the safety net for cases where auto-merge is disabled or paused.

### When committing code that should ship

If a commit makes a change that users should be able to consume from npm (new API, bug fix, hardening), it needs a `.changeset/<name>.md` file describing the bump kind (`major` / `minor` / `patch`). No changeset = no version bump = no publish, even after merge.

```bash
# Create one interactively
pnpm changeset

# Or write it directly: .changeset/your-change.md
# ---
# '@wyreup/core': minor
# '@wyreup/cli': minor
# '@wyreup/mcp': minor
# ---
# Description that becomes the CHANGELOG entry.
```

Do NOT manually edit `package.json` `version` fields. Changesets owns those. Manual bumps desync Changesets' state machine and the bot will end up proposing the wrong next version.

## Other project-specific rules

(Add other wyreup-specific conventions here as they come up. The global `~/CLAUDE.md` covers the rest.)
