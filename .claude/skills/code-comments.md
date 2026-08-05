---
name: code-comments
description: How to write and review code comments here — sparse, terse, above the line, explaining WHY without narrating the diff. Use whenever writing a comment, reviewing a diff for comment quality, cleaning up wordy or stale comments, deciding whether something needs a comment at all, or when asked to "add comments", "document this code", or "clean up the comments".
---

# Code Comments

A comment is a claim the compiler can't check and the test suite can't hold to
account. It rots silently and gets read by everyone. So the bar isn't "is this
true?" — it's **"would a competent reader be wrong without it?"** Most comments
fail that bar; the few that pass are worth their weight, and they earn it by
being precise, not by being long.

---

## The rules

### 1. Comment sparingly — WHY only

Default to no comment. Well-named identifiers already say WHAT. Write one only
when the WHY is genuinely non-obvious:

- a hidden constraint (a byte limit, a spec quirk, an ordering requirement)
- a subtle invariant the code relies on but doesn't state
- a workaround for a specific external bug or platform behaviour
- behaviour that would surprise a reader who understands the language
- a deliberate omission — code that *looks* missing but isn't

Never explain what the code does. Never reference the current task, ticket, PR,
or caller ("used by the export path", "added for the letter flow") — those rot
the moment the code moves.

### 2. Don't comment out code

Delete it. Git has it. Commented-out code is indistinguishable from broken
code, and it survives every future edit because nobody dares touch it.

### 3. Don't narrate the change

A comment describes the code as it stands, not the edit that produced it. Ban
the diff vocabulary: **added, removed, changed, updated, now, no longer,
previously, used to**.

```ts
// Bad
this.timeout(10_000) // Increase timeout for API calls
```

Bad because the reader learns nothing usable: increased from *what*? The old
value is not their problem. If ten seconds is load-bearing, say why it's ten:

```ts
// Good
// The LLM round-trip is the slow leg — the server's advanced budget allows 180 s,
// so a 10 s ceiling here is deliberately the *client's* patience, not the model's.
this.timeout(10_000)
```

If you can't state why the current value is right, the comment adds nothing;
drop it.

### 4. Don't emphasise versions of the code

"This code now handles X", "updated to support Y", "this also works for Z since
the rework" — all versioning noise. There is one version: the one in the file.
Write the constraint, not its history.

**The exceptions — code whose SUBJECT is the old thing:**

- **A migration** (`lib/migrate.ts`) has to say what the previous shape was,
  because that shape is its input. It describes the data, not the commit.
- **A regression test** has to name the bug it pins, because the bug is what the
  test is *about*. "HTML used to leak the real name" earns its place in
  `viewFilter.test.ts`; delete it and the next reader deletes the assertion.
- **A back-compat branch** may name the legacy value it still accepts.

The test is whether the old state is the code's subject or just its history. If
you can delete the past tense and the reader loses nothing, it was history.

### 5. No end-of-line comments

Put the comment on its own line, above the code it describes.

```ts
// Bad
const key = normalize(name) // strips diacritics so Windows and macOS agree

// Good
// Diacritics are stripped so Windows and macOS derive byte-identical keys.
const key = normalize(name)
```

Trailing comments get truncated in diffs, force line-length compromises, and
have no room to carry the reason — which is why they degenerate into restating
the code. The only tolerated trailing forms are the mechanical ones: `eslint-disable-next-line`
directives, `// eslint-disable-line`, and a type hint on a bare literal.

### 6. Terse is not vague

Compression is the goal; omission is not. If understanding the WHY requires a
number, a version, a platform, or a named failure mode, it belongs in the
comment — precisely.

```ts
// Too vague — "some" and "certain" tell the reader nothing they can act on
// Some browsers do this wrong in certain cases.

// Right — names the actor, the behaviour, and the consequence
// Chrome ignores defaultParagraphSeparator at focus time, and its default <div>
// is unwrapped by the allowlist — silently merging the two lines.
```

A comment can be three lines and still be terse if every line is load-bearing.
It's wordy when you can delete a clause and lose nothing.

---

## Reviewing a diff

Walk each comment in the change and ask, in order:

1. **Does it say WHAT?** → delete it.
2. **Does it narrate the edit** (added/removed/now/used to)? → rewrite as the
   standing reason, or delete.
3. **Is it commented-out code?** → delete.
4. **Is it trailing?** → move above the line.
5. **Is it vague** (some, certain, various, for safety, just in case)? → make it
   specific or delete it.
6. **Is it still true?** A stale comment is worse than none — it actively
   misleads. If the code beneath it moved, the comment is a defect.

Whatever survives all six is what you keep, and you keep it whole — don't trim a
surviving comment down until it stops explaining.

---

## Where longer commentary belongs instead

The instinct to write a paragraph is often right; the file is usually wrong.

- **Cross-cutting invariants and architecture** → `CLAUDE.md` (§ by topic) or
  the relevant `.claude/skills/*.md`. That's where the paragraph-spacing rule
  and the sync-model reasoning live, not in the function that happens to touch
  them.
- **Why this change was made** → the commit message and the PR body.
- **A rule that can be mechanically enforced** → an ESLint rule in
  `eslint.config.js`, with the reason recorded there. A lint rule can't rot into
  a lie the way a comment can.
- **The contract a function promises** → a test. It's the only form of
  documentation that fails when it stops being true.

A file-header comment explaining a module's role is fine and often valuable —
that's context no identifier can carry. It's still subject to every rule above.
