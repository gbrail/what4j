package org.brail.what4j.testrunner;

import com.google.devtools.build.runfiles.AutoBazelRepository;
import com.google.devtools.build.runfiles.Runfiles;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.ArgumentsProvider;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.stream.Stream;

@AutoBazelRepository
public class TestFileArgumentsProvider implements ArgumentsProvider {

  @Override
  public Stream<? extends Arguments> provideArguments(ExtensionContext context) throws Exception {
    Class<?> testClass = context.getRequiredTestClass();
    TestBaseDir annotation = testClass.getAnnotation(TestBaseDir.class);
    if (annotation == null) {
      throw new IllegalStateException(
          "Test class " + testClass.getName() + " must be annotated with @TestBaseDir");
    }

    String pathStr = annotation.value();
    Path baseDir = Path.of(pathStr);

    if (!Files.exists(baseDir)) {
      // Use Bazel runfiles library to find it
      try {
        String rlocation =
            Runfiles.preload()
                .withSourceRepository(AutoBazelRepository_TestFileArgumentsProvider.NAME)
                .rlocation("_main/" + pathStr);
        if (rlocation != null) {
          baseDir = Path.of(rlocation);
        }
      } catch (IOException ignored) {
      }
    }

    if (!Files.exists(baseDir)) {
      throw new IllegalArgumentException("Test base directory does not exist: " + pathStr);
    }

    var files = new ArrayList<Arguments>();
    var searchBaseDir = baseDir;
    Files.walkFileTree(
        baseDir,
        new SimpleFileVisitor<>() {
          @Override
          public FileVisitResult visitFile(Path p, BasicFileAttributes attrs) {
            var fileName = p.getFileName().toString();
            boolean inResources = false;
            for (var name : searchBaseDir.relativize(p)) {
              if ("resources".equals(name.toString())) {
                inResources = true;
                break;
              }
            }
            var relPath = searchBaseDir.relativize(p);
            var relPathStr = relPath.toString();
            if (!inResources && p.toFile().isFile() && matches(annotation, fileName, relPathStr)) {
              files.add(Arguments.of(fileName, pathStr + "/" + relPath));
            }
            return FileVisitResult.CONTINUE;
          }
        });

    return files.stream();
  }

  private boolean matches(TestBaseDir annotation, String fileName, String relPathStr) {
    var suffixes = annotation.suffixes();
    if (suffixes.length > 0) {
      var matched = false;
      for (var suffix : suffixes) {
        if (fileName.endsWith(suffix)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return false;
      }
    } else if (!(fileName.endsWith(".html")
        || fileName.endsWith(".htm")
        || fileName.endsWith(".js"))) {
      return false;
    }
    for (var exclusion : annotation.exclude()) {
      if (exclusion.isEmpty()) {
        continue;
      }
      var excluded =
          exclusion.endsWith("/") || exclusion.contains("*")
              ? fileName.contains(exclusion) || relPathStr.contains(exclusion)
              : fileName.equals(exclusion) || relPathStr.equals(exclusion);
      if (excluded) {
        return false;
      }
    }
    return true;
  }
}
