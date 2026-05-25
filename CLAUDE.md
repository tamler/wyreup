# wyreup.com — project guide for Claude

This file overrides the global `~/CLAUDE.md` where the two conflict. Read it.

## Release gate — what "push" actually means

The operator says "push to github" / "push it" / "ship it" to mean **"make this live for users."** That requires THREE things, not one:

1. Code lands on `origin/main` (`git push`)
2. Web app is live at wyreup.com (Cloudflare Pages auto-deploys on `main` push — happens within ~2 min)
3. **npm packages match `main`'s source** (`@wyreup/mcp`, `@wyreup/cli`, `@wyreup/core` published with the current code)

Step 3 is the one that's silently broken when you only check `git status`. The Changesets workflow gates npm publish behind a "version packages" PR. If that PR is unmerged, **main is ahead of npm** and users on `npm install @wyreup/<pkg>` still get old code.

### Verify on every "push" mention

Before reporting "we're done" / "pushed" / "shipped":

```bash
# 1. Source on main vs origin
git status -sb

# 2. Are there orphaned changesets? (i.e. work landed on main with a
#    .changeset/*.md file but the changesets release PR hasn't merged)
ls .changeset/ | grep -v '^README\|^config\.' | head

# 3. Is the changesets release PR open?
gh pr list --head changeset-release/main --json number,title,state

# 4. Does npm match source? — for each public package:
diff <(node -e "console.log(require('./packages/mcp/package.json').version)") \
     <(npm view @wyreup/mcp version)
# repeat for @wyreup/cli, @wyreup/core
```

If ANY of (1) shows unpushed commits, (2) has files, (3) shows an open PR, or (4) shows a version diff — **the operator's "push" is not done.** Surface the gap explicitly, don't claim success.

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
