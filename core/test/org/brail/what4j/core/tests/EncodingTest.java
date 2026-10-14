package org.brail.what4j.core.tests;

import org.brail.what4j.What4J;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

@TestBaseDir(
    value = "wpt/encoding",
    suffixes = {".any.js"},
    exclude = {
      "streams/",
      "idlharness.any.js",
      "single-byte-decoder.any.js",
      "replacement-encodings.any.js",
      "unsupported-encodings.any.js",
      "textdecoder-streaming.any.js",
      "textdecoder-copy.any.js",
      "encodeInto.any.js",
      "textdecoder-eof.any.js",
      "textdecoder-fatal-single-byte.any.js",
      "textdecoder-mistakes.any.js",
      "iso-2022-jp-decoder.any.js",
      "textdecoder-arguments.any.js",
    })
public class EncodingTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.setFetchBase("wpt/encoding");
    launcher.addSetupCallback(
        (cx, s) -> {
          var w = new What4J(cx, s);
          w.load(cx, s, "Encoding");
        });
  }
}
