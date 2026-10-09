# AGENTS.md

Guidance for AI assistants (and humans) working in this repository.

## What this project is

What4j implements WHATWG web standards (URL, and eventually more) as JavaScript
that runs on [Mozilla Rhino](https://github.com/mozilla/rhino), a JavaScript
engine written in Java. Correctness is verified by running the corresponding
tests from the [web-platform-tests](https://github.com/web-platform-tests/wpt)
suite (a git submodule at `wpt/`) inside Rhino via a JUnit 5 harness.

The project is early-stage: the URL implementation (`core/scripts/url.js`) is
currently a stub, so `//core:core_tests_UrlTest` has many failing cases. That
is expected — the work is to implement the spec (see `specs/url.bs`) until the
WPT tests pass.

## Repository layout

```
MODULE.bazel     Bzlmod module: rules_java, rules_jvm_external (maven), rhino, rules_rhino
BUILD.bazel      Root: Babel preprocessing of WPT test files, format check/fix targets
core/            The standards implementations
  src/           Java wrappers that load JS modules into a Rhino context
  scripts/       The actual JS implementations (e.g. url.js)
  test/          JUnit tests that run WPT cases against the implementations
testrunner/      Test infrastructure shared by all tests
  src/           BaseTest, WPTTestLauncher, MinimalFetch, ResultTracker, Utils
  scripts/       JS helpers (mini-fetch.js)
  test/          Smoke tests + small HTML/JS test fixtures (test/html, test/pass_tests)
  testdata/      Test data files
babel/           Babel config used to preprocess modern-syntax WPT test files
specs/           Spec sources (e.g. url.bs — the WHATWG URL spec in Bikeshed)
wpt/             git submodule: web-platform-tests (test cases, read-only reference)
```

Key concepts:

- A **module** is a JS file under `core/scripts/` that, when evaluated, returns
  a function `__loadX = function(exports) { ... }`. A Java class (e.g.
  `core/src/org/brail/what4j/core/URLModule.java`) loads it into the Rhino
  scope via `Utils.loadModuleResource`. New modules follow this same
  `<Name>Module.java` + `scripts/<name>.js` pattern and may implement the
  `LoadableModule` interface.
- A **test** is a JUnit class under `core/test/` extending
  `testrunner.BaseTest`, annotated with `@TestBaseDir("wpt/<area>")` to select
  which WPT test files to run, overriding `initializeLauncher(...)` to set a
  fetch base and register module-load callbacks. `BaseTest` parameterizes over
  every test file in the base dir and runs each in Rhino with
  `wpt/resources/testharness.js`.
- WPT test files use modern JS syntax, so they are preprocessed with Babel
  before tests run (root `BUILD.bazel`: `babel_preprocess` /
  `babel_preprocess_html`). The filegroups `wpt_js_files`, `wpt_html_files`,
  and `wpt_resources` in the root `BUILD.bazel` control which WPT files are
  available to tests. **When a new test class points at WPT files not already
  matched by these globs, add them to the globs** (and keep exclusions for
  tests that are intentionally unsupported).

## Build

Bazel 9 with Bzlmod (no WORKSPACE). Java 25, Errorprone enabled.

```sh
bazel build //...
```

`wpt/` must be a checked-out git submodule (`git submodule update --init wpt`).

Adding a Maven dependency: add the artifact to `maven.install(artifacts = [...])`
in `MODULE.bazel`, then re-pin the lockfile:

```sh
REPIN=1 bazel run @maven//:pin
```

## Test

```sh
bazel test //...                      # everything
bazel test //testrunner:smoke_test    # testrunner infrastructure smoke test
bazel test //core:core_tests_UrlTest  # WPT url/ cases against the URL implementation
bazel test //core:core_tests_CoreTest # WPT js/builtins cases
```

Notes:

- `core/BUILD.bazel` uses `java_test_suite`, so each `test/**/*Test.java`
  becomes its own target named `core_tests_<ClassName>`.
- Individual parameterized cases can be filtered, e.g.
  `bazel test //core:core_tests_UrlTest --test_filter='*url-search-params*'`.
- Test output/logs: `bazel-out/k8-fastbuild/testlogs/<package>/<target>/test.log`
  (or `bazel test --test_output=errors`).

## Formatting and checks

Java is formatted with google-java-format (AOSP-ish 2-space style as in the
existing code); Errorprone runs at build time.

```sh
bazel run //:fixformat     # reformat all Java
bazel run //:checkformat   # verify formatting (target //:checkformat)
```

Run `bazel build //...` and `bazel run //:checkformat` before considering a
change done.

## Conventions

- Java packages: `org.brail.what4j.core`, `org.brail.what4j.testrunner`.
- JS module scripts define a single `__load<Name> = function(exports) {...}`
  that assigns the public API onto `exports` (see `core/scripts/url.js`).
- Refer to the spec in `specs/` as the source of truth when implementing;
  WPT tests in `wpt/` are the acceptance criteria. Do not edit `wpt/` — it is
  an upstream submodule.
- Keep changes small and matching existing style; no new dependencies without
  updating `MODULE.bazel` + re-pinning.
