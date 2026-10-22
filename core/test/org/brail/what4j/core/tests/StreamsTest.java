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
      "readable-byte-streams/",
      "transferable/",
      // Tentative spec.
      "owning-type",
      // Needs async generator support, which Babel leaves untranspiled and
      // the pinned Rhino build cannot parse.
      "async-iterator.any.js",
      "from.any.js",
      // One test needs readable byte streams (type: "bytes"), which are
      // not implemented yet.
      "readable-streams/crashtests/garbage-collection.any.js",
      // Asserts that pipeTo() defers the write algorithm by at least a
      // microtask, which the current spec does not require (see
      // whatwg/streams#1243). A spec-faithful transcription calls
      // write() synchronously from enqueue(), so it fails; the
      // standard's own reference implementation excludes it too.
      "piping/general-addition.any.js",
      // One test needs readable byte streams (type: "bytes"), which are
      // not implemented yet.
      "piping/abort.any.js",
      // The tee() and pipeTo() subtests that patch
      // Promise.prototype.then require internal promise chaining to
      // bypass the JS-visible then method. The standard's reference
      // implementation does this in pure JS by capturing the original
      // Promise machinery at module load; our streams.js still chains
      // via direct .then lookups, so it would throw.
      "readable-streams/patched-global.any.js",
      // Tentative specs not supported yet
      "owning-type-message-port.tentative.any.js",
      "owning-type.tentative.any.js",
      "owning-type-video-frame.tentative.any.js",
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
