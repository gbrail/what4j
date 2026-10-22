package org.brail.what4j.core.tests;

import org.brail.what4j.What4J;
import org.brail.what4j.core.URLModule;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

@TestBaseDir(
    value = "wpt/urlpattern",
    // Duplicate tests, or not implemented yet
    exclude = {
      "urlpattern.https.any.js",
      "urlpattern-compare.tentative.https.any.js",
      "urlpattern-compare.tentative.any.js",
      "urlpattern-compare.tentative.https.any.js",
      "urlpattern-generate.tentative.any.js",
    })
public class UrlPatternTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.setFetchBase("wpt/urlpattern");
    launcher.addSetupCallback(
        (cx, s) -> {
          var w = new What4J(cx, s);
          w.load(cx, s, "URL");
        });
  }
}
