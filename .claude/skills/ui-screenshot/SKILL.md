---
name: ui-screenshot
description: Screenshot any page of the webclient (pwr-webclient) with mocked data, no backend needed, for human or agent review of UI changes. Use when asked to screenshot, show, check or review a page, a UI change, or a before/after comparison, or to attach screenshots to an issue or PR.
---

# Screenshots of webclient pages

`scripts/screenshot.mjs` opens one or more UI paths in headless Chromium (Playwright) and saves a PNG per path. It takes
any path of the app, so new routes need no change here. It starts the webclient dev server itself if none runs on the
port, waits until every request is answered, and stops the server again afterwards.

```shell
node .claude/skills/ui-screenshot/scripts/screenshot.mjs /app/mmu/profile /admin/home/consultants
```

The paths are the routes of `pwr-webclient/src/Paths.ts` with real values. Without `--user` the local admin is logged
in. The fixtures hold the consultant `mmu` (Max Mustermann, filled profile, project `900001`, view profile
`f7c0a540-9260-4a7c-b850-5b9a20391958`) and a second consultant `emu` (Erika Musterfrau), who has no profile.

## Options

| Option | Meaning |
|---|---|
| `--mode mock` | default: the dev server answers `/api/**` from `pwr-webclient/mock/fixtures`, no service runs |
| `--mode live` | the locally running services (`start:local`), e.g. to see data you just created |
| `--mode record` | like `live`, and every answer becomes a fixture (see below) |
| `--user <initials>` | log in as this consultant without admin role (colleague view, own profile) |
| `--out <dir>` | default `pwr-webclient/screenshots` (gitignored) |
| `--name <name>` | file name without `.png`, only with one path; default: the path as slug |
| `--width`, `--height` | viewport, default 1440×900 |
| `--full-page` | the whole scrollable page |
| `--selector <css>` | only this element, e.g. `header` |
| `--wait-for <css>` | also wait until this element is visible |
| `--date <iso>` | fixed browser clock, default `2026-06-01T10:00:00`, so "outdated" hints don't change from day to day; `now` for the real clock |
| `--port <n>` | default 3100. A running dev server is reused if it has the same mode and user, otherwise the script stops with an error: use another port for another mode or user |
| `--keep-server` | leave the dev server running; the next call starts in seconds instead of a minute |

Prerequisites: `npm --prefix pwr-webclient install`, then once `npx --prefix pwr-webclient playwright install chromium`.

## Reading the result

stdout is a JSON list, one entry per path:

- `file`: the PNG. Look at it with the Read tool.
- `finalUrl`: where the app ended up. If it differs from `path`, the app redirected, e.g. to the own profile because
  the consultant of the path is unknown, or the start page to the consultants.
- `missingFixtures`: requests the mock could not answer. The page then shows what the app shows when that request
  fails, usually an error toast or empty data. Add the fixture (below) and take the screenshot again.
- `problems`: HTTP errors of `/api/**` and errors in the browser console. React's deprecation warnings of the dev build
  are left out.

A screenshot with missing fixtures or problems doesn't show the page as a user sees it. Say so when you report it.

## Review of a UI change

1. Take the screenshots of the changed pages on the branch, with `--name` such as `<page>-after`.
2. Take the same on `main` (`git stash` or a worktree of `main`), `<page>-before`.
3. Compare the pairs and check them against the acceptance criteria of the issue and the webclient rules in `AGENTS.md`
   (colours and contrast, `filled` fields, spacing on the 8 px grid, button order of `PwrFormActions`, texts through
   `PowerLocalizer`). For an issue or PR, attach the PNGs.
4. Pages with a dialog, a menu or an edit form need a click first. The script only navigates: for such a state add a
   route, or take the screenshot by hand in the dev server (`npm --prefix pwr-webclient run start:mock`).

## Fixtures

`pwr-webclient/mock/fixtures/<service>/<METHOD>/<path>.<ext>`, e.g. `pwr-profile-service/GET/profiles/mmu.json`; a
query string goes after `~` (`usage~type=SECTOR.json`). A path segment named `_` matches any value: a
`GET/consultants/_.json` answers for every initials. The body of a request plays no part. `.empty` answers 204. The
lookup is in `pwr-webclient/mock/mockApi.js`.

**Add fixtures** for new endpoints or data by recording them from the local backend with seed data (see `README.md`,
*Sample data*): start the services, then

```shell
node .claude/skills/ui-screenshot/scripts/screenshot.mjs --mode record --port 3101 /app/mmu/<new page>
```

Every successful GET, HEAD and POST is stored (and overwrites the fixture of the same request). Small changes, such as
a field an endpoint gained, can also be edited by hand.

**The repository is public and the screenshots end up on GitHub.** Fixtures hold invented data only. Before you commit
recorded fixtures, check that no real person, customer or operating environment detail got in, e.g. a consultant of
your own in the local database: `git diff --stat pwr-webclient/mock` and a search for names you know.
