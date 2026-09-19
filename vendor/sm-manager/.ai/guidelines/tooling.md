# Project Tooling

These conventions are specific to this project and override default package guidance.

## Testing — Pest (not PHPUnit)

- Tests use Pest. Write tests with `test()` / `it()` and `expect()`, not PHPUnit classes.
- `tests/Pest.php` binds `Tests\TestCase` and `RefreshDatabase` to the `Feature/` and `Unit/` directories, so individual test files do not need `extends TestCase` or `use RefreshDatabase`.
- Use `beforeEach()` instead of `setUp()`, and file-scoped `function` definitions instead of private helper methods.
- Create a test with `php artisan make:test {name}` then convert it to Pest functional style, or write the Pest file directly.
- Run: `composer test`, `./vendor/bin/pest --compact`, or filter with `./vendor/bin/pest --filter=name`.
- Do NOT convert Pest tests to PHPUnit.

## JS package manager — bun (not npm)

- Use `bun install`, `bun run <script>`, and `bunx <bin>`. Do not use `npm`, `npx`, or `pnpm`.
- The lockfile is `bun.lock`.

## JS lint — oxlint (not eslint)

- Config: `.oxlintrc.json` (type-aware linting enabled via `oxlint-tsgolint`).
- Run `bun run lint` (auto-fix) or `bun run lint:check`.

## JS format — oxfmt (not prettier)

- Config: `.oxfmtrc.json`, which includes Tailwind CSS class sorting and import sorting.
- Run `bun run format` (write) or `bun run format:check`.

## PHP refactoring — Rector

- Config: `rector.php` (PHP sets + Laravel sets via `driftingly/rector-laravel`).
- Run `composer refactor:check` (dry-run) to preview, then `composer refactor` to apply.
- Review Rector diffs before committing; do not blanket-apply.

## PHP style + static analysis (unchanged)

- Pint for code style: `vendor/bin/pint --dirty` (run before finalizing PHP changes).
- Larastan for static analysis: `composer types:check` (level 7).

## Full local gate

`composer ci:check` runs oxlint, oxfmt, tsc, Pint, Larastan, and the Pest suite.
