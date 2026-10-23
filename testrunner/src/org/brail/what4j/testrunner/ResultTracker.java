package org.brail.what4j.testrunner;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

public class ResultTracker {
  private final ArrayList<Result> results = new ArrayList<>();
  private String finalMessage;
  private FinalStatus finalStatus = FinalStatus.NONE;

  /**
   * Return a function that can be passed to add_result_callback in the test harness. The function
   * takes an argument of the "Test" class from the harness and extracts the test result from that.
   */
  public Function getResultCallback(VarScope scope) {
    return new LambdaFunction(
        scope,
        "resultCallback",
        1,
        (Context cx, VarScope s, Object to, Object[] args) -> {
          assert args.length >= 1;
          var result = new Result(cx, (Scriptable) args[0]);
          results.add(result);
          return Undefined.instance;
        });
  }

  /**
   * Return a function that can be passed to add_completion_callback in the test harness. The first
   * argument is an array of Test objects and the second is a TestsStatus object that we parse to
   * see if the harness worked.
   */
  public Function getCompletionCallback(VarScope scope) {
    return new LambdaFunction(
        scope,
        "completionCallback",
        2,
        (Context cx, VarScope s, Object to, Object[] args) -> {
          assert args.length >= 2;
          if (finalStatus != FinalStatus.EXCEPTION) {
            Scriptable ts = (Scriptable) args[1];
            finalStatus = toFinalStatus(getInt(ts, "status"));
            finalMessage = getString(ts, "message");
          }
          return Undefined.instance;
        });
  }

  public List<Result> getResults() {
    return results;
  }

  public FinalStatus getFinalStatus() {
    return finalStatus;
  }

  public String getFinalMessage() {
    return finalMessage;
  }

  public void trackException(Throwable t) {
    finalStatus = FinalStatus.EXCEPTION;
    var sw = new StringWriter();
    var pw = new PrintWriter(sw);
    t.printStackTrace(pw);
    finalMessage = t.toString() + sw.toString();
  }

  public void trackScriptException(RhinoException re) {
    finalStatus = FinalStatus.EXCEPTION;
    finalMessage = re + "\n" + re.getScriptStackTrace();
  }

  /** Generate a description of the test results. This may be used in a JUnit assertion. */
  public Supplier<String> getFailureReason() {
    return () -> {
      var b = new StringBuilder();
      b.append("finalStatus = ");
      b.append(finalStatus);
      b.append(": ");
      b.append(finalMessage);
      b.append('\n');
      for (var r : results) {
        b.append(r).append('\n');
      }
      return b.toString();
    };
  }

  /**
   * Return true once the harness has reported a final status, or a script exception was tracked.
   * Any pending timers are irrelevant after this point.
   */
  public boolean isComplete() {
    return finalStatus != FinalStatus.NONE;
  }

  /** Return true only if harness ran successfully and all tests passed. */
  public boolean success() {
    if (finalStatus != FinalStatus.OK && finalStatus != FinalStatus.NONE) {
      return false;
    }
    return results.stream().allMatch(r -> r.status == Status.PASS);
  }

  private static String getString(Scriptable o, String name) {
    Object val = o.get(name, o);
    return (val == Scriptable.NOT_FOUND || val == null) ? "" : Context.toString(val);
  }

  private static int getInt(Scriptable o, String name) {
    Object val = o.get(name, o);
    if (val == Scriptable.NOT_FOUND || val == null) {
      return 0;
    }
    return (int) Context.toNumber(val);
  }

  private static Status toStatus(int i) {
    return switch (i) {
      case 0 -> Status.PASS;
      case 1 -> Status.FAIL;
      case 2 -> Status.TIMEOUT;
      case 3 -> Status.NOTRUN;
      case 4 -> Status.PRECONDITION_FAILED;
      default -> throw new IllegalArgumentException("Unknown result status: " + i);
    };
  }

  private static FinalStatus toFinalStatus(int i) {
    return switch (i) {
      case 0 -> FinalStatus.OK;
      case 1 -> FinalStatus.ERROR;
      case 2 -> FinalStatus.TIMEOUT;
      case 3 -> FinalStatus.PRECONDITION_FAILED;
      default -> throw new IllegalArgumentException("Unknown final status: " + i);
    };
  }

  public enum FinalStatus {
    NONE,
    OK,
    ERROR,
    TIMEOUT,
    PRECONDITION_FAILED,
    EXCEPTION,
  }

  public enum Status {
    PASS,
    FAIL,
    TIMEOUT,
    NOTRUN,
    PRECONDITION_FAILED,
  }

  public static class Result {
    final String name;
    final int phase;
    final Status status;
    final String message;
    final String stack;

    public Result(Context cx, Scriptable o) {
      name = getString(o, "name");
      phase = getInt(o, "phase");
      status = toStatus(getInt(o, "status"));
      message = getString(o, "message");
      stack = getString(o, "stack");
    }

    @Override
    public String toString() {
      var b = new StringBuilder();
      b.append(name).append(": ").append(status);
      if (!message.isEmpty()) {
        b.append(" (").append(message).append(')');
      }
      return b.toString();
    }
  }
}
