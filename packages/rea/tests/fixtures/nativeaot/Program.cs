using System.Runtime.CompilerServices;

interface IProbe { int Compute(int value); }

class BaseProbe
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public virtual int Compute(int value) => value * 7 + 3;
    public override string ToString() => "REA_NATIVEAOT_BASE";
}

sealed class DerivedProbe : BaseProbe, IProbe
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public override int Compute(int value) => value * 11 + 5;
    public override string ToString() => "REA_NATIVEAOT_DERIVED";
}

static class Program
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Dispatch(BaseProbe value, int input) => value.Compute(input);

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int DispatchInterface(IProbe value, int input) => value.Compute(input);

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int Consume(string value) => value.Length;

    static int Main(string[] args)
    {
        BaseProbe[] probes = { new BaseProbe(), new DerivedProbe() };
        int result = Dispatch(probes[args.Length % probes.Length], args.Length);
        result += DispatchInterface(new DerivedProbe(), args.Length);
        result += Consume("REA_NATIVEAOT_FROZEN");
        result += Consume(probes[args.Length % probes.Length].ToString());
        return result;
    }
}
