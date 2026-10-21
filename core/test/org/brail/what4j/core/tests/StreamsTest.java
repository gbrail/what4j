package org.brail.what4j.core.tests;

import org.brail.what4j.What4J;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

@TestBaseDir(
    value = "wpt/streams",
    suffixes = {".any.js"},
    exclude = {
      // Not implemented yet.
      // Needs the WebIDL test harness, which is not wired up yet.
      "idlharness.any.js",
      "crashtests/",
      "readable-byte-streams/",
      "transform-streams/",
      "transferable/",
      // Tentative spec.
      "owning-type",
      // Needs async generator support, which Babel leaves untranspiled and
      // the pinned Rhino build cannot parse.
      "async-iterator.any.js",
      "from.any.js",
      // Needs a GC trigger hook (wpt/common/gc.js).
      "garbage-collection.any.js",
      // Needs the TransformStream class, which is not implemented yet.
      "piping/pipe-through.any.js",
      "piping/throwing-options.any.js",
      "piping/transform-streams.any.js",
      // Not passable by a pure-JS implementation (see whatwg/streams#1243;
      // the standard's reference implementation excludes it too).
      "piping/general-addition.any.js",
      // One test needs readable byte streams (type: "bytes"), which are
      // not implemented yet.
      "piping/abort.any.js",
      // The tee() and pipeTo() tests that patch Promise.prototype.then
      // require promise reactions to be registered without calling the
      // (patched) then method, which a pure-JS implementation cannot do.
      "patched-global.any.js",
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
