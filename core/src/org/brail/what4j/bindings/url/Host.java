package org.brail.what4j.bindings.url;

/**
 * A parsed host, mirroring the spec's host production. One of:
 *
 * <ul>
 *   <li>{@code ipv4} — {@code value} is an unsigned 32-bit address
 *   <li>{@code ipv6} — {@code pieces} is eight 16-bit integers
 *   <li>{@code domain} — {@code value} is the domain-to-ASCII string
 *   <li>{@code opaque} — {@code value} is the C0-percent-encoded string
 * </ul>
 */
public record Host(String type, Object value, int[] pieces) {}
