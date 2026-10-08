package org.brail.what4j.testrunner;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ArgumentsSource;
import org.mozilla.javascript.Context;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.fail;

public abstract class BaseTest {
  private static WPTTestLauncher launcher;
  private Context cx;

  @BeforeAll
  public static void initLauncher() throws IOException {
    launcher = WPTTestLauncher.newLauncher();
  }

  @BeforeEach
  public void initContext() {
    cx = Context.enter();
  }

  @AfterEach
  public void closeContext() {
    Context.exit();
  }

  @ParameterizedTest(name = "{0}")
  @ArgumentsSource(TestFileArgumentsProvider.class)
  public void testCase(String name, String sourceFile) throws IOException {
    var sourcePath = Utils.findPath(sourceFile);
    var src = Utils.readRawFilePath(sourcePath);
    ResultTracker tracker;
    if (sourceFile.endsWith(".html")) {
      tracker = launcher.runHtml(cx, sourcePath, src);
    } else {
      tracker = launcher.runScript(cx, src);
    }
    if (tracker.success()) {
      System.out.println("PASS: " + name);
    } else {
      System.out.println("FAIL: " + name);
      fail(tracker.getFailureReason());
    }
  }
}
