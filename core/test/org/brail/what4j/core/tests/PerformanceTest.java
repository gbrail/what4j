package org.brail.what4j.core.tests;

import org.brail.what4j.What4J;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

@TestBaseDir(
    value = "wpt/hr-time",
    suffixes = {".any.js"},
    exclude = {"idlharness.any.js"})
public class PerformanceTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.addSetupCallback(
        (cx, s) -> {
          var w = new What4J(cx, s);
          w.load(cx, s, "Performance");
        });
  }
}
