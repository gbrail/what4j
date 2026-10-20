package org.brail.what4j.core.tests;

import org.brail.what4j.What4J;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

@TestBaseDir(
    value = "wpt/streams",
    suffixes = {".any.js"},
    exclude = {
      // Phase 1 of streams covers readable streams only.
      // Needs the WebIDL test harness, which is not wired up yet.
      "idlharness.any.js",
      "crashtests/",
      "readable-byte-streams/",
      "writable-streams/",
      "transform-streams/",
      "piping/",
      "transferable/",
      // Tentative spec.
      "owning-type",
      // Needs async generator support, which Babel leaves untranspiled and
      // the pinned Rhino build cannot parse.
      "async-iterator.any.js",
      "from.any.js",
      // Needs a GC trigger hook (wpt/common/gc.js).
      "garbage-collection.any.js",
      // Needs pipeTo/pipeThrough (WritableStream), which is not implemented
      // yet.
      "patched-global.any.js",
      "reentrant-strategies.any.js",
      "templated.any.js",
    })
public class StreamsTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.addSetupCallback(
        (cx, s) -> {
          var w = new What4J(cx, s);
          w.load(cx, s, "Streams");
        });
  }
}
