package org.brail.what4j.core;

import org.brail.what4j.LoadContext;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.VarScope;

import java.io.IOException;
import java.util.List;

/**
 * This module loads:
 *
 * <ul>
 *   <li>Readable streams and queuing strategies (Streams: ReadableStream,
 *       ReadableStreamDefaultReader, ReadableStreamDefaultController, CountQueuingStrategy,
 *       ByteLengthQueuingStrategy)
 * </ul>
 */
public class StreamsModule {
  public static void load(Context cx, VarScope scope, LoadContext lc) {
    try {
      Utils.loadModuleResources(
          cx, scope, lc, StreamsModule.class, List.of("core/scripts/streams.js"));
    } catch (IOException e) {
      throw new AssertionError("Error loading script: " + e, e);
    }
  }
}
