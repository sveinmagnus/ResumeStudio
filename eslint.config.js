import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
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
 * reading. If a rule can't be traced to a line in CLAUDE.md or a real defect,
 * it doesn't belong.
 *
 * The type-aware ruleset is not enabled: it roughly triples lint time and the
 * rules it adds (`no-floating-promises` chief among them) fight this codebase's
 * deliberate `void somePromise()` fire-and-forget style, which is load-bearing
 * for advisor runs.
 */
export default tseslint.config(
  {
    // Build output, deps, and the coverage report are not ours to lint.
    ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**', 'src/generated/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Client ────────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /**
       * eslint-plugin-react-hooks v7 promoted the React Compiler rules into
       * `recommended`. This app is React 18 WITHOUT the compiler, and these two
       * flag patterns it uses on purpose:
       *
       *  - `refs`: `useStableExpanded` and `useRegistryFilter` read and write a
       *    ref during render to pin an open card's position while the list
       *    re-sorts under it. Moving that to state + an effect reintroduces a
       *    frame of lag, which is the exact jump those hooks exist to prevent.
       *  - `set-state-in-effect`: syncing component state from an external store
       *    or from props is the ordinary React 18 pattern here (restoring a
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
       * CLAUDE.md §2: "No `any` unless interfacing with truly unknown shapes."
       * A warning rather than an error — the escape hatch is legitimate at the
       * import boundary, and the point is to make each use visible, not to ban
       * it and have people write `as unknown as X` instead.
       */
      '@typescript-eslint/no-explicit-any': 'warn',

      // An unused parameter named `_foo` is documentation, not dead code.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none', // `catch { }` with an ignored error is idiomatic here
      }],

      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },

  /**
   * CLAUDE.md §12, the localization boundary: a string is localized if it lands
   * in an exported .pdf/.docx/.txt, and stays a hardcoded English literal if it
   * only ever shows in the editor. `exportStrings` leaking into a component is
   * precisely how that decision "quietly reopens itself" — so the compiler asks
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

  // ── Tests ─────────────────────────────────────────────────────────────────
  {
    files: ['tests/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A test that reaches into a private shape or fakes a partial object is
      // doing its job; `any` there is a tool, not a smell.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },
)
