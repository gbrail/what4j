package org.brail.what4j.core.tests;

import org.brail.what4j.What4J;
import org.brail.what4j.core.URLModule;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

import java.io.IOException;

@TestBaseDir(
    value = "wpt/url",
    // Needs the Fetch `Request` and `Response` classes, which are not
    // implemented yet.
    exclude = {
      // Not implemented yet.
      // Needs the WebIDL test harness, which is not wired up yet.
      "idlharness.any.js",
      "urlencoded-parser.any.js"
    })
public class UrlTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.setFetchBase("wpt/url");
    launcher.addSetupCallback(
        (cx, s) -> {
          var w = new What4J(cx, s);
          w.load(cx, s, "URL");
        });
  }
}
