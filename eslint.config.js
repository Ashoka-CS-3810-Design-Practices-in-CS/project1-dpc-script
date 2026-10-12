import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const RULE = '@typescript-eslint/no-restricted-imports';
const PARENT = {
  regex: '^\\.\\.(/|$)',
  message: 'Parent-relative imports are banned: use the @/ alias (README §5.2).',
};
const CONTRACTS = ['model/types', 'model/result', 'algorithms/types', 'app/contracts'];

// README §5.2: runtime imports of `@/…` outside `allowed` are errors; `import type` of the
// contract files is allowed unless `typeOnly` is false (algorithms).
function layer(name, files, allowed, typeOnly = true) {
  const contracts = typeOnly
    ? CONTRACTS.filter((c) => !allowed.some((a) => c === a || c.startsWith(`${a}/`)))
    : [];
  const patterns = [PARENT];
  if (contracts.length) {
    patterns.push({
      regex: `^@/(${contracts.join('|')})$`,
      caseSensitive: true,
      allowTypeImports: true,
      message: `${name} may only use \`import type\` from this file (README §5.2).`,
    });
  }
  const notContract = contracts.length ? `(?!(${contracts.join('|')})$)` : '';
  patterns.push({
    regex: `^@/(?!(${allowed.join('|')})(/|$))${notContract}`,
    caseSensitive: true,
    message: `${name} may only import from: ${allowed.join(', ')} (README §5.2).`,
  });
  return { files, rules: { [RULE]: ['error', { patterns }] } };
}

export default defineConfig(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { [RULE]: ['error', { patterns: [PARENT] }] },
  },
  layer('algorithms', ['src/algorithms/**'], ['algorithms'], false),
  layer('model', ['src/model/**'], ['model', 'algorithms']),
  layer('engine', ['src/engine/**'], ['engine', 'model', 'algorithms']),
  layer('io', ['src/io/**'], ['io', 'model/constants', 'model/result']),
  layer('io/workers', ['src/io/workers/**'], ['io/workers', 'algorithms']),
  layer('app', ['src/app/**'], ['app', 'engine', 'model', 'algorithms', 'io']),
  layer('ui', ['src/ui/**'], ['ui', 'app', 'model/constants']),
  // Tests and the entry point may import anything (still no `../`).
  {
    files: ['src/test/**', 'src/main.tsx', '**/*.test.ts'],
    rules: { [RULE]: ['error', { patterns: [PARENT] }] },
  },
  prettier,
);
