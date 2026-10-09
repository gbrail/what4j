package org.brail.what4j.core;

import org.brail.what4j.LoadContext;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;

public interface LoadableModule {
  void load(Context cx, VarScope scope, LoadContext lc) throws IOException;
}
