package fixture.jni;

/** A table's name/prototype cannot distinguish this class from Bindings. */
public final class Twin {
  private Twin() {}

  public static native int ambiguous(int value);
}
