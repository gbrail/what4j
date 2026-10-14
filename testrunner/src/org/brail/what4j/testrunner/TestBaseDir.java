package org.brail.what4j.testrunner;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface TestBaseDir {
  String value();

  /** If non-empty, only files whose names end with one of these suffixes are used. */
  String[] suffixes() default {};

  /** Files whose name or relative path contains any of these substrings are skipped. */
  String[] exclude() default {};
}
