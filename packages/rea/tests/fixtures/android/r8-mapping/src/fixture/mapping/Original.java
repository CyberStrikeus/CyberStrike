package fixture.mapping;

/** Source-owned identities for a real R8 mapping, never executed by verification. */
public final class Original {
  public int count;
  public String title;
  public int[] samples;
  public Nested nested;

  public Original() {
    count = 7;
    title = "mapping-fixture";
    samples = new int[] { 1, 2 };
    nested = new Nested(this);
  }

  public int choose(int value) { return value + count; }
  public String choose(String value) { return value; }
  public Nested choose(Nested value) { return value; }
  public Nested[] choose(Nested[] value) { return value; }
  public long 計算(long value) { return value + count; }

  public static final class Nested {
    public Original owner;
    public byte[] payload;

    public Nested(Original value) {
      owner = value;
      payload = new byte[] { 3, 4 };
    }

    public Original echo(Original value) { return value; }
  }
}
