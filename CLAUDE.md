# PzP Finance

Next.js + Prisma app for finance/ops: transactions, donors, services, credentials vault, and VPS stats.

> **Working method & token-limit protocol: see `superclaude.md`.** Follow it every session, starting with its Resume Protocol (read `todo.md` → tail of `.claude/worklog.md` → `git log`). Do not re-explore the codebase from scratch.

## Git
- **NEVER add a Claude / AI co-author trailer or "Generated with" line to commits or PRs.** No `Co-Authored-By: Claude`, ever.
- Commits and pushes are authored under the user's name only.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
