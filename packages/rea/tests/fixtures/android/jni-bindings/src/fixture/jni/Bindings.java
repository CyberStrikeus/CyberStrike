package fixture.jni;

/** Static declarations only: the fixture is never installed or executed. */
public final class Bindings {
  private Bindings() {}

  public static native int plain_export();
  public static native int over_load(int value);
  public static native int over_load(String[] values);
  public static native int 方法𐐀(int[] values);
  public static native int registeredData(int value);
  public static native long registeredRelro(byte[] values);
  public static native int registered_表𐐀(String value);
  public static native int ambiguous(int value);
  public static native int sharedExport();
  public static native void unmatched();
}
