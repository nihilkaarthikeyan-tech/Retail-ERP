# Monthly library updates

Audit 10 (30 October 2026). Once a month, and at once when a security warning names a library we use.

## 1. Look

```bash
pnpm audit
pnpm outdated -r
```

- `pnpm audit` lists known security holes. Anything **critical** or **high** in a package the live system runs (not only the test tools) is fixed the same week.
- `pnpm outdated -r` lists newer versions.

## 2. Update

1. **Patch and minor versions** (the middle and last numbers, such as 4.1.11 → 4.1.12): update them together with `pnpm -r update`.
2. **Major versions** (the first number, such as 16 → 17): update one library at a time, read its upgrade notes, and keep it apart from other changes.
3. **A hole in a library pulled in by another one:** if the parent has no fixed release yet, add a narrow override in the root `package.json` that lifts only the affected versions, for example `"undici@>=8.0.0 <8.12.2": "^8.12.2"`. Remove the override once the parent ships the fix.
4. **Never** add or move to a library under GPL, AGPL or an unclear licence without the owner (CLAUDE.md §1.7). `sharp` stays blocked (LGPL).

## 3. Check

```bash
pnpm licenses list --prod
pnpm test
pnpm test:e2e
pnpm build
```

- Every licence is still MIT, Apache-2.0, BSD, ISC or one already listed in `docs/third-party-licences.md`; update that file when the list changes.
- All tests pass, run alone.
- `docker build --target api .` and `docker build --target web .` still build. The images stay slim: about 0.9 GB for the API (most of it is the Prisma tool that applies database changes) and 0.4 GB for the web app.

## 4. Ship

Commit as "Library updates <month>", then deploy as usual (`deploy/README.md`), with the backup and checks.

## Log

| Month | What changed | By |
| --- | --- | --- |
| October 2026 | vitest 4.1.12; overrides for lodash (Prisma Studio), undici (test browser), qs (test HTTP client); `pnpm audit` clean | Audit 10 |
