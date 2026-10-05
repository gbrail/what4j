package org.brail.what4j.testrunner;

import java.io.FileReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import com.google.devtools.build.runfiles.AutoBazelRepository;
import com.google.devtools.build.runfiles.Runfiles;

@AutoBazelRepository
public class Utils {
  public static String readResource(String path) throws IOException {
    try (InputStream in = Utils.class.getClassLoader().getResourceAsStream(path)) {
      if (in == null) {
        throw new IOException("Could not find " + path);
      }
      StringBuilder buf = new StringBuilder();
      try (InputStreamReader rdr = new InputStreamReader(in, StandardCharsets.UTF_8)) {
        char[] buffer = new char[4096];
        int bytesRead;
        while ((bytesRead = rdr.read(buffer)) != -1) {
          buf.append(buffer, 0, bytesRead);
        }
      }
      return buf.toString();
    }
  }

  public static String readFile(String pathStr) throws IOException {
    // Bazel uses forward slashes for stuff...
    var p = "_main/" + pathStr;
    var bazelPath =
        Runfiles.preload().withSourceRepository(AutoBazelRepository_Utils.NAME).rlocation(p);
    if (bazelPath == null) {
      throw new IOException("Bazel runfile not found: " + p);
    }
    return readRawFilePath(bazelPath);
  }

  public static String readRawFilePath(String pathStr) throws IOException {
    try (FileReader rdr = new FileReader(pathStr, StandardCharsets.UTF_8)) {
      StringBuilder buf = new StringBuilder();
      char[] buffer = new char[4096];
      int bytesRead;
      while ((bytesRead = rdr.read(buffer)) != -1) {
        buf.append(buffer, 0, bytesRead);
      }
      return buf.toString();
    }
  }
}
