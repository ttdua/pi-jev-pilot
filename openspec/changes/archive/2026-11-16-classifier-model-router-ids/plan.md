# Classifier Model Router Ids Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Let `classifier.model` in `config.json` accept router-style Jev model ids such as `openrouter/perplexity/pplx-decider-v1.3:free` (issue #78).

**Architecture:** The rule lives only in the classifier section of the config validator (`src/store/config.ts`) as its own named constant; the Jev client already sends `model` unchanged. Tests go through `readConfig` on a temp directory, as the existing config-read tests do.

**Tech Stack:** TypeScript, Bun test, the in-repo validator combinators (`string({ pattern })`).

## Global Constraints

- Classifier model rule: `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$` (1–128 characters; letters, digits, `.`, `_`, `-`, `:`, `/`; not starting with `-`, `:` or `/`).
- The rule is classifier-only: do not import it from or export it to `state-file.ts`, `review/tool.ts`, `ledger-schema.ts` or the tier/slot `modelId`; do not change those rules.
- No `default` exclusion for the classifier model.
- Tests need no secrets, paid calls or network beyond loopback.
- Repository text in English.

## Review Focus

- A secret-shaped value (`key=...`, quoted text, whitespace) slipping through the new rule.
- A trailing newline slipping through (JS `$` without the `m` flag matches only at the end of input, so it is rejected; the "Malformed model rejected" test pins it).
- Accidental coupling: a shared constant reused by CLI review or tier models.
- Other config sections staying valid when `classifier.model` is a router id (whole-file validity).
- `docs/configuration.md` regex text matching the code exactly.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `config.json` key `classifier.model` | modified | string matching `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$` (was `^[A-Za-z0-9._-]{1,64}$`); optional, default `jev-latest` | yes |

---

## Task 1: Classifier model id rule — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `tests/store/config-read.test.ts` (new tests after "Key-shaped apiKeyEnv rejected")
- Modify: `src/store/config.ts` (classifier `model` validator, around line 85)
- Modify: `docs/configuration.md` (`classifier` table, `model` row)

**Interfaces:** contract `config.json` key `classifier.model`.

- [ ] **Step 1: Write the failing tests** in `tests/store/config-read.test.ts`, inside `describe("readConfig")`, right after the "Key-shaped apiKeyEnv rejected" test:

```ts
  test("Router-style model accepted", () => {
    for (const model of [
      "jev-latest",
      "jev-1.14.0",
      "openrouter/perplexity/pplx-decider-v1.3:free",
      ".",
      "_",
      "default",
    ]) {
      const r = readJson({ classifier: { model } });
      expectValid(r);
      if (r.kind === "ok") expect(r.config.classifier?.model).toBe(model);
    }
  });

  test("Model length bound", () => {
    expectValid(readJson({ classifier: { model: "a".repeat(128) } }));
    expect(paths(readJson({ classifier: { model: "a".repeat(129) } }))).toEqual([
      "classifier.model",
    ]);
  });

  test("Malformed model rejected", () => {
    for (const model of [
      "",
      "/jev",
      "-jev",
      ":jev",
      "jev latest",
      "jev\tlatest",
      "jev-latest\n",
      "key=abc",
      'jev"x',
    ]) {
      expect(paths(readJson({ classifier: { model } }))).toEqual(["classifier.model"]);
    }
  });

  test("Router-style model keeps the other sections", () => {
    const full = JSON.parse(FULL);
    full.classifier.model = "openrouter/perplexity/pplx-decider-v1.3:free";
    expect(readJson(full)).toEqual({ kind: "ok", present: true, config: full });
  });
```

(`"jev\tlatest"` and `"jev-latest\n"` are TypeScript string escapes: a real tab and a real newline.)

- [ ] **Step 2: Run them and see them fail**

Run: `bun test tests/store/config-read.test.ts`
Expected: four FAILs. "Router-style model accepted" fails on the router id (`expected a string matching ^[A-Za-z0-9._-]{1,64}$`), "Model length bound" fails on the 128-character id, "Malformed model rejected" fails on `-jev`, which the old rule accepts, and "Router-style model keeps the other sections" fails because the whole file is invalid.

- [ ] **Step 3: Implement** in `src/store/config.ts`. Next to `providerName` (above `configValidator`), add:

```ts
/** The Jev classifier's model id; its own rule, so router ids like `provider/vendor/model:tag` fit. */
const classifierModel = string({ pattern: /^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$/ });
```

and in `configValidator` replace `model: string({ pattern: /^[A-Za-z0-9._-]{1,64}$/ }),` with `model: classifierModel,`. Do not touch `modelId`, `providerName` or any other file's pattern.

- [ ] **Step 4: Run the tests and see them pass**

Run: `bun test tests/store/config-read.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Update docs.** In `docs/configuration.md`, `classifier` table, replace the `model` row's notes with:

```
| `model` | `jev-latest` | `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$`. Pin a version with `jev-1.14.0`. A Jev-compatible proxy may need a routed id such as `openrouter/perplexity/pplx-decider-v1.3:free` |
```

- [ ] **Step 6: Full verification**

Run: `bun test && bun run typecheck && bun run lint && bun run fmt:check`
Expected: all exit 0.

- [ ] **Step 7: Reproduce issue #78 end to end through the config reader.** Write the issue's `config.json` (url `http://localhost:20128/v1/systemone`, model `openrouter/perplexity/pplx-decider-v1.3:free`, apiKeyEnv `NINEROUTER_API_KEY`) into a `mktemp -d` directory and run a one-off `bun -e` script that prints `readConfig(dir)`.
Expected: `kind` is `ok` (before the change it was `invalid` at `classifier.model`). No network call is made.

- [ ] **Step 8: Commit**

```bash
git add src/store/config.ts tests/store/config-read.test.ts docs/configuration.md
git commit -m "fix(config): accept router-style classifier model ids (#78)"
```

---

## Scenario → test

- Remote http URL rejected → `tests/store/config-read.test.ts` "Remote http URL rejected" (existing)
- Loopback http URL accepted → "Loopback http URL accepted" (existing)
- Whole loopback range accepted → "Whole loopback range accepted" (existing)
- Config and client agree → "Config and client agree" (existing)
- Other scheme rejected → "Other scheme rejected" (existing)
- URL with credentials rejected → "URL with credentials rejected" (existing)
- Timeout bounds → "Timeout bounds" (existing)
- Key-shaped apiKeyEnv rejected → "Key-shaped apiKeyEnv rejected" (existing)
- Router-style model accepted → "Router-style model accepted" and "Router-style model keeps the other sections" (new, Task 1)
- Model length bound → "Model length bound" (new, Task 1)
- Malformed model rejected → "Malformed model rejected" (new, Task 1)
