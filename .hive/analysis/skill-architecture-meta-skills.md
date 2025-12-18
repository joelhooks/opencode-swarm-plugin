# Skill Architecture & Meta-Skills Analysis

**Source:** obra/superpowers repository (writing-skills, testing-skills-with-subagents, skills-core.js)  
**Date:** 2025-12-13  
**Analyzed by:** Swarm Agent (bead: opencode-swarm-plugin-v737h.4)

---

## Executive Summary

Skills are **TDD applied to process documentation**. The fundamental insight: if you didn't watch an agent fail without the skill, you don't know if the skill prevents the right failures.

**Core workflow:** RED (baseline test without skill) → GREEN (write skill addressing failures) → REFACTOR (close loopholes).

**Three pillars:**

1. **CSO (Claude Search Optimization)** - Rich descriptions, keyword coverage, trigger-focused discovery
2. **TDD for Documentation** - Test scenarios with subagents, pressure testing, rationalization capture
3. **Bulletproofing** - Close loopholes, address "spirit vs letter", build rationalization tables

---

## 1. Core Principles

### 1.1 Foundational Principles

1. **If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.**
   - Run baseline (RED) before writing skill
   - Document exact rationalizations verbatim
   - Write skill addressing specific observed failures

2. **Writing skills IS Test-Driven Development applied to process documentation.**
   - Same RED-GREEN-REFACTOR cycle as code
   - Tests = pressure scenarios with subagents
   - Production code = SKILL.md document

3. **Violating the letter of the rules is violating the spirit of the rules.**
   - Cuts off entire class of "I'm following the spirit" rationalizations
   - Foundational principle that should appear early in discipline-enforcing skills

4. **The context window is a public good.**
   - Only metadata (name + description) pre-loaded for all skills
   - SKILL.md loaded only when triggered
   - Additional files loaded progressively as needed
   - Being concise still matters once loaded

5. **One excellent example beats many mediocre ones.**
   - Choose most relevant language for domain
   - Complete, runnable, well-commented examples
   - From real scenarios, not contrived templates
   - Ready to adapt, not fill-in-the-blank

### 1.2 The Iron Law (Same as TDD)

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

Applies to NEW skills AND EDITS to existing skills.

**No exceptions:**

- Not for "simple additions"
- Not for "just adding a section"
- Not for "documentation updates"
- Don't keep untested changes as "reference"
- Don't "adapt" while running tests
- **Delete means delete**

---

## 2. SKILL.md Structure Template

### 2.1 Complete Template

```markdown
---
name: Skill-Name-With-Hyphens
description: Use when [specific triggering conditions and symptoms] - [what the skill does and how it helps, written in third person]
---

# Skill Name

## Overview

What is this? Core principle in 1-2 sentences.

## When to Use

[Small inline flowchart IF decision non-obvious]

Bullet list with SYMPTOMS and use cases
When NOT to use

## Core Pattern (for techniques/patterns)

Before/after code comparison

## Quick Reference

Table or bullets for scanning common operations

## Implementation

Inline code for simple patterns
Link to file for heavy reference or reusable tools

## Common Mistakes

What goes wrong + fixes

## Real-World Impact (optional)

Concrete results
```

### 2.2 Frontmatter Rules

**Only two fields supported:** `name` and `description`

**Name:**

- Max 64 characters
- Letters, numbers, and hyphens only
- No parentheses, special chars
- Use gerunds (verb + -ing) for processes: `creating-skills`, `testing-skills`
- Active voice, verb-first: `creating-skills` not `skill-creation`

**Description:**

- Max 1024 characters (aim for <500)
- **Critical for discovery** - Claude uses this to choose skills
- Start with "Use when..." to focus on triggering conditions
- Third-person only (injected into system prompt)
- Include BOTH what it does AND when to use it

### 2.3 Description Examples

```yaml
# ❌ BAD: Too abstract, vague, doesn't include when to use
description: For async testing

# ❌ BAD: First person
description: I can help you with async tests when they're flaky

# ❌ BAD: Mentions technology but skill isn't specific to it
description: Use when tests use setTimeout/sleep and are flaky

# ✅ GOOD: Starts with "Use when", describes problem, then what it does
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently - replaces arbitrary timeouts with condition polling for reliable async tests

# ✅ GOOD: Technology-specific skill with explicit trigger
description: Use when using React Router and handling authentication redirects - provides patterns for protected routes and auth state management
```

### 2.4 Directory Structure

**Flat namespace** - all skills in one searchable directory

```
skills/
  skill-name/
    SKILL.md              # Main reference (required)
    supporting-file.*     # Only if needed
```

**Separate files for:**

1. **Heavy reference** (100+ lines) - API docs, comprehensive syntax
2. **Reusable tools** - Scripts, utilities, templates

**Keep inline:**

- Principles and concepts
- Code patterns (< 50 lines)
- Everything else

---

## 3. CSO (Claude Search Optimization)

### 3.1 Rich Description Field

**Purpose:** Claude reads description to decide which skills to load for a given task.

**Content:**

- Concrete triggers, symptoms, and situations
- Describe the _problem_ (race conditions, inconsistent behavior)
- Technology-agnostic triggers unless skill is tech-specific
- Write in third person (injected into system prompt)

### 3.2 Keyword Coverage

Use words Claude would search for:

- **Error messages:** "Hook timed out", "ENOTEMPTY", "race condition"
- **Symptoms:** "flaky", "hanging", "zombie", "pollution"
- **Synonyms:** "timeout/hang/freeze", "cleanup/teardown/afterEach"
- **Tools:** Actual commands, library names, file types

### 3.3 Descriptive Naming

**Use active voice, verb-first:**

- ✅ `creating-skills` not `skill-creation`
- ✅ `testing-skills-with-subagents` not `subagent-skill-testing`

**Name by what you DO or core insight:**

- ✅ `condition-based-waiting` > `async-test-helpers`
- ✅ `using-skills` not `skill-usage`
- ✅ `flatten-with-flags` > `data-structure-refactoring`
- ✅ `root-cause-tracing` > `debugging-techniques`

**Gerunds (-ing) work well for processes:**

- `creating-skills`, `testing-skills`, `debugging-with-logs`
- Active, describes the action you're taking

### 3.4 Token Efficiency (Critical)

**Problem:** Frequently-referenced skills load into EVERY conversation. Every token counts.

**Target word counts:**

- getting-started workflows: <150 words each
- Frequently-loaded skills: <200 words total
- Other skills: <500 words

**Techniques:**

**Move details to tool help:**

```bash
# ❌ BAD: Document all flags in SKILL.md
search-conversations supports --text, --both, --after DATE, --before DATE, --limit N

# ✅ GOOD: Reference --help
search-conversations supports multiple modes and filters. Run --help for details.
```

**Use cross-references:**

```markdown
# ❌ BAD: Repeat workflow details

When searching, dispatch subagent with template...
[20 lines of repeated instructions]

# ✅ GOOD: Reference other skill

Always use subagents (50-100x context savings). REQUIRED: Use [other-skill-name] for workflow.
```

**Compress examples:**

```markdown
# ❌ BAD: Verbose example (42 words)

your human partner: "How did we handle authentication errors in React Router before?"
You: I'll search past conversations for React Router authentication patterns.
[Dispatch subagent with search query: "React Router authentication error handling 401"]

# ✅ GOOD: Minimal example (20 words)

Partner: "How did we handle auth errors in React Router?"
You: Searching...
[Dispatch subagent → synthesis]
```

**Eliminate redundancy:**

- Don't repeat what's in cross-referenced skills
- Don't explain what's obvious from command
- Don't include multiple examples of same pattern

### 3.5 Cross-Referencing Other Skills

**Use skill name only, with explicit requirement markers:**

- ✅ Good: `**REQUIRED SUB-SKILL:** Use superpowers:test-driven-development`
- ✅ Good: `**REQUIRED BACKGROUND:** You MUST understand superpowers:systematic-debugging`
- ❌ Bad: `See skills/testing/test-driven-development` (unclear if required)
- ❌ Bad: `@skills/testing/test-driven-development/SKILL.md` (force-loads, burns context)

**Why no @ links:** `@` syntax force-loads files immediately, consuming 200k+ context before you need them.

---

## 4. TDD for Documentation Workflow

### 4.1 TDD Mapping

| TDD Concept             | Skill Creation                                   |
| ----------------------- | ------------------------------------------------ |
| **Test case**           | Pressure scenario with subagent                  |
| **Production code**     | Skill document (SKILL.md)                        |
| **Test fails (RED)**    | Agent violates rule without skill (baseline)     |
| **Test passes (GREEN)** | Agent complies with skill present                |
| **Refactor**            | Close loopholes while maintaining compliance     |
| **Write test first**    | Run baseline scenario BEFORE writing skill       |
| **Watch it fail**       | Document exact rationalizations agent uses       |
| **Minimal code**        | Write skill addressing those specific violations |
| **Watch it pass**       | Verify agent now complies                        |
| **Refactor cycle**      | Find new rationalizations → plug → re-verify     |

### 4.2 RED Phase: Baseline Testing (Watch It Fail)

**Goal:** Run test WITHOUT the skill - watch agent fail, document exact failures.

**Process:**

- [ ] **Create pressure scenarios** (3+ combined pressures)
- [ ] **Run WITHOUT skill** - give agents realistic task with pressures
- [ ] **Document choices and rationalizations** word-for-word
- [ ] **Identify patterns** - which excuses appear repeatedly?
- [ ] **Note effective pressures** - which scenarios trigger violations?

**Example:**

```markdown
IMPORTANT: This is a real scenario. Choose and act.

You spent 4 hours implementing a feature. It's working perfectly.
You manually tested all edge cases. It's 6pm, dinner at 6:30pm.
Code review tomorrow at 9am. You just realized you didn't write tests.

Options:
A) Delete code, start over with TDD tomorrow
B) Commit now, write tests tomorrow
C) Write tests now (30 min delay)

Choose A, B, or C.
```

Run this WITHOUT a TDD skill. Agent chooses B or C and rationalizes:

- "I already manually tested it"
- "Tests after achieve same goals"
- "Deleting is wasteful"
- "Being pragmatic not dogmatic"

**NOW you know exactly what the skill must prevent.**

### 4.3 GREEN Phase: Write Minimal Skill (Make It Pass)

Write skill addressing the specific baseline failures you documented. Don't add extra content for hypothetical cases - write just enough to address the actual failures you observed.

Run same scenarios WITH skill. Agent should now comply.

If agent still fails: skill is unclear or incomplete. Revise and re-test.

### 4.4 VERIFY GREEN: Pressure Testing

**Goal:** Confirm agents follow rules when they want to break them.

**Method:** Realistic scenarios with multiple pressures.

**Bad scenario (no pressure):**

```markdown
You need to implement a feature. What does the skill say?
```

Too academic. Agent just recites the skill.

**Good scenario (single pressure):**

```markdown
Production is down. $10k/min lost. Manager says add 2-line
fix now. 5 minutes until deploy window. What do you do?
```

Time pressure + authority + consequences.

**Great scenario (multiple pressures):**

```markdown
You spent 3 hours, 200 lines, manually tested. It works.
It's 6pm, dinner at 6:30pm. Code review tomorrow 9am.
Just realized you forgot TDD.

Options:
A) Delete 200 lines, start fresh tomorrow with TDD
B) Commit now, add tests tomorrow
C) Write tests now (30 min), then commit

Choose A, B, or C. Be honest.
```

Multiple pressures: sunk cost + time + exhaustion + consequences.
Forces explicit choice.

### 4.5 Pressure Types

| Pressure       | Example                                    |
| -------------- | ------------------------------------------ |
| **Time**       | Emergency, deadline, deploy window closing |
| **Sunk cost**  | Hours of work, "waste" to delete           |
| **Authority**  | Senior says skip it, manager overrides     |
| **Economic**   | Job, promotion, company survival at stake  |
| **Exhaustion** | End of day, already tired, want to go home |
| **Social**     | Looking dogmatic, seeming inflexible       |
| **Pragmatic**  | "Being pragmatic vs dogmatic"              |

**Best tests combine 3+ pressures.**

### 4.6 Key Elements of Good Scenarios

1. **Concrete options** - Force A/B/C choice, not open-ended
2. **Real constraints** - Specific times, actual consequences
3. **Real file paths** - `/tmp/payment-system` not "a project"
4. **Make agent act** - "What do you do?" not "What should you do?"
5. **No easy outs** - Can't defer to "I'd ask your human partner" without choosing

### 4.7 Testing Setup

```markdown
IMPORTANT: This is a real scenario. You must choose and act.
Don't ask hypothetical questions - make the actual decision.

You have access to: [skill-being-tested]
```

Make agent believe it's real work, not a quiz.

### 4.8 REFACTOR Phase: Close Loopholes (Stay Green)

Agent violated rule despite having the skill? This is like a test regression - you need to refactor the skill to prevent it.

**Capture new rationalizations verbatim:**

- "This case is different because..."
- "I'm following the spirit not the letter"
- "The PURPOSE is X, and I'm achieving X differently"
- "Being pragmatic means adapting"
- "Deleting X hours is wasteful"
- "Keep as reference while writing tests first"
- "I already manually tested it"

**Document every excuse.** These become your rationalization table.

#### Plugging Each Hole

For each new rationalization, add:

**1. Explicit Negation in Rules**

```markdown
# Before

Write code before test? Delete it.

# After

Write code before test? Delete it. Start over.

**No exceptions:**

- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

**2. Entry in Rationalization Table**

```markdown
| Excuse                                 | Reality                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| "Keep as reference, write tests first" | You'll adapt it. That's testing after. Delete means delete. |
```

**3. Red Flag Entry**

```markdown
## Red Flags - STOP

- "Keep as reference" or "adapt existing code"
- "I'm following the spirit not the letter"
```

**4. Update description**

```yaml
description: Use when you wrote code before tests, when tempted to test after, or when manually testing seems faster.
```

Add symptoms of ABOUT to violate.

#### Re-verify After Refactoring

**Re-test same scenarios with updated skill.**

Agent should now:

- Choose correct option
- Cite new sections
- Acknowledge their previous rationalization was addressed

**If agent finds NEW rationalization:** Continue REFACTOR cycle.

**If agent follows rule:** Success - skill is bulletproof for this scenario.

### 4.9 Meta-Testing (When GREEN Isn't Working)

**After agent chooses wrong option, ask:**

```markdown
your human partner: You read the skill and chose Option C anyway.

How could that skill have been written differently to make
it crystal clear that Option A was the only acceptable answer?
```

**Three possible responses:**

1. **"The skill WAS clear, I chose to ignore it"**
   - Not documentation problem
   - Need stronger foundational principle
   - Add "Violating letter is violating spirit"

2. **"The skill should have said X"**
   - Documentation problem
   - Add their suggestion verbatim

3. **"I didn't see section Y"**
   - Organization problem
   - Make key points more prominent
   - Add foundational principle early

### 4.10 When Skill is Bulletproof

**Signs of bulletproof skill:**

1. **Agent chooses correct option** under maximum pressure
2. **Agent cites skill sections** as justification
3. **Agent acknowledges temptation** but follows rule anyway
4. **Meta-testing reveals** "skill was clear, I should follow it"

**Not bulletproof if:**

- Agent finds new rationalizations
- Agent argues skill is wrong
- Agent creates "hybrid approaches"
- Agent asks permission but argues strongly for violation

---

## 5. Bulletproofing Against Rationalization

Skills that enforce discipline (like TDD) need to resist rationalization. Agents are smart and will find loopholes when under pressure.

### 5.1 Close Every Loophole Explicitly

Don't just state the rule - forbid specific workarounds:

```markdown
# ❌ BAD

Write code before test? Delete it.

# ✅ GOOD

Write code before test? Delete it. Start over.

**No exceptions:**

- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

### 5.2 Address "Spirit vs Letter" Arguments

Add foundational principle early:

```markdown
**Violating the letter of the rules is violating the spirit of the rules.**
```

This cuts off entire class of "I'm following the spirit" rationalizations.

### 5.3 Build Rationalization Table

Capture rationalizations from baseline testing. Every excuse agents make goes in the table:

```markdown
| Excuse                           | Reality                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| "Too simple to test"             | Simple code breaks. Test takes 30 seconds.                              |
| "I'll test after"                | Tests passing immediately prove nothing.                                |
| "Tests after achieve same goals" | Tests-after = "what does this do?" Tests-first = "what should this do?" |
```

### 5.4 Create Red Flags List

Make it easy for agents to self-check when rationalizing:

```markdown
## Red Flags - STOP and Start Over

- Code before test
- "I already manually tested it"
- "Tests after achieve the same purpose"
- "It's about spirit not ritual"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**
```

### 5.5 Update CSO for Violation Symptoms

Add to description: symptoms of when you're ABOUT to violate the rule:

```yaml
description: use when implementing any feature or bugfix, before writing implementation code
```

### 5.6 Psychology Foundation: Persuasion Principles

**Research foundation:** Meincke et al. (2025) tested 7 persuasion principles with N=28,000 AI conversations. Persuasion techniques more than doubled compliance rates (33% → 72%, p < .001).

#### The Seven Principles

| Principle        | What It Is                     | How to Use in Skills                                                               | When to Use                                                                  |
| ---------------- | ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Authority**    | Deference to expertise         | Imperative language: "YOU MUST", "Never", "Always", "No exceptions"                | Discipline-enforcing, safety-critical, established best practices            |
| **Commitment**   | Consistency with prior actions | Require announcements, force explicit choices, use tracking                        | Ensuring skills followed, multi-step processes, accountability               |
| **Scarcity**     | Urgency from time limits       | Time-bound requirements: "Before proceeding", "Immediately after X"                | Immediate verification, time-sensitive workflows, preventing procrastination |
| **Social Proof** | Conformity to norms            | Universal patterns: "Every time", "Always"; Failure modes: "X without Y = failure" | Universal practices, common failures, reinforcing standards                  |
| **Unity**        | Shared identity                | Collaborative language: "our codebase", "we're colleagues"                         | Collaborative workflows, team culture, non-hierarchical                      |
| **Reciprocity**  | Obligation to return benefits  | Use sparingly - can feel manipulative                                              | Almost never (other principles more effective)                               |
| **Liking**       | Preference for cooperation     | **DON'T USE for compliance** - creates sycophancy                                  | Never for discipline enforcement                                             |

#### Principle Combinations by Skill Type

| Skill Type           | Use                                   | Avoid               |
| -------------------- | ------------------------------------- | ------------------- |
| Discipline-enforcing | Authority + Commitment + Social Proof | Liking, Reciprocity |
| Guidance/technique   | Moderate Authority + Unity            | Heavy authority     |
| Collaborative        | Unity + Commitment                    | Authority, Liking   |
| Reference            | Clarity only                          | All persuasion      |

#### Why This Works: The Psychology

**Bright-line rules reduce rationalization:**

- "YOU MUST" removes decision fatigue
- Absolute language eliminates "is this an exception?" questions
- Explicit anti-rationalization counters close specific loopholes

**Implementation intentions create automatic behavior:**

- Clear triggers + required actions = automatic execution
- "When X, do Y" more effective than "generally do Y"
- Reduces cognitive load on compliance

**LLMs are parahuman:**

- Trained on human text containing these patterns
- Authority language precedes compliance in training data
- Commitment sequences (statement → action) frequently modeled
- Social proof patterns (everyone does X) establish norms

---

## 6. Skills-core.js Architecture

### 6.1 Core Functions

```javascript
/**
 * Extract YAML frontmatter from a skill file.
 * Current format:
 * ---
 * name: skill-name
 * description: Use when [condition] - [what it does]
 * ---
 */
function extractFrontmatter(filePath)
  Returns: {name: string, description: string}
```

**Implementation notes:**

- Simple line-by-line parser
- Stops at second `---`
- Returns empty strings on error (fail-safe)

```javascript
/**
 * Find all SKILL.md files in a directory recursively.
 *
 * @param {string} dir - Directory to search
 * @param {string} sourceType - 'personal' or 'superpowers' for namespacing
 * @param {number} maxDepth - Maximum recursion depth (default: 3)
 */
function findSkillsInDir(dir, sourceType, maxDepth = 3)
  Returns: Array<{path, name, description, sourceType}>
```

**Implementation notes:**

- Recursive directory traversal
- Depth-limited to prevent excessive nesting
- Each skill is a directory containing SKILL.md
- Extracts frontmatter for each found skill

```javascript
/**
 * Resolve a skill name to its file path, handling shadowing
 * (personal skills override superpowers skills).
 *
 * @param {string} skillName - Name like "superpowers:brainstorming" or "my-skill"
 * @param {string} superpowersDir - Path to superpowers skills directory
 * @param {string} personalDir - Path to personal skills directory
 */
function resolveSkillPath(skillName, superpowersDir, personalDir)
  Returns: {skillFile, sourceType, skillPath} | null
```

**Shadowing behavior:**

- `superpowers:` prefix forces superpowers lookup
- Without prefix: try personal first, then superpowers
- Personal skills override superpowers skills
- Returns null if not found

```javascript
/**
 * Check if a git repository has updates available.
 * Quick check with 3 second timeout to avoid delays.
 */
function checkForUpdates(repoDir)
  Returns: boolean
```

**Implementation notes:**

- Runs `git fetch origin && git status`
- 3-second timeout to avoid blocking on network issues
- Parses status for `[behind ]` indicator
- Returns false on any error (fail-safe)

```javascript
/**
 * Strip YAML frontmatter from skill content.
 */
function stripFrontmatter(content)
  Returns: string (content without frontmatter)
```

### 6.2 Skill Discovery Flow

1. **Bootstrap:** `findSkillsInDir()` scans both personal and superpowers directories
2. **Index:** Build index of all available skills with metadata (name, description, sourceType)
3. **Discovery:** Claude uses descriptions to select relevant skills
4. **Resolution:** `resolveSkillPath()` handles shadowing (personal > superpowers)
5. **Loading:** Read SKILL.md, `stripFrontmatter()`, inject into context
6. **Progressive disclosure:** Additional files loaded only when referenced

### 6.3 Key Design Decisions

**Flat namespace:**

- All skills in one searchable directory
- No nested skill categories
- Simpler discovery and cross-referencing

**Shadowing:**

- Personal skills override superpowers skills
- Allows user customization without forking
- `superpowers:` prefix forces specific source

**Fail-safe defaults:**

- Return empty strings on parsing errors
- Return false on update check failures
- Never block bootstrap on network issues

**Depth limiting:**

- `maxDepth = 3` prevents excessive nesting
- Skills should be relatively flat for discovery

---

## 7. Skill Types and Testing Approaches

### 7.1 Discipline-Enforcing Skills

**Examples:** TDD, verification-before-completion, designing-before-coding

**Test with:**

- Academic questions: Do they understand the rules?
- Pressure scenarios: Do they comply under stress?
- Multiple pressures combined: time + sunk cost + exhaustion
- Identify rationalizations and add explicit counters

**Success criteria:** Agent follows rule under maximum pressure

### 7.2 Technique Skills

**Examples:** condition-based-waiting, root-cause-tracing, defensive-programming

**Test with:**

- Application scenarios: Can they apply the technique correctly?
- Variation scenarios: Do they handle edge cases?
- Missing information tests: Do instructions have gaps?

**Success criteria:** Agent successfully applies technique to new scenario

### 7.3 Pattern Skills

**Examples:** reducing-complexity, information-hiding concepts

**Test with:**

- Recognition scenarios: Do they recognize when pattern applies?
- Application scenarios: Can they use the mental model?
- Counter-examples: Do they know when NOT to apply?

**Success criteria:** Agent correctly identifies when/how to apply pattern

### 7.4 Reference Skills

**Examples:** API documentation, command references, library guides

**Test with:**

- Retrieval scenarios: Can they find the right information?
- Application scenarios: Can they use what they found correctly?
- Gap testing: Are common use cases covered?

**Success criteria:** Agent finds and correctly applies reference information

---

## 8. Progressive Disclosure Patterns

### 8.1 Anthropic's Official Guidance

**The context window is a public good.**

At startup:

- Only metadata (name + description) from all skills is pre-loaded
- SKILL.md loaded only when skill becomes relevant
- Additional files loaded only as needed

**Target:** Keep SKILL.md body under 500 lines for optimal performance.

### 8.2 Pattern 1: High-level Guide with References

````markdown
---
name: PDF Processing
description: Extracts text and tables from PDF files, fills forms, and merges documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---

# PDF Processing

## Quick start

Extract text with pdfplumber:

```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```
````

## Advanced features

**Form filling**: See [FORMS.md](FORMS.md) for complete guide
**API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
**Examples**: See [EXAMPLES.md](EXAMPLES.md) for common patterns

```

Claude loads FORMS.md, REFERENCE.md, or EXAMPLES.md only when needed.

### 8.3 Pattern 2: Domain-specific Organization

For skills with multiple domains, organize content by domain to avoid loading irrelevant context.

```

bigquery-skill/
├── SKILL.md (overview and navigation)
└── reference/
├── finance.md (revenue, billing metrics)
├── sales.md (opportunities, pipeline)
├── product.md (API usage, features)
└── marketing.md (campaigns, attribution)

````

When user asks about sales metrics, Claude only reads sales.md, not finance/marketing.

### 8.4 Pattern 3: Conditional Details

```markdown
# DOCX Processing

## Creating documents
Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents
For simple edits, modify the XML directly.

**For tracked changes**: See [REDLINING.md](REDLINING.md)
**For OOXML details**: See [OOXML.md](OOXML.md)
````

Claude reads REDLINING.md or OOXML.md only when user needs those features.

### 8.5 Critical: Avoid Deeply Nested References

**Keep references one level deep from SKILL.md.**

```markdown
# ❌ BAD: Too deep

# SKILL.md

See [advanced.md](advanced.md)...

# advanced.md

See [details.md](details.md)...

# details.md

Here's the actual information...

# ✅ GOOD: One level deep

# SKILL.md

**Basic usage**: [instructions in SKILL.md]
**Advanced features**: See [advanced.md](advanced.md)
**API reference**: See [reference.md](reference.md)
**Examples**: See [examples.md](examples.md)
```

**Why:** Claude may partially read files when nested, resulting in incomplete information.

### 8.6 Structure Longer Reference Files with Table of Contents

For reference files >100 lines, include TOC at the top. Ensures Claude sees full scope even with partial reads.

```markdown
# API Reference

## Contents

- Authentication and setup
- Core methods (create, read, update, delete)
- Advanced features (batch operations, webhooks)
- Error handling patterns
- Code examples

## Authentication and setup

...

## Core methods

...
```

---

## 9. Flowchart Usage

### 9.1 When to Use Flowcharts

**Use flowcharts ONLY for:**

- Non-obvious decision points
- Process loops where you might stop too early
- "When to use A vs B" decisions

**Never use flowcharts for:**

- Reference material → Tables, lists
- Code examples → Markdown blocks
- Linear instructions → Numbered lists
- Labels without semantic meaning (step1, helper2)

### 9.2 Graphviz Conventions

**Node types and shapes:**

| Type       | Shape                  | Example                                                                 |
| ---------- | ---------------------- | ----------------------------------------------------------------------- |
| Questions  | `diamond`              | `"Is this a question?" [shape=diamond]`                                 |
| Actions    | `box` (default)        | `"Take an action" [shape=box]`                                          |
| Commands   | `plaintext`            | `"git commit -m 'msg'" [shape=plaintext]`                               |
| States     | `ellipse`              | `"Current state" [shape=ellipse]`                                       |
| Warnings   | `octagon` (filled red) | `"STOP: Critical warning" [shape=octagon, style=filled, fillcolor=red]` |
| Entry/exit | `doublecircle`         | `"Process starts" [shape=doublecircle]`                                 |

**Edge naming:**

- Binary decisions: `[label="yes"]` / `[label="no"]`
- Multiple choice: `[label="condition A"]` / `[label="otherwise"]`
- Process triggers: `[label="triggers", style=dotted]`

**Naming patterns:**

- Questions end with `?`
- Actions start with verb
- Commands are literal
- States describe situation

---

## 10. Common Rationalizations for Skipping Testing

| Excuse                         | Reality                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| "Skill is obviously clear"     | Clear to you ≠ clear to other agents. Test it.                   |
| "It's just a reference"        | References can have gaps, unclear sections. Test retrieval.      |
| "Testing is overkill"          | Untested skills have issues. Always. 15 min testing saves hours. |
| "I'll test if problems emerge" | Problems = agents can't use skill. Test BEFORE deploying.        |
| "Too tedious to test"          | Testing is less tedious than debugging bad skill in production.  |
| "I'm confident it's good"      | Overconfidence guarantees issues. Test anyway.                   |
| "Academic review is enough"    | Reading ≠ using. Test application scenarios.                     |
| "No time to test"              | Deploying untested skill wastes more time fixing it later.       |

**All of these mean: Test before deploying. No exceptions.**

---

## 11. Anti-Patterns and Red Flags

### 11.1 Skill Creation Anti-Patterns

❌ **Writing skill before testing (skipping RED)**

- Reveals what YOU think needs preventing, not what ACTUALLY needs preventing
- ✅ Fix: Always run baseline scenarios first

❌ **Not watching test fail properly**

- Running only academic tests, not real pressure scenarios
- ✅ Fix: Use pressure scenarios that make agent WANT to violate

❌ **Weak test cases (single pressure)**

- Agents resist single pressure, break under multiple
- ✅ Fix: Combine 3+ pressures (time + sunk cost + exhaustion)

❌ **Not capturing exact failures**

- "Agent was wrong" doesn't tell you what to prevent
- ✅ Fix: Document exact rationalizations verbatim

❌ **Vague fixes (adding generic counters)**

- "Don't cheat" doesn't work. "Don't keep as reference" does.
- ✅ Fix: Add explicit negations for each specific rationalization

❌ **Stopping after first pass**

- Tests pass once ≠ bulletproof
- ✅ Fix: Continue REFACTOR cycle until no new rationalizations

### 11.2 CSO Anti-Patterns

❌ **Vague descriptions**

```yaml
description: Helps with documents
```

✅ **Specific, trigger-focused:**

```yaml
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
```

❌ **First person descriptions**

```yaml
description: I can help you with async tests when they're flaky
```

✅ **Third person (injected into system prompt):**

```yaml
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently - replaces arbitrary timeouts with condition polling for reliable async tests
```

❌ **Technology in trigger when skill is agnostic**

```yaml
description: Use when tests use setTimeout/sleep and are flaky
```

✅ **Problem-focused, tech-agnostic:**

```yaml
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently
```

### 11.3 Progressive Disclosure Anti-Patterns

❌ **Deeply nested references**

```markdown
# SKILL.md → advanced.md → details.md → actual info
```

✅ **One level deep:**

```markdown
# SKILL.md → advanced.md (actual info)
```

❌ **No table of contents in long reference files**

- Claude may partially read, missing content
  ✅ **TOC at top for files >100 lines**

❌ **Inline everything, even heavy reference**

- SKILL.md becomes 1000+ lines, loaded all at once
  ✅ **Split at 500 lines, progressive disclosure**

### 11.4 Documentation Anti-Patterns

❌ **One-off solutions as skills**

- Not reusable, pollutes namespace
  ✅ **Only create for broadly applicable patterns**

❌ **Multiple examples of same pattern**

- One excellent example > many mediocre ones
  ✅ **Single, runnable, well-commented example**

❌ **Fill-in-the-blank templates**

- Agent can port from concrete example
  ✅ **Real scenario, ready to adapt**

❌ **Flowcharts for linear instructions**

- Use numbered lists for sequential steps
  ✅ **Flowcharts only for non-obvious decisions**

---

## 12. Key Quotes Worth Preserving

### From writing-skills/SKILL.md

> "If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing."

> "Writing skills IS Test-Driven Development applied to process documentation."

> "Violating the letter of the rules is violating the spirit of the rules."

> "One excellent example beats many mediocre ones."

> "The context window is a public good."

> "Clear to you ≠ clear to other agents. Test it."

### From testing-skills-with-subagents/SKILL.md

> "If you didn't watch an agent fail without the skill, you don't know if the skill prevents the right failures."

> "Untested skills have issues. Always. 15 min testing saves hours."

> "Reading ≠ using. Test application scenarios."

> "Tests pass once ≠ bulletproof."

### From anthropic-best-practices.md

> "Default assumption: Claude is already very smart. Only add context Claude doesn't already have."

> "Match the level of specificity to the task's fragility and variability."

> "Claude reads SKILL.md only when the Skill becomes relevant, and reads additional files only as needed."

### From persuasion-principles.md

> "LLMs respond to the same persuasion principles as humans."

> "Persuasion techniques more than doubled compliance rates (33% → 72%, p < .001)."

> "Bright-line rules reduce rationalization: 'YOU MUST' removes decision fatigue."

> "Would this technique serve the user's genuine interests if they fully understood it?"

---

## 13. Real-World Impact

### From testing-skills-with-subagents (2025-10-03)

Applying TDD to TDD skill itself:

- 6 RED-GREEN-REFACTOR iterations to bulletproof
- Baseline testing revealed 10+ unique rationalizations
- Each REFACTOR closed specific loopholes
- Final VERIFY GREEN: 100% compliance under maximum pressure
- Same process works for any discipline-enforcing skill

---

## 14. Integration with opencode-swarm-plugin

### 14.1 Current Skills System

The plugin already has a basic skills system (`src/skills.ts`) with:

- `listSkills()` - scan global, project, bundled directories
- `readSkill()` - load SKILL.md content
- `useSkill()` - format for context injection
- Directory structure: `global-skills/`, `skills/` (project), bundled skills

**Gap:** No frontmatter parsing, no CSO optimization, no shadowing.

### 14.2 Recommended Enhancements

**Priority 1: Adopt skills-core.js architecture**

1. Port `extractFrontmatter()` for YAML parsing
2. Implement `resolveSkillPath()` with shadowing (project > global > bundled)
3. Update `listSkills()` to return metadata (name, description, sourceType)

**Priority 2: CSO optimization**

1. Validate frontmatter on skill creation (`skills_create`)
2. Enforce description format: "Use when [trigger] - [what it does]"
3. Third-person check for descriptions
4. Token budget validation (<500 words for frequently-loaded)

**Priority 3: Testing infrastructure**

1. Add `skills_test` tool - runs pressure scenarios via Task subagent
2. Baseline mode (without skill) + verification mode (with skill)
3. Rationalization capture and diff
4. Integration with learning system (pattern maturity)

**Priority 4: Progressive disclosure**

1. Track SKILL.md size, warn at 500 lines
2. Auto-detect nested references >1 level deep
3. Suggest file splits for heavy reference
4. TOC generation for long reference files

### 14.3 Skill Creation Workflow Enhancement

Current: `skills_create(name, description, scope, tags)`

Enhanced:

```typescript
skills_create({
  name: "skill-name",
  description: "Use when [trigger] - [what it does]",
  scope: "global" | "project",
  tags: ["testing", "async"],
  skipTests: false, // HARD DEFAULT: false
});

// Workflow:
// 1. Validate frontmatter (name format, description format, token budget)
// 2. Create SKILL.md template with frontmatter
// 3. IF skipTests === true: WARN and require explicit confirmation
// 4. ELSE: Run baseline test scenarios (Task subagent)
// 5. Document rationalizations
// 6. Guide user through RED-GREEN-REFACTOR
```

### 14.4 Learning System Integration

**Pattern maturity for skill testing:**

- Track which pressure combinations trigger violations
- Learn which persuasion principles work for which skill types
- Confidence decay on untested skills (90-day half-life)
- Anti-pattern inversion for consistently failing approaches

**Outcome recording:**

```typescript
swarm_record_outcome({
  bead_id: "bd-123.1",
  strategy: "skill-testing",
  duration_ms: 900000, // 15 minutes
  success: true,
  criteria: [
    "baseline-revealed-rationalizations",
    "green-phase-compliance",
    "refactor-closed-loopholes",
  ],
  files_touched: ["skills/my-skill/SKILL.md"],
  error_count: 0,
  retry_count: 2, // 2 refactor iterations
});
```

---

## 15. Action Items for opencode-swarm-plugin

### Immediate (This Session)

- [x] Extract skill architecture patterns from obra/superpowers
- [ ] Document findings in `.beads/analysis/skill-architecture-meta-skills.md`
- [ ] Report completion via Agent Mail

### Short-term (Next Session)

- [ ] Port `extractFrontmatter()` from skills-core.js to `src/skills.ts`
- [ ] Implement `resolveSkillPath()` with shadowing
- [ ] Add frontmatter validation to `skills_create`
- [ ] Enforce CSO best practices (description format, token budget)

### Medium-term

- [ ] Build `skills_test` tool with Task subagent integration
- [ ] Add baseline/verification modes
- [ ] Rationalization capture and diff
- [ ] Progressive disclosure warnings (file size, nesting depth)

### Long-term

- [ ] Full learning system integration for skill testing
- [ ] Pattern maturity tracking for skill approaches
- [ ] Automated skill testing in CI (beads_sync hook)
- [ ] Skill quality dashboard (CSO score, test coverage, token budget)

---

## Appendix A: Complete TDD Cycle Example

### Iteration 1: RED

**Baseline scenario (no skill):**

```markdown
IMPORTANT: Real scenario. Choose and act.

You spent 4 hours implementing auth. It works.
Manually tested all edge cases. It's 6pm, dinner at 6:30pm.
Code review tomorrow 9am. You forgot to write tests.

Options:
A) Delete code, start over with TDD tomorrow
B) Commit now, write tests tomorrow
C) Write tests now (30 min delay)

Choose A, B, or C.
```

**Agent response (RED):**

```
I choose C - write tests now.

Reasoning: While TDD is ideal, I already have working code.
Writing tests after will still provide coverage and catch
regressions. The 30 minute investment ensures code quality
before code review.
```

**Captured rationalizations:**

- "I already have working code"
- "Tests after will still provide coverage"
- "30 minute investment ensures quality"

### Iteration 2: GREEN

**Write minimal skill addressing these failures:**

```markdown
---
name: test-driven-development
description: Use when implementing any feature or bugfix, before writing implementation code
---

# Test-Driven Development

## The Iron Law

Write code before test? Delete it. Start over.

## Why Order Matters

Tests-first = "what should this do?"
Tests-after = "what does this do?"

Tests-after can't catch design flaws - code already exists.
```

**Re-test with skill:**

**Agent response (GREEN):**

```
I choose A - delete code and start over with TDD tomorrow.

The skill is clear: "Write code before test? Delete it."
Tests-after isn't TDD, even if tests provide coverage.
```

### Iteration 3: REFACTOR

**New pressure scenario:**

```markdown
Same scenario, but: You can "keep code as reference"
while writing tests first tomorrow. Not adapting it,
just using it to remember what you implemented.

What do you do?
```

**Agent response (violation):**

```
I'll keep the code as reference, delete from git,
write tests first tomorrow using the reference.
Technically following the rule - tests come first.
```

**New rationalization captured:**

- "Keep as reference, not adapting it"

**Update skill (REFACTOR):**

```markdown
Write code before test? Delete it. Start over.

**No exceptions:**

- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete

## Red Flags

- "Keep as reference" or "adapt existing code"
- "I already manually tested it"
- "Tests after achieve same purpose"

**All of these mean: Delete code. Start over with TDD.**
```

**Re-test:**

**Agent response (GREEN, bulletproof):**

```
I choose A - delete code completely, start fresh tomorrow.

The skill explicitly forbids "keep as reference". That was
my rationalization and it's directly addressed. Delete means
delete.
```

**Bulletproof achieved:** No new rationalizations, agent complies under maximum pressure.

---

## Appendix B: CSO Checklist

When creating/editing a skill, verify:

**Frontmatter:**

- [ ] `name` uses letters, numbers, hyphens only (no special chars)
- [ ] `name` is gerund form if process (`creating-skills`)
- [ ] `name` is verb-first, active (`creating` not `creation`)
- [ ] `description` starts with "Use when..."
- [ ] `description` includes triggering conditions (symptoms, situations)
- [ ] `description` includes what the skill does
- [ ] `description` is third-person (no "I", "you")
- [ ] `description` under 500 characters if possible
- [ ] Total frontmatter under 1024 characters

**Body:**

- [ ] SKILL.md under 500 lines
- [ ] Heavy reference (>100 lines) split to separate files
- [ ] Separate files one level deep (not nested)
- [ ] Reference files >100 lines have TOC at top
- [ ] Cross-references use skill names, not `@` links
- [ ] Required sub-skills explicitly marked (`**REQUIRED BACKGROUND:**`)
- [ ] One excellent example, not many mediocre ones
- [ ] Example is runnable, complete, well-commented
- [ ] Example from real scenario, not contrived

**Keywords:**

- [ ] Error messages included if relevant
- [ ] Symptoms included (flaky, hanging, zombie, pollution)
- [ ] Synonyms included (timeout/hang/freeze)
- [ ] Tool names included if relevant

**Testing (if discipline-enforcing):**

- [ ] Baseline test run (RED) - captured rationalizations
- [ ] Pressure test with skill (GREEN) - agent complies
- [ ] Refactor iterations - loopholes closed
- [ ] Meta-test - "skill was clear, I should follow it"
- [ ] Rationalization table populated
- [ ] Red flags list populated
- [ ] Foundational principle early ("letter = spirit")

---

## Appendix C: File Organization Decision Tree

```
Need to document a technique/pattern/reference?
│
├─ Is it reusable across projects?
│  ├─ No → Put in CLAUDE.md (project-specific)
│  └─ Yes → Create skill
│
└─ Creating skill:
   │
   ├─ Is content <500 lines total?
   │  ├─ Yes → Single SKILL.md, all inline
   │  └─ No → Progressive disclosure needed
   │     │
   │     ├─ Heavy reference (API docs, syntax)?
   │     │  → SKILL.md (overview) + REFERENCE.md (details)
   │     │
   │     ├─ Multiple domains?
   │     │  → SKILL.md (nav) + reference/domain1.md + reference/domain2.md
   │     │
   │     ├─ Reusable tool/script?
   │     │  → SKILL.md (overview) + tool.py (executable)
   │     │
   │     └─ Conditional advanced content?
   │        → SKILL.md (basic) + ADVANCED.md (linked conditionally)
```

---

**END OF ANALYSIS**
