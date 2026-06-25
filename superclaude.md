# superclaude.md — Working Protocol (token-limit-proof)

**This document governs how work proceeds on this project. Follow it every session, starting with the Resume Protocol below.** It exists because the working budget is **~500M input tokens/minute**, and long agent sessions threaten it two ways:

1. **Input balloon** — every turn re-sends the entire conversation (history + tool outputs). Large file reads and verbose outputs pile up and push per-turn input toward the rate cap.
2. **Context loss** — when the context window fills, the harness summarizes and *detail is dropped*. Anything not on disk is gone.

The fix: **disk is the source of truth; the main conversation thread stays lean; heavy reading is delegated.**

---

## 0. Resume Protocol — the FIRST thing every session (and after any summarization)

Run these three reads, in order, before doing anything else:

1. `todo.md` — what's done / doing / next.
2. The **tail** of `.claude/worklog.md` — the last few entries (decisions + the single next action).
3. `git log --oneline -15` — the durable ledger of completed work.

That reconstructs full state in a few thousand tokens **without re-exploring the codebase**. Only after that, read the *specific* file the next action needs. Never re-explore from scratch.

---

## 1. The three durable files (single source of truth)

| File | Role | Update cadence |
|---|---|---|
| `plan.md` (repo root) | The what & why — trimmed copy of the approved plan. | Rarely; only when scope changes. |
| `todo.md` (repo root) | Live checklist. Each item: `🔲 todo` / `🚧 doing` / `✅ done`. | **After every step.** |
| `.claude/worklog.md` | Append-only journal. | **After every meaningful step.** |

`worklog.md` entry format (append, never rewrite):
```
## <step name>
- Files: <paths touched>
- Decisions: <anything non-obvious chosen>
- Next: <the single next concrete action>
```

---

## 2. Operating rules

- **Delegate-to-subagent rule.** Any task that needs reading more than ~150 lines total, or any codebase search, goes to a sub-agent (Explore / Plan / general-purpose). The sub-agent reads in *its* context and returns a short summary. The orchestrator does **not** read large files directly. This is the single biggest lever against the rate cap.
- **No-re-read rule.** Never re-Read a file you just edited — Edit/Write already confirm success. Trust the tool result.
- **Narrow output.** Prefer Grep/Glob with `head_limit` and line ranges over whole-file reads. Pipe large command output to a file and read only the needed range.
- **Batch.** Put independent reads/edits in a single multi-tool message.
- **Commit cadence.** One commit per completed `todo.md` item. Update `todo.md` + append `worklog.md` *before* committing so state ships with the code.
- **Rate-limit fallback.** If a limit is hit mid-task, do nothing special — the durable files mean the next turn resumes cheaply via the Resume Protocol.

---

## 3. Why this is foolproof

- A summarization event can erase conversational detail, but `todo.md` + `worklog.md` + git history are untouched on disk → state is always recoverable.
- The orchestrator's per-turn input stays small (no large files inlined) → the rate cap is approached slowly.
- Progress is committed incrementally → no large uncommitted working set to lose, and `git log` doubles as an audit trail.

**If you are reading this mid-task and unsure where you are: run the Resume Protocol (section 0). Do not guess, and do not re-explore the codebase.**
