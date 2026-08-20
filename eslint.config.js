import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import importX from 'eslint-plugin-import-x'
import vitest from '@vitest/eslint-plugin'
import testingLibrary from 'eslint-plugin-testing-library'
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs'
import globals from 'globals'

/**
 * ESLint exists here for ONE reason: this project has a set of documented
 * invariants that were previously held by discipline alone, and discipline
 * doesn't survive a tired evening. Every custom rule below corresponds to a
 * rule already written down in CLAUDE.md, and most of them correspond to a bug
 * that has already happened once.
 *
 * It is deliberately NOT a style guide. There is no formatting opinion here, no
 * import ordering, no naming policy — the codebase is already consistent and a
 * linter arguing about semicolons is how teams learn to run `--fix` without
 * reading. If a rule can't be traced to a line in CLAUDE.md, to a real defect,
 * or to a class of bug the type system can't see, it doesn't belong.
 *
 * Layout: shared rules first, then one block per layer (client / lib / store /
 * server / tests), because the rules genuinely differ per layer — `any` is a
 * smell in `src/lib` and a tool in a test.
 */
/**
 * A RAW control character in a string literal — a NUL, most often — makes git
 * and grep classify the WHOLE FILE as binary, so every recursive text search
 * silently skips it. That is how a security sweep or a rename audit misses a
 * file without anyone noticing. Write the escape instead: `'\u0000'` is the
 * same string and keeps the file readable as text.
 *
 * This has happened once (AtsAuditPanel's `gaps.join()` separator), and nothing
 * else catches it: the type checker is perfectly happy, and the tool you would
 * use to go looking is the tool that skips the file.
 *
 * Shared because it must hold for server and tests too, and `no-restricted-syntax`
 * options REPLACE rather than merge across config blocks — so it is spliced into
 * every array that sets the rule rather than declared once.
 */
const noRawControlChars = {
  selector: 'Literal[raw=/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/]',
  message:
    'Write control characters as escapes (\\u0000), never as raw bytes — a raw one ' +
    'makes the file binary to git and grep, so text searches skip it entirely.',
}

export default tseslint.config(
  {
    /**
     * Build output, deps, and the coverage report are not ours to lint.
     *
     * `**\/`-prefixed so a NESTED copy is covered too: an ignore anchored at the
     * config root does not match the same directory inside a sibling git
     * worktree, so `eslint .` walked every worktree's `dist/` and
     * `src/generated/` (the taxonomy JSON) and died of heap exhaustion after
     * six minutes. The worktree root itself is ignored outright — a worktree is
     * its own checkout and lints from inside itself.
     *
     * The `vitest.mutation.*` / `stryker.mutation.*` entries are the per-file
     * configs `scripts/mutation-run.mjs` generates and deletes as it goes (they
     * are gitignored for the same reason). Linting them is pointless, and it is
     * worse than pointless: a mutation run in another checkout can delete one
     * mid-walk, and ESLint aborts the whole run with ENOENT — so an unrelated
     * background task turns the lint gate red.
     */
    ignores: [
      '**/dist/**', '**/release/**', '**/coverage/**', '**/node_modules/**',
      '**/src/generated/**', '**/reports/**', '**/.stryker-tmp/**',
      '.claude/worktrees/**',
      '**/vitest.mutation.*.config.ts', '**/stryker.mutation.*.json',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  comments.recommended,

  /**
   * Every `eslint-disable` must say WHY, inline, after a `--`.
   *
   * Not bureaucracy: a bare disable is indistinguishable from a rule someone
   * silenced because it was inconvenient, and the next reader has no way to
   * tell a considered exception from a shrug. This whole config leans on
   * documented exceptions — the WAI-ARIA tablist, contentEditable focusability,
   * the deliberately keyboard-operable crop canvas — and each is only defensible
   * because the reason travels with it.
   */
  {
    rules: {
      '@eslint-community/eslint-comments/require-description': ['error', {
        ignore: ['eslint-enable'],
      }],

      /**
       * `==` coerces, `===` does not. This is a ratchet rather than a cleanup:
       * the codebase is already 100% consistent, and every one of the 54 loose
       * comparisons in it is the deliberate `== null` nullish check, which this
       * configuration keeps legal. It costs nothing today and stops the one
       * `==` that would eventually be written against a number or a string.
       */
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      'no-restricted-syntax': ['error', noRawControlChars],

      /**
       * Not a style preference — a layering one. An unmarked type-only import is
       * a REAL runtime module edge: the bundler keeps it, which is how a cycle
       * appears between modules that only ever referenced each other's types,
       * and how `types/` (CLAUDE.md §3: zero runtime imports) quietly acquires
       * one. `import type` is erased, so marking it makes the import graph the
       * linter checks the same graph that ships.
       */
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
        // Inline `import('x').T` annotations stay legal: they are how the
        // systray2 CJS/ESM interop and `keyof import('../types').Resume` are
        // expressed, and they are already erased — there is no runtime edge to
        // police, which is the entire point of this rule.
        disallowTypeAnnotations: false,
      }],
    },
  },

  /**
   * Type-aware rules, chosen individually rather than by preset.
   *
   * The full `recommendedTypeChecked` preset is not enabled: it triples lint
   * time and most of what it adds is noise on a codebase this strict. These
   * five are the ones that find things `tsc` cannot, and they are cheap here
   * precisely because the codebase already has the habits they check —
   * `void somePromise()` is used in 80-odd places as the deliberate
   * fire-and-forget marker, so `no-floating-promises` only ever fires on the
   * ones nobody marked, which is exactly the bug.
   */
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'tests/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // BOTH projects, named explicitly. `projectService: true` alone finds
        // only tsconfig.json, so every server file came back "not found by the
        // project service" — i.e. the type-aware rules silently did not run on
        // the half of the codebase where an unhandled promise matters most.
        project: ['./tsconfig.json', './tsconfig.server.json', './tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited, unmarked promise is a rejection nobody will ever see.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      // An async function where a void one is expected — the classic
      // `onClick={async () => …}` unhandled rejection.
      '@typescript-eslint/no-misused-promises': 'error',
      // `await` on a non-promise: usually a forgotten call or a wrong type.
      '@typescript-eslint/await-thenable': 'error',
      // `async` with no `await` inside is a signature that lies to its callers.
      '@typescript-eslint/require-await': 'error',
      // Returning a promise from a try block loses the catch unless awaited.
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
    },
  },

  // ── Client ────────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': { typescript: true, node: true },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /**
       * eslint-plugin-react-hooks v7 promoted the React Compiler rules into
       * `recommended`. This app does NOT use the compiler, and these two
       * flag patterns it uses on purpose:
       *
       *  - `refs`: `useStableExpanded` and `useRegistryFilter` read and write a
       *    ref during render to pin an open card's position while the list
       *    re-sorts under it. Moving that to state + an effect reintroduces a
       *    frame of lag, which is the exact jump those hooks exist to prevent.
       *  - `set-state-in-effect`: syncing component state from an external store
       *    or from props is the ordinary pattern here (restoring a
       *    stored advisor run, seeding a form from the server).
       *
       * Off rather than warn: a rule nobody is going to act on is noise, and
       * noise is how a lint run stops being read. Revisit if the app ever adopts
       * the compiler — at that point these become real findings.
       */
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',

      // The two classic rules are the reason this plugin is here at all.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      /**
       * Accessibility, statically.
       *
       * Not redundant with the jest-axe suite: axe only sees what a test
       * actually mounts, and there are ~50 components. This checks all of them,
       * every run, and it protects the v0.3.1 accessibility wave from erosion.
       */
      ...jsxA11y.flatConfigs.recommended.rules,

      /**
       * Three rules from that set are OFF, and the reason is a real
       * accessibility argument rather than convenience.
       *
       * The app has exactly two idioms they fire on, ~56 times between them:
       *
       *  1. `onClick={(e) => e.stopPropagation()}` on a wrapper — a propagation
       *     stop, not an action. There is no user-facing behaviour to give a
       *     keyboard equivalent to.
       *  2. An enlarged mouse hit-area (a modal backdrop that dismisses, a card
       *     header or collapsed preview that expands) sitting NEXT TO a real
       *     focusable control that does the same thing — the card's title
       *     button, the dialog's close button plus Esc via `useDialog`.
       *
       * "Fixing" the second by adding tabIndex + onKeyDown would create a second
       * tab stop that lands on the same action a keyboard user already reached,
       * which is worse for them, not better. The rules cannot see the adjacent
       * control or the Esc handler, so they are wrong here specifically.
       *
       * Everything else in the recommended set stays ON — alt-text, ARIA prop
       * validity, required ARIA props, label association, and the rest, all of
       * which found real defects when this was first enabled.
       */
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',

      /**
       * A circular import in a 55k-line codebase with a store, a lib layer and
       * fifty components is a real hazard — `TranslationPopover` already lives
       * where it does specifically to avoid one, which is a comment rather than
       * a guarantee. This makes it a guarantee.
       */
      'import-x/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
      // An import of something the target module doesn't export — tsc catches
      // this for typed modules, this catches it for the untyped edges.
      'import-x/no-self-import': 'error',

      '@typescript-eslint/no-explicit-any': 'warn',

      // An unused parameter named `_foo` is documentation, not dead code.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none', // `catch { }` with an ignored error is idiomatic here
      }],

      'no-restricted-syntax': [
        'error',
        noRawControlChars,
        {
          /**
           * CLAUDE.md §6: the `.pf-*` plain-field primitives live in index.css,
           * NOT in a component's <style> block. A component-scoped style block
           * only exists in the DOM while that component is mounted, so a page
           * using a bare `.pf-input` without mounting TextField/DateField gets an
           * unstyled browser default — which regressed the registry CategoryField
           * once already.
           *
           * The collision is the other half of the same hazard, and it was live
           * when this rule was written: PageFitPanel defined its own `.pf-wrap`
           * (there "pf" meant PageFit), globally overriding the shared primitive
           * that Fields, SimpleEditors and RegistryEditors all use, for as long
           * as that panel was mounted. Component <style> blocks are not scoped.
           *
           * USING the class is fine — this only matches a template literal, i.e.
           * a style block DEFINING it. className="pf-wrap" is a plain string.
           */
          selector: 'TemplateElement[value.raw=/\\.pf-/]',
          message:
            'The .pf-* primitives are defined in src/index.css (CLAUDE.md §6). ' +
            'Do not define or override them in a component <style> block — those ' +
            'are global and only present while the component is mounted. Use your ' +
            "own prefix for a component's classes.",
        },
        {
          /**
           * CLAUDE.md §6: minimum text size is 11px. Below that the UI stops
           * being readable for the people who need it most, and it is the kind
           * of thing that arrives one 10px label at a time. Same shape as the
           * `transition: all` rule — the styles are template literals, so this
           * catches it where it actually lives.
           */
          selector: 'TemplateElement[value.raw=/font-size:\\s*([0-9]|10)(\\.[0-9]+)?px/]',
          message:
            'Minimum text size is 11px (CLAUDE.md §6). Anything smaller is not ' +
            'readable enough to ship.',
        },
        {
          /**
           * CLAUDE.md §2 + §13: lucide icons are imported BY NAME. A namespace
           * import defeats tree-shaking and adds ~700 kB to the bundle — a
           * regression nobody notices until they read a build log.
           */
          selector: 'ImportDeclaration[source.value="lucide-react"] ImportNamespaceSpecifier',
          message:
            'Import lucide icons by name (`import { Star } from "lucide-react"`). ' +
            'A namespace import defeats tree-shaking and adds ~700 kB to the bundle.',
        },
        {
          /**
           * CLAUDE.md §11: the DOCX and PDF exporters are lazy-loaded (~352 kB
           * and ~1.2 MB). A STATIC import from anywhere pulls them into the
           * initial bundle. `import()` is untouched — this selector only matches
           * an ImportDeclaration.
           */
          selector:
            'ImportDeclaration[source.value=/(^|\\/)(exporter|pdfExporter)$/]',
          message:
            'Import lib/exporter and lib/pdfExporter with a dynamic import() only — ' +
            'a static import puts ~350 kB (DOCX) or ~1.2 MB (pdfmake) in the initial bundle.',
        },
        {
          /**
           * CLAUDE.md §2: "No `process.env` at runtime in the client." The app
           * is a pure browser bundle once it leaves Vite; the Express server is
           * the only place env vars are read.
           */
          selector: 'MemberExpression[object.object.name="process"][object.property.name="env"]',
          message:
            'No process.env in client code — this is a browser bundle. ' +
            'Read configuration on the server and expose it through the API.',
        },
        {
          /**
           * CLAUDE.md §2 (accessibility invariants): `transition: all` animates
           * properties nobody intended, including ones that trigger layout.
           * List the properties. The inline <style> blocks are template
           * literals, so this catches it where it actually lives.
           */
          selector: 'TemplateElement[value.raw=/transition:\\s*all\\b/]',
          message:
            'Do not use `transition: all` — list the properties you mean ' +
            '(CLAUDE.md §2). Reduced-motion is handled globally in index.css.',
        },
        {
          /**
           * `dangerouslySetInnerHTML` is legitimate here — the rich-text and
           * view-render paths exist to produce HTML — but every use must sit
           * downstream of `sanitizeRich` / `escapeHtml`. Flagged so adding one
           * is a decision with a reviewer, not a reflex. Disable with a reason
           * (eslint-comments/require-description enforces the reason).
           */
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML must be fed by sanitizeRich/escapeHtml — ' +
            'see the security skill, then disable this rule with the reason.',
        },
        {
          /**
           * `target="_blank"` without `rel="noopener"` hands the opened page a
           * `window.opener` handle back into the app. All 8 existing links get
           * it right; this keeps the ninth honest.
           */
          selector:
            'JSXOpeningElement[name.name="a"]:has(JSXAttribute[name.name="target"][value.value="_blank"]):not(:has(JSXAttribute[name.name="rel"]))',
          message: 'An external target="_blank" link needs rel="noopener noreferrer".',
        },
      ],
    },
  },

  /**
   * The layering from CLAUDE.md §3, made mechanical.
   *
   * 1. types/  — zero runtime imports (pure type definitions)
   * 2. lib/    — pure logic, no React
   * 3. store/  — owns mutable state
   * 4. components/ — read from the store, call store actions
   *
   * Dependencies point DOWN that list. The rule below stops new upward edges;
   * the two that already exist are excepted by name with their reason, because
   * restructuring a working imperative-dialog mechanism during a 1.0 freeze is
   * a worse trade than documenting it.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/no-restricted-paths': ['error', {
        zones: [
          {
            target: './src/lib',
            from: './src/components',
            message: 'lib/ is pure logic — it must not depend on a component (CLAUDE.md §3).',
          },
          {
            target: './src/lib',
            from: './src/store',
            message: 'lib/ is pure logic — it must not depend on the store (CLAUDE.md §3).',
          },
          {
            target: './src/types',
            from: './src',
            message: 'types/ has zero runtime imports — it is the bottom of the stack (CLAUDE.md §3).',
          },
          {
            target: './src/store',
            from: './src/components',
            // `ConfirmDialog` is imperative and self-portaling on purpose, so
            // that `await confirmDialog(…)` works from a hook without threading
            // a provider through the tree. It renders React, so it cannot move
            // to lib/. This is the one sanctioned upward edge.
            except: ['./ui/ConfirmDialog.tsx'],
            message:
              'The store must not import from components/ (CLAUDE.md §3). ' +
              'ConfirmDialog is the one exception — it is imperative by design.',
          },
        ],
      }],
    },
  },

  /**
   * `lib/` is pure logic — no React. `router.ts` is the deliberate exception:
   * it owns `useRoute` and `<Link>`, which are the router's public surface and
   * cannot exist without React.
   */
  {
    files: ['src/lib/**/*.ts'],
    ignores: ['src/lib/router.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'react',
          message: 'lib/ is pure, React-free logic (CLAUDE.md §3). Put the hook in store/ or components/.',
        }],
      }],
    },
  },

  /**
   * CLAUDE.md §12, the localization boundary: a string is localized if it lands
   * in an exported .pdf/.docx/.txt, and stays a hardcoded English literal if it
   * only ever shows in the editor. `exportStrings` leaking into a component is
   * precisely how that decision "quietly reopens itself" — so the linter asks
   * the question instead of a reviewer having to remember.
   */
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/exportStrings'],
          message:
            'exportStrings is EXPORT chrome (localized for all 15 locales). ' +
            'Editor UI is English-only by decision — see CLAUDE.md §12.',
        }],
      }],
    },
  },

  // ── Server ────────────────────────────────────────────────────────────────
  {
    files: ['server/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },

  // Codegen scripts are plain Node with no TS project — type-aware rules can't
  // resolve them and don't apply.
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', '*.config.{js,ts}'],
    ...tseslint.configs.disableTypeChecked,
  },

  /**
   * React Testing Library rules, scoped to the tests that actually render
   * React.
   *
   * The failure they exist for doesn't look like a failure: a `findBy*` without
   * `await` resolves to a promise, which is always truthy, so the assertion
   * passes whatever the DOM says.
   *
   * Scoped rather than applied to `tests/**` because the rules match by NAME.
   * `accounts.findByLogin` is a synchronous database lookup with no relation to
   * RTL, and under the wider glob every call to it was reported as an
   * unawaited query — a false positive that would push someone toward either a
   * pointless `await` or a blanket disable.
   */
  {
    files: ['tests/components/**/*.{ts,tsx}'],
    plugins: { 'testing-library': testingLibrary },
    rules: {
      ...testingLibrary.configs['flat/react'].rules,
    },
  },

  // ── Tests ─────────────────────────────────────────────────────────────────
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { vitest, 'testing-library': testingLibrary },
    rules: {
      ...vitest.configs.recommended.rules,

      /**
       * Vitest is not Jest, and this suite has deliberate habits. Each of these
       * is configured rather than blindly inherited:
       */

      // Vitest's `expect(actual, message)` takes a custom failure message, and
      // the table-driven tests rely on it: `expect(item.id, spec.key)` is what
      // tells you WHICH spec failed out of twenty. The default (Jest-shaped)
      // limit of 1 argument would forbid the more informative form.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],

      // Assertions that live in a shared helper are still assertions. Naming
      // them keeps the rule useful for tests that genuinely assert nothing.
      'vitest/expect-expect': ['error', {
        assertFunctionNames: ['expect', 'expectFullCoverage', 'assertSafe', 'expectValidOoxml'],
      }],

      /**
       * OFF, with reasons — these three fight the suite's deliberate style
       * rather than finding defects:
       *
       * - `no-conditional-expect`: the try/catch-then-assert-the-error idiom is
       *   how the importers' error CONTENTS get asserted (which issue path,
       *   which error class). Every instance is guarded by a
       *   `throw new Error('should have thrown')`, which is precisely the
       *   false-pass this rule protects against — so the risk is already handled
       *   in a way the rule can't see.
       * - `no-node-access` / `no-container`: this app styles with inline
       *   <style> blocks and per-component classes, and several tests assert on
       *   structure and computed style. RTL has no by-class query BY DESIGN, so
       *   `container.querySelector('.sb-group-label')` is the only way to make
       *   those assertions — the alternative is not asserting them.
       */
      'vitest/no-conditional-expect': 'off',
      'testing-library/no-node-access': 'off',
      'testing-library/no-container': 'off',

      // A naming preference, and this config does not hold naming opinions.
      'testing-library/render-result-naming-convention': 'off',
      // A test that reaches into a private shape or fakes a partial object is
      // doing its job; `any` there is a tool, not a smell.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // Mocks and fixtures legitimately hand unawaited promises around.
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  /**
   * CLAUDE.md §2: "No default exports for components — use named exports."
   *
   * A default export renames itself at every import site, so the name in a
   * stack trace, a mock, or a lazy() chunk need not match the file — and a
   * typo'd import silently binds to the wrong thing rather than failing. The
   * two sanctioned defaults, `main.tsx` and `App.tsx`, are Vite/React entry
   * points and sit OUTSIDE these three directories, so no exception is needed
   * and this costs nothing today.
   */
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/lib/**/*.ts', 'src/store/**/*.ts'],
    plugins: { 'import-x': importX },
    rules: { 'import-x/no-default-export': 'error' },
  },

  // Playwright, not Vitest — the vitest plugin's globals don't apply.
  {
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
)
