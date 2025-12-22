---
name: pr-triage
description: "Context-efficient PR comment triage. Fetch metadata first, bodies selectively. Prevents context exhaustion from verbose PR reviews."
tags:
  - pr
  - review
  - github
  - triage
  - context-efficiency
---

# PR Comment Triage - Context-Efficient Workflow

## The Problem

PR review tools (CodeRabbit) generate MASSIVE comment bodies. Fetching all = instant context exhaustion.

## The Solution: Metadata-First

```
┌─────────────────────────────────────────────┐
│   EFFICIENT PR COMMENT TRIAGE WORKFLOW      │
├─────────────────────────────────────────────┤
│                                             │
│  1. METADATA ONLY (compact)                 │
│     → id, path, line, author                │
│     → 50 comments = ~5KB not 500KB          │
│                                             │
│  2. CATEGORIZE without bodies               │
│     → Group by file/severity                │
│     → Filter by author (skip bots)          │
│                                             │
│  3. FETCH BODY selectively                  │
│     → Human comments: YES                   │
│     → Bot critical: YES                     │
│     → Bot suggestions: NO                   │
│                                             │
│  4. TRIAGE into buckets                     │
│     → fix-with-code                         │
│     → won't-fix                             │
│     → tracked-in-cell                       │
│                                             │
│  5. RESPOND with templates                  │
│                                             │
└─────────────────────────────────────────────┘
```

## SDK (Recommended)

Use `scripts/pr-comments.ts` for type-safe, Zod-validated operations:

```bash
# List metadata (compact, ~100 bytes/comment)
bun run scripts/pr-comments.ts list owner/repo 42

# Smart triage with priority sorting
bun run scripts/pr-comments.ts triage owner/repo 42

# Expand single comment body (when needed)
bun run scripts/pr-comments.ts expand owner/repo 123456

# Reply to comment
bun run scripts/pr-comments.ts reply owner/repo 42 123456 "✅ Fixed"

# File-level summary
bun run scripts/pr-comments.ts summary owner/repo 42
```

### Programmatic Usage

```typescript
import {
  fetchMetadata,
  fetchBody,
  reply,
  triage,
  refineTriage,
  extractSeverity,
  templates,
} from "./scripts/pr-comments.ts";

// 1. Fetch metadata (compact)
const comments = await fetchMetadata("owner/repo", 42);
// → 50 comments = ~5KB

// 2. Smart triage (sorts by priority, flags needsBody)
const triaged = triage(comments);
const needBody = triaged.filter(c => c.needsBody);
// → Usually 3-5 comments need body fetch

// 3. Fetch bodies selectively
for (const c of needBody) {
  const full = await fetchBody("owner/repo", c.id);
  const refined = refineTriage(c, full.body);
  
  if (refined.category === "fix-with-code") {
    // Implement fix...
    await reply("owner/repo", 42, c.id, templates.fixed("abc123"));
  }
}
```

## Raw gh Commands (Fallback)

```bash
# Metadata only
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --jq '.[] | {id, path, line, author: .user.login}'

# Reply to comment (note: -F not -f, in_reply_to not in_reply_to_id)
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  --method POST \
  -F body="✅ Fixed in abc123" \
  -F in_reply_to={comment_id}
```

## Triage Buckets

### fix-with-code
**Trigger:** Security/correctness issue with clear fix.

```markdown
✅ Fixed in {commit_sha}

{brief explanation}
```

### won't-fix
**Trigger:** Stylistic, out-of-scope, or disagree.

```markdown
Thanks for the suggestion! Not applying because {reason}.
```

### tracked-in-cell
**Trigger:** Valid but outside PR scope.

```markdown
Good catch! Tracked in {cell_id}.

Out of scope for this PR but we'll address it separately.
```

## Context Budget Rules

| Scenario | Fetch Bodies? | Max |
|----------|---------------|-----|
| Initial scan | NO | Unlimited |
| Human comments | YES | All |
| Bot critical | YES | Top 5 |
| Bot warnings | SELECTIVE | 1-2/file |
| Bot suggestions | NO | Batch ack |

**Rule:** If fetching >10 bodies, you're doing it wrong.

## CodeRabbit Severity

Markers in comment body:
- `🛑 **Critical**:` - Fix before merge
- `⚠️ **Warning**:` - Triage for fix vs defer
- `💡 **Suggestion**:` - Skip unless trivial
- `📝 **Informational**:` - Batch acknowledge

## Anti-Patterns

❌ `gh pr view --comments` - dumps everything, exhausts context

❌ Read every bot suggestion body - 90% is noise

❌ Reply individually to every comment - notification spam

❌ Triage without metadata scan - can't prioritize

## Pro Tips

✅ Use `--jq` liberally - keeps responses compact

✅ Group by file first - batch-address related comments

✅ Create cells proactively - better to track than forget

✅ Check `in_reply_to_id == null` - focus on root comments

## References

- `scripts/pr-comments.ts` - Type-safe SDK with Zod schemas
- `references/gh-api-patterns.md` - Complete jq query library, pagination, GraphQL patterns
