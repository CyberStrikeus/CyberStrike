import fixture.mapping.Original;

/** A real default-package original, independent of JADX's display package aliases. */
public final class DefaultPackage {
  public Original original;

  public DefaultPackage() { original = new Original(); }
  public int run(int value) { return original.choose(value); }
  public String run(String value) { return original.choose(value); }
  public Original.Nested link(Original.Nested value) { return value; }
}
