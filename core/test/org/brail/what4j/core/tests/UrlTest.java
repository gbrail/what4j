package org.brail.what4j.core.tests;

import org.brail.what4j.core.URLModule;
import org.brail.what4j.testrunner.BaseTest;
import org.brail.what4j.testrunner.TestBaseDir;
import org.brail.what4j.testrunner.WPTTestLauncher;

import java.io.IOException;

@TestBaseDir("wpt/url")
public class UrlTest extends BaseTest {
  @Override
  protected void initializeLauncher(WPTTestLauncher launcher) {
    launcher.setFetchBase("wpt/url");
    launcher.addSetupCallback(URLModule::load);
  }
}
