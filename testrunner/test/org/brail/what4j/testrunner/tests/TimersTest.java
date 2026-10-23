package org.brail.what4j.testrunner.tests;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import org.brail.what4j.testrunner.MinimalTimers;
import org.brail.what4j.testrunner.WPTTestLauncher;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.VarScope;

/**
 * Tests for the harness-provided setTimeout/clearTimeout (MinimalTimers), both at the timer-queue
 * level and end-to-end through the WPT test harness.
 *
 * <p>Inline scripts here run untranspiled on the pinned Rhino build, so they avoid async/await
 * syntax (the real WPT test files are Babel-transpiled before running).
 */
public class TimersTest {
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

  private static VarScope newScope() {
    return cx.initSafeStandardObjects();
  }

  private static MinimalTimers newTimers(VarScope scope) {
    var timers = new MinimalTimers();
    timers.init(scope);
    return timers;
  }

  private static void eval(VarScope scope, String script) {
    cx.evaluateString(scope, script, "test.js", 1, null);
  }

  /** Fire all pending timers, draining microtasks between firings, like WPTTestLauncher does. */
  private static void pump(MinimalTimers timers, VarScope scope) {
    while (timers.run(cx, scope)) {
      cx.processMicrotasks();
    }
  }

  private static String globalString(VarScope scope, String name) {
    return Context.toString(scope.get(name, scope));
  }

  // --- MinimalTimers unit tests ---

  @Test
  public void timerFires() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout(function() { events += 'x'; }, 5);
        """);
    pump(timers, scope);
    assertEquals("x", globalString(scope, "events"));
  }

  @Test
  public void firesInDeadlineOrder() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout(function() { events += 'b'; }, 30);
        setTimeout(function() { events += 'a'; }, 10);
        """);
    pump(timers, scope);
    assertEquals("ab", globalString(scope, "events"));
  }

  @Test
  public void clearTimeoutCancels() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        var id = setTimeout(function() { events += 'x'; }, 10);
        clearTimeout(id);
        """);
    pump(timers, scope);
    assertEquals("", globalString(scope, "events"));
  }

  @Test
  public void clearTimeoutWithoutIdIsNoop() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        clearTimeout();
        clearTimeout(999);
        setTimeout(function() { events += 'x'; }, 5);
        """);
    pump(timers, scope);
    assertEquals("x", globalString(scope, "events"));
  }

  @Test
  public void idsStartAtOne() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var first = setTimeout(function() {}, 10);
        var second = setTimeout(function() {}, 20);
        """);
    assertEquals(1, (int) Context.toNumber(scope.get("first", scope)));
    assertEquals(2, (int) Context.toNumber(scope.get("second", scope)));
  }

  @Test
  public void clearTimeoutUndefinedLeavesFirstTimer() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        var id = setTimeout(function() { events += 'x'; }, 10);
        clearTimeout(undefined);
        """);
    pump(timers, scope);
    assertEquals("x", globalString(scope, "events"));
  }

  @Test
  public void extraArgsArePassed() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout(function(a, b) { events += a + '-' + b; }, 5, 42, 'x');
        """);
    pump(timers, scope);
    assertEquals("42-x", globalString(scope, "events"));
  }

  @Test
  public void missingDelayMeansZero() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout(function() { events += 'z'; });
        """);
    pump(timers, scope);
    assertEquals("z", globalString(scope, "events"));
  }

  @Test
  public void chainedTimers() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout(function() {
          events += '1';
          setTimeout(function() { events += '2'; }, 5);
        }, 5);
        """);
    pump(timers, scope);
    assertEquals("12", globalString(scope, "events"));
  }

  @Test
  public void timerScheduledFromMicrotask() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        Promise.resolve().then(function() {
          setTimeout(function() { events += 'm'; }, 0);
        });
        """);
    cx.processMicrotasks();
    pump(timers, scope);
    assertEquals("m", globalString(scope, "events"));
  }

  @Test
  public void callbackThisIsGlobalObject() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout(function() {
          'use strict';
          events += (this === globalThis) ? 'strict-global' : 'strict-other';
        }, 5);
        setTimeout(function() {
          events += (this === globalThis) ? 'loose-global' : 'loose-other';
        }, 10);
        """);
    pump(timers, scope);
    assertEquals("strict-globalloose-global", globalString(scope, "events"));
  }

  @Test
  public void stringHandlerIsCompiledOnFire() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        var events = '';
        setTimeout("events += 's';", 5);
        """);
    pump(timers, scope);
    assertEquals("s", globalString(scope, "events"));
  }

  @Test
  public void timerCallbackExceptionPropagates() {
    var scope = newScope();
    var timers = newTimers(scope);
    eval(
        scope,
        """
        setTimeout(function() { throw new Error('boom'); }, 5);
        """);
    assertThrows(RhinoException.class, () -> pump(timers, scope));
  }

  // --- End-to-end tests through the WPT test harness ---

  @Test
  public void harnessPromiseTestWithRealTimer() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
      promise_test(function() {
        const start = Date.now();
        return new Promise(resolve => setTimeout(resolve, 50)).then(() => {
          assert_true(Date.now() - start >= 40, "timer waited real time");
        });
      }, "promise test awaits a real timer");
      """);
    assertTrue(results.success(), results.getFailureReason());
    assertEquals(1, results.getResults().size());
  }

  @Test
  public void harnessStepTimeoutDone() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
      async_test(function() {
        this.step_timeout(function() {
          assert_true(true);
          this.done();
        }, 50);
      }, "step_timeout completes the test");
      """);
    assertTrue(results.success(), results.getFailureReason());
  }

  @Test
  public void harnessFirstTimerSurvivesSynchronousTestCompletion() throws IOException {
    // Regression test: testharness.js calls clearTimeout(null) when a test without a
    // "timeout" property completes. null converts to ID 0, so that must not cancel the
    // first real timer the file registers.
    var results =
        launcher.runScript(
            cx,
            """
      test(() => {
        assert_true(true);
      }, "synchronous test completes first");
      promise_test(function() {
        return new Promise(resolve => setTimeout(resolve, 30)).then(() => {
          assert_true(true);
        });
      }, "first timer survives");
      """);
    assertTrue(results.success(), results.getFailureReason());
  }

  @Test
  public void harnessClearTimeout() throws IOException {
    var results =
        launcher.runScript(
            cx,
            """
      promise_test(function() {
        let fired = false;
        const id = setTimeout(function() { fired = true; }, 150);
        return new Promise(resolve => setTimeout(resolve, 20))
          .then(() => {
            clearTimeout(id);
          })
          .then(() => new Promise(resolve => setTimeout(resolve, 200)))
          .then(() => {
            assert_false(fired);
          });
      }, "clearTimeout prevents the callback");
      """);
    assertTrue(results.success(), results.getFailureReason());
  }

  @Test
  public void harnessAbandonsUnwaitedTimers() throws IOException {
    var start = System.currentTimeMillis();
    var results =
        launcher.runScript(
            cx,
            """
      promise_test(function() {
        setTimeout(function() {}, 500);
        return Promise.resolve();
      }, "completes without waiting for background timer");
      """);
    var elapsed = System.currentTimeMillis() - start;
    assertTrue(results.success(), results.getFailureReason());
    assertTrue(elapsed < 400, "should not wait out the un-awaited timer: " + elapsed + "ms");
  }
}
