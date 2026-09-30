package org.brail.what4j.testrunner.tests;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import org.brail.what4j.testrunner.WPTTestLauncher;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mozilla.javascript.Context;

public class SmokeTest {
  private static Context cx;
  private static WPTTestLauncher launcher;

  @BeforeAll
  public static void init() throws IOException {
    cx = Context.enter();
    launcher = WPTTestLauncher.newLauncher();
  }

  @AfterAll
  public static void cleanup() {
    Context.exit();
  }

  @Test
  public void basicTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
      test(() => {
        console.log('executing first test');
        assert_true(true);
      }, "Working test function");
      test(() => {
        console.log('executing second test');
        assert_true(true);
      }, "Working test function 2");
      done();
      """);

    assertTrue(results.success(), results.getFailureReason());
  }
/*
  @Test
  public void failingTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
                   test(() => {
                      assert_true(true);
                    }, "Working test function");
                    test(() => {
                      assert_true(false);
                    }, "Failing test function");
              """);
    assertFalse(results.success());
  }

  @Test
  public void basicPromiseTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
      promise_test(() => {
        return new Promise((resolve) => {
          resolve();
        });
      }, "Working promise test function");
      promise_test(() => {
        return new Promise((resolve) => {
          resolve();
        });
      }, "Working promise test function 2");
      """);
    assertTrue(results.success(), results.getFailureReason());
  }

  @Test
  public void failingPromiseTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
          promise_test(() => {
            return new Promise((resolve) => {
              resolve();
            });
          }, "Working promise test function");
          promise_test(() => {
            return new Promise((resolve) => {
              reject('Bad day');
            });
          }, "Failing promise test function");
          """);
    assertFalse(results.success());
  }

  @Test
  public void deferredPromiseTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
              promise_test(() => {
                return new Promise((resolve) => {
                  __testDefer(() => { resolve(); });
                });
              }, "Deferred promise");
              """);
    assertTrue(results.success(), results.getFailureReason());
    assertEquals(1, results.getResults().size());
  }

  @Test
  public void deferredPromiseFailureTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
              promise_test(() => {
                return new Promise((resolve, reject) => {
                  __testDefer(() => { reject('rejected later on'); });
                });
              }, "Deferred promise rejection");
              """);
    assertFalse(results.success());
    assertEquals(1, results.getResults().size());
  }

  @Test
  public void fetchResourceTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
                            promise_test(() => {
                              return new Promise((resolve, reject) => {
                                fetch("src/main/resources/test.json")
                                  .then((res) => res.json())
                                  .then((o) => {
                                    assert_equals(o.foo, 123);
                                    resolve();
                                  });
                              });
                            });
                            """);
    assertTrue(results.success(), results.getFailureReason());
  }

  @Test
  public void fetchRelativeResourceTest() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
                            promise_test(() => {
                              __setFetchBase('src');
                              return new Promise((resolve, reject) => {
                                fetch("main/resources/test.json")
                                  .then((res) => res.json())
                                  .then((o) => {
                                    assert_equals(o.foo, 123);
                                    resolve();
                                  });
                              });
                            });
                            """);
    assertTrue(results.success(), results.getFailureReason());
  }*/
}
