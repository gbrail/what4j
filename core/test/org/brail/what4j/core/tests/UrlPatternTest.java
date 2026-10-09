package org.brail.what4j.core.tests;

import org.brail.what4j.core.URLModule;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

@TestBaseDir("wpt/urlpattern")
public class UrlPatternTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.setFetchBase("wpt/urlpattern");
    launcher.addSetupCallback(URLModule::load);
  }
}
