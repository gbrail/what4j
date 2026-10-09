package org.brail.what4j.core;

import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;

public interface LoadableModule {
  void load(Context cx, VarScope scope) throws IOException;
}
