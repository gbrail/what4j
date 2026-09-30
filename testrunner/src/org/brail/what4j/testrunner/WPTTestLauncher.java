package org.brail.what4j.testrunner;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.function.BiConsumer;

import org.mozilla.javascript.Callable;
import org.mozilla.javascript.CompoundOperationMap;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.LambdaFunction;
import org.mozilla.javascript.NativeConsole;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.ScriptRuntime;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.VarScope;

public class WPTTestLauncher {
  static final String TEST_BASE = "../testcases";

  private static final String HARNESS_PREFIX = """
  function __h(self, __resultCallback, __completionTracker) {
  """;
  private static final String HARNESS_SUFFIX = """
    setup(null, {
      debug: false
    });
    add_result_callback(__resultCallback);
    add_completion_callback(__completionTracker);
    console.log("Going to call the script now");
  }; __h;
  """;

  private final StringBuilder harnessSource;
  private BiConsumer<Context, VarScope> setupCallback;

  public static WPTTestLauncher newLauncher() throws IOException {
    var s = new StringBuilder(Utils.readFile("wpt/resources/testharness.js"));
    return new WPTTestLauncher(s);
  }

  public void setSetupCallback(BiConsumer<Context, VarScope> callback) {
    this.setupCallback = callback;
  }

  public void addResource(String path) throws IOException {
    harnessSource.append(Utils.readFile("wpt/resource/" + path));
  }

  private WPTTestLauncher(StringBuilder script) {
    this.harnessSource = script;
  }

  private VarScope initializeScope(Context cx, ResultTracker tracker) throws IOException {
    var scope = cx.initSafeStandardObjects();
    //MinimalFetch.init(cx, scope);
    NativeConsole.init(scope, false, (_, _, _level, args, _stack) -> {
      if (args.length == 1) {
        System.out.println(args[0].toString());
      } else if (args.length > 1) {
        System.out.println(String.join(" ", Arrays.stream(args).map(Object::toString).toArray(String[]::new)));
      }
    });
    // Tools used by the test framework to hook into our stuff
    TestUtils.init(cx, scope);
    scope.put("__testDefer", scope, new LambdaFunction(scope, "defer", 1, WPTTestLauncher::defer));
    if (setupCallback != null) {
      setupCallback.accept(cx, scope);
    }
    return scope;
  }

  private static Object defer(Context cx, VarScope scope, Object to, Object[] args) {
    assert args.length >= 1;
    Function deferFunc = (Function) args[0];
    cx.enqueueMicrotask(
        () -> {
          deferFunc.call(cx, scope, null, ScriptRuntime.emptyArgs);
        });
    return Undefined.instance;
  }

  public ResultTracker runScript(Context cx, CharSequence script) throws IOException {
    var completeTestScript = new StringBuilder();
    completeTestScript.append(HARNESS_PREFIX);
    completeTestScript.append(harnessSource);
    completeTestScript.append(script);
    completeTestScript.append(HARNESS_SUFFIX);

    var tracker = new ResultTracker();
    // Run each test suite in a separate scope to prevent cross-contamination.
    var scope = initializeScope(cx, tracker);
    // For the harness to actually work, build the whole harness and our
    // test script into a big script and run it all together.
    try {
      var harnessResult = cx.evaluateString(scope, completeTestScript.toString(), "testharness.js", 1, null);
      if (!(harnessResult instanceof Callable c)) {
        throw ScriptRuntime.throwError(cx, scope, "Harness initialization error");
      }
      c.call(cx, scope, scope, new Object[]{scope,
              tracker.getResultCallback(scope),
              tracker.getCompletionCallback(scope)
      });
    } catch (RhinoException re) {
      tracker.trackScriptException(re);
    }
    return tracker;
  }

  /*
  public ResultTracker runFile(Context cx, String path) throws IOException {
    var tracker = new ResultTracker();
    var scope = initializeScope(cx, tracker);
    var testPath = Path.of(path);
    var script = Files.readString(testPath);
    var setBase = (Function) scope.get("__setFetchBase", scope);
    var pp = testPath.getParent();
    if (pp.getNameCount() <= 2) {
      throw new AssertionError("too short: " + pp);
    }
    HelperLoader.loadHelpers(cx, scope, script, testPath.getParent());
    setBase.call(cx, scope, null, new Object[] {testPath.getParent().toString()});
    try {
      cx.evaluateString(scope, testHarness + script, testPath.getFileName().toString(), 1, null);
    } catch (Throwable t) {
      tracker.trackException(t);
    }
    return tracker;
  }
   */

  public static Object[] findTests(String path) {
    return findTests(path, new String[] {});
  }

  public static Object[] findTests(String path, String[] exclusions) {
    var base = Path.of(TEST_BASE, path);
    ArrayList<Object> results = new ArrayList<>();
    try {
      Files.walkFileTree(
          base,
          new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path p, BasicFileAttributes attrs) {
              if (p.toFile().isFile()) {
                var name = p.toString();
                if (name.endsWith(".any.js") && !isExcluded(name, exclusions)) {
                  results.add(p.toString());
                }
              }
              return FileVisitResult.CONTINUE;
            }
          });
    } catch (IOException e) {
      throw new AssertionError(e);
    }
    return results.toArray();
  }

  private static boolean isExcluded(String name, String[] exclusions) {
    if (name.contains("idlharness")) {
      return true;
    }
    for (String ex : exclusions) {
      if (name.contains(ex)) {
        return true;
      }
    }
    return false;
  }
}
