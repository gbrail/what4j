package org.brail.what4j.bindings.encoding;

import org.mozilla.javascript.ScriptRuntime;

public class UnsupportedDecoder extends Decoder {
  private final String name;

  public UnsupportedDecoder(String name, boolean fatal, boolean ignoreBom) {
    super(fatal, ignoreBom, false);
    this.name = name;
  }

  @Override
  protected String process(byte[] input, boolean doNotFlush) {
    throw ScriptRuntime.constructError("Error", "Unsupported encoding: " + name);
  }
}
