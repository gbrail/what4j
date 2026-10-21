# AGENTS.md

Guidance for AI assistants (and humans) working in this repository.

## What this project is

What4j implements WHATWG web standards (URL, URLPattern, a partial Encoding
API, a minimal Performance object per High Resolution Time, readable
streams, and eventually more) as JavaScript that runs on [Mozilla
Rhino](https://github.com/mozilla/rhino), a JavaScript engine written in Java.
Correctness is verified by running the corresponding tests from the
[web-platform-tests](https://github.com/web-platform-tests/wpt) suite (a git
submodule at `wpt/`) inside Rhino via a JUnit 5 harness.

The URL standard is implemented in `core/scripts/url.js` as pure JavaScript
(see "JavaScript dialect" below), with its self-contained string/byte
algorithms (percent-encoding, host parsing/serialization, urlencoded
parse/serialize, `toUSVString`) in the `url` Java binding. Other non-pure-JS
parts are exposed as Java bindings too: IDNA uses ICU4J via the `ICU`
binding, UTF-8 encoding/decoding for URL and the Encoding API uses the
`Encoding` binding, and the High Resolution Time clock (a `System.nanoTime`
monotonic clock coarsened to the spec-mandated 100 microsecond resolution)
uses the `performance` binding. JS modules obtain bindings with
`getBinding("<name>")`.

WPT coverage note: selected `wpt/url/*.any.js`, `wpt/urlpattern/*.any.js`,
`wpt/encoding/*.any.js`, `wpt/hr-time/*.any.js`, and non-byte
`wpt/streams` readable-stream files run today (the root `BUILD.bazel`
filegroups and each test class's `@TestBaseDir` annotations select what is
available). HTML and `.window.js` tests (which need a DOM) and
`idlharness.any.js` (needs the WebIDL test harness) are intentionally
excluded for now. Legacy single-byte/multi-byte encodings,
`TextEncoder.prototype.encodeInto`, and encoding streams are also excluded
for now. The rest of the Performance Timeline API (User Timing entries,
`PerformanceObserver`) is not implemented. For streams, readable byte
streams, writable streams, transform streams, and piping are not implemented
yet, and the readable-streams tests that need async generator syntax (which
the current Babel setup leaves untranspiled and Rhino cannot parse), GC
hooks, or pipeTo/pipeThrough are excluded (see the comments in the root
`BUILD.bazel` filegroup and in `StreamsTest`).

## Repository layout

```
MODULE.bazel     Bzlmod module: rules_java, rules_jvm_external (maven), rhino, rules_rhino
BUILD.bazel      Root: Babel preprocessing of WPT test files, format check/fix targets
core/            The standards implementations
  src/           Java wrappers that load JS modules into a Rhino context
  scripts/       The actual JS implementations (e.g. url.js)
  test/          JUnit tests that run WPT cases against the implementations
bench/           JS<->Java boundary microbenchmark (bazel run //bench:boundary_bench)
testrunner/      Test infrastructure shared by all tests
  src/           BaseTest, WPTTestLauncher, MinimalFetch, ResultTracker, Utils
  scripts/       JS helpers (mini-fetch.js, platform-shims.js)
  test/          Smoke tests + small HTML/JS test fixtures (test/html, test/pass_tests)
  testdata/      Test data files
babel/           Babel config used to preprocess modern-syntax WPT test files
specs/           Spec sources (e.g. url.bs, urlpattern.bs, encoding.bs, and streams.bs in Bikeshed)
wpt/             git submodule: web-platform-tests (test cases, read-only reference)
```

Key concepts:

- A **module** is one or more JS files under `core/scripts/` evaluated in a
  shared local scope that has `exports` and `getBinding`. String properties
  assigned to `exports` are copied onto the global scope. A Java class (e.g.
  `core/src/org/brail/what4j/core/URLModule.java` or `EncodingModule.java`)
  loads the files via `Utils.loadModuleResources`. New modules follow the
  `<Name>Module.java` + `scripts/<name>.js` pattern and may implement the
  `LoadableModule` interface.
- A **Java binding** is a Java object registered in `BindingsLoader` for
  functionality that must live on the JVM (see `ICU` for ICU4J-based IDNA,
  `Encoding` for UTF-8/UTF-16 codecs, and `Url` for the URL standard's
  percent-encoding, host, and urlencoded algorithms, implemented in
  `bindings/url/`). JS module code obtains it with `getBinding("<name>")` and
  calls it like any global object.
- A **test** is a JUnit class under `core/test/` extending
  `testrunner.BaseTest`, annotated with `@TestBaseDir("wpt/<area>")` to select
  which WPT test files to run, overriding `initializeLauncher(...)` to set a
  fetch base and register module-load callbacks. `BaseTest` parameterizes over
  every test file in the base dir and runs each in Rhino with
  `wpt/resources/testharness.js`. `@TestBaseDir` also supports optional
  `suffixes` and `exclude` attributes for selecting subsets of a directory.
- WPT test files use modern JS syntax, so they are preprocessed with Babel
  before tests run (root `BUILD.bazel`: `babel_preprocess` /
  `babel_preprocess_html`). The filegroups `wpt_js_files`, `wpt_html_files`,
  and `wpt_resources` in the root `BUILD.bazel` control which WPT files are
  available to tests. **When a new test class points at WPT files not already
  matched by these globs, add them to the globs** (and keep exclusions for
  tests that are intentionally unsupported).

## JavaScript dialect (Rhino)

Module scripts under `core/scripts/` run **untranspiled** on the pinned
`rhino` master build. WPT test files are Babel-transpiled before running, so
*test* code may use modern syntax — *module* code may not go beyond what
Rhino actually supports. Verified against the pinned commit:

- Supported: function declarations/expressions, arrow functions, template
  literals, default arguments, destructuring, `for-of`, array spread,
  optional chaining, `let`/`const`, `Map`/`Set`/`Promise`/`Proxy`/`Symbol`,
  `Object.defineProperty` (getters/setters), `JSON`, `Array.from`/`flat`,
  `Number.isInteger`, `Object.entries`, `String.prototype` `includes`/
  `startsWith`/`padStart`/`trimStart`/`normalize`, Unicode regex (`/\p{L}/u`,
  lookbehind), `globalThis`.
- **Not supported: `class`, `async`/`await`, generators, argument spread
  (`f(...args)`; array/object/string spread are fine).**
- Java interop: the `Packages`/`java` globals are NOT available (the context
  uses `initSafeStandardObjects`). To call Java, add a bridge object on the
  scope from Java (see the Java bridge concept above).
- Not available: DOM, `atob`/`btoa`, `setTimeout`/`queueMicrotask`, `fetch`
  (the testrunner installs a minimal one), `structuredClone`/`DOMException`/
  `FormData` (the testrunner installs minimal shims in
  `testrunner/scripts/platform-shims.js` — extend that file if a WPT test
  needs another platform object). `TextEncoder`/`TextDecoder` are available
  from the Encoding module, but only the subset implemented by
  `core/scripts/encoding.js` and the Java `Encoding` binding.
- `let`/`const` have correct block scoping on the pinned build and are
  preferred over `var` in module code (they are measurably faster); use
  `const` unless the binding is reassigned.

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
bazel test //core:core_tests_EncodingTest # WPT encoding/ cases against the Encoding API
bazel test //core:core_tests_StreamsTest # WPT streams/ readable-stream cases
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
- JS module scripts assign their public API onto `exports` (see
  `core/scripts/url.js` and `core/scripts/encoding.js`).
- Refer to the spec in `specs/` as the source of truth when implementing;
  WPT tests in `wpt/` are the acceptance criteria. Do not edit `wpt/` — it is
  an upstream submodule.
- Unicode/IDNA work belongs in the Java bridge (`IdnaBridge`, ICU4J), not in
  JS. The WPT IDNA vectors (`wpt/url/resources/IdnaTestV2*.json`) are
  generated for a specific Unicode release — keep the ICU4J version in
  `MODULE.bazel` at or above the data version the vectors use (Unicode 17.0
  requires icu4j >= 78.1).
- Keep changes small and matching existing style; no new dependencies without
  updating `MODULE.bazel` + re-pinning.
