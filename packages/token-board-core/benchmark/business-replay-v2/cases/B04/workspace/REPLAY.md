# Historical ProfilePilot replay

This workspace contains the complete `src/` tree from a historical desktop application, its shared/renderer types, public UI assets and selected original regression tests. The historical `package.json` and lockfile are preserved as context. The replay harness builds the needed entry points directly; the original packaging scripts are not a supported way to start this evaluation.

Source repository: ProfilePilot. Base commit: `0c5a1bf3c45478f90ba85cf7de3df6bc475edd99`. Work from the supplied snapshot; this export contains no repository history or later fixes.

Use Node 22.13 or later. The evaluator preinstalls esbuild 0.27.7 and Playwright 1.56.1 with Chromium build 1194 before the timed task. No original repository checkout, parent task package or network access is needed. `ENVIRONMENT.json` identifies the disposable browser binary cache; it is a tool environment configuration, not a Chrome Profile. Do not modify it.

From this exported workspace, start and test the isolated application:

```text
node replay/smoke.mjs
```

This public smoke script builds the complete renderer entry, opens a temporary headless browser, performs an ordinary rename and prints the persisted result. It is an environment/startup check, not the complete acceptance test; it also passes on the historical baseline. Add your own reproductions under `tests/`. The `replay/` files are fixed environment support rather than application implementation.

Independent acceptance runs after submission; its scripts are outside this export and must not be accessed during the task. It uses a temporary copy and does not write candidate source. It launches a fresh headless Chromium context, runs the complete renderer entry, performs real browser input/click/submit events, and sends the rename through the actual ProfileManager implementation into real temporary JSON files. The desktop IPC transport is replaced by an in-process bridge, and operating-system process launch is disabled. App-state device observations are fixtures; the renderer, form submission, name validation, registry read/modify/write, catalog assembly and lease-file checks are actual project code.

The verifier also exercises catalog/lease operations against isolated home/data directories with real snapshot, registry and lease files. Its live-lease holder is the test's own Node process; it does not start or control Chrome through CDP.

Never run the desktop `dev`/`start` commands against the user's machine, access a real Chrome data directory, copy login data, or connect to an existing browser. This task neither needs nor authorizes those actions. This is process/data isolation for reproducibility, not an operating-system security sandbox for arbitrary candidate code.

Exit codes: 0 means required checks passed, 1 means candidate checks failed, and 2 means an unavailable or broken evaluator environment. The final stdout line is a JSON result with separately classified business, preservation and delivery checks. Missing browser binaries are an environment error, not a model failure.
