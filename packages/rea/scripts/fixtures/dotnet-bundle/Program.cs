using System.Runtime.InteropServices;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.NET.HostModel.AppHost;
using Microsoft.NET.HostModel.Bundle;

// Trusted fixture generator only. Generated hosts are inspected, never executed.
if (args.Length is < 2 or > 3)
    throw new ArgumentException("Expected apphost template, absent output directory, and optional windows/linux/osx target");
var targetOS = (args.ElementAtOrDefault(2) ?? "windows") switch
{
    "windows" => OSPlatform.Windows,
    "linux" => OSPlatform.Linux,
    "osx" => OSPlatform.OSX,
    _ => throw new ArgumentException("Target OS must be windows, linux or osx"),
};
var hostName = targetOS == OSPlatform.Windows ? "Probe.exe" : "Probe";
var template = Path.GetFullPath(args[0]);
var output = Path.GetFullPath(args[1]);
if (Directory.Exists(output)) throw new IOException("Output directory must be absent");
Directory.CreateDirectory(output);
var assembly = typeof(Program).Assembly.Location;
var resource = Path.Combine(output, "resource.txt");
File.WriteAllText(resource, string.Concat(Enumerable.Repeat("owned compressed fixture content\n", 4096)));
foreach (var (version, compress) in new[] { (new Version(3, 1), false), (new Version(5, 0), false), (new Version(8, 0), false), (new Version(8, 0), true) })
{
    var label = $"net{version.Major}-{(compress ? "compressed" : "plain")}";
    var directory = Path.Combine(output, label);
    Directory.CreateDirectory(directory);
    var host = Path.Combine(directory, targetOS == OSPlatform.Windows ? "template.exe" : "template");
    HostWriter.CreateAppHost(template, host, "BundleFixture.dll");
    var bundler = new Bundler(hostName, directory,
        BundleOptions.BundleOtherFiles | (compress ? BundleOptions.EnableCompression : BundleOptions.None),
        targetOS, Architecture.X64, version, appAssemblyName: "BundleFixture");
    var inputs = new Dictionary<string, string>
    {
        ["BundleFixture.dll"] = assembly,
        ["BundleFixture.deps.json"] = Path.ChangeExtension(assembly, ".deps.json"),
        ["BundleFixture.runtimeconfig.json"] = Path.ChangeExtension(assembly, ".runtimeconfig.json"),
        ["data/resource.txt"] = resource,
    };
    var generated = bundler.GenerateBundle(new[] {
        new FileSpec(host, hostName),
        new FileSpec(assembly, "BundleFixture.dll"),
        new FileSpec(Path.ChangeExtension(assembly, ".deps.json"), "BundleFixture.deps.json"),
        new FileSpec(Path.ChangeExtension(assembly, ".runtimeconfig.json"), "BundleFixture.runtimeconfig.json"),
        new FileSpec(resource, "data/resource.txt"),
    });
    File.WriteAllText(Path.Combine(directory, "oracle.json"), JsonSerializer.Serialize(Observe(generated, inputs), new JsonSerializerOptions { WriteIndented = true }));
    Console.WriteLine(generated);
}

// Independent positive-fixture oracle: .NET's BinaryReader owns its string/number framing.
static object Observe(string path, Dictionary<string, string> inputs)
{
    var bytes = File.ReadAllBytes(path);
    var signature = Convert.FromHexString("8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae");
    var marker = bytes.AsSpan().IndexOf(signature);
    if (marker < 8) throw new InvalidDataException("Generated host has no bundle marker");
    var header = BinaryPrimitives.ReadInt64LittleEndian(bytes.AsSpan(marker - 8, 8));
    using var stream = new MemoryStream(bytes);
    stream.Position = header;
    using var reader = new BinaryReader(stream);
    var major = reader.ReadUInt32();
    var minor = reader.ReadUInt32();
    var count = reader.ReadInt32();
    var bundleId = reader.ReadString();
    if (major >= 2) stream.Position += 40;
    var rows = new List<object>();
    var found = new HashSet<string>();
    for (var index = 0; index < count; index++)
    {
        var offset = reader.ReadInt64();
        var size = reader.ReadInt64();
        var compressed = major == 6 ? reader.ReadInt64() : 0;
        var kind = reader.ReadByte();
        var name = reader.ReadString();
        if (!inputs.TryGetValue(name, out var input) || !found.Add(name))
            throw new InvalidDataException("Unexpected generated member: " + name);
        using var stored = new MemoryStream(bytes, checked((int)offset), checked((int)(compressed == 0 ? size : compressed)));
        using var expanded = compressed == 0 ? null : new DeflateStream(stored, CompressionMode.Decompress);
        var digest = Convert.ToHexString(SHA256.HashData((Stream)expanded ?? stored)).ToLowerInvariant();
        var expected = File.ReadAllBytes(input);
        if (expected.LongLength != size || digest != Convert.ToHexString(SHA256.HashData(expected)).ToLowerInvariant())
            throw new InvalidDataException("Generated member bytes differ: " + name);
        rows.Add(new { name, offset, size, compressed_size = compressed, file_type = kind, sha256 = digest });
    }
    if (!found.SetEquals(inputs.Keys)) throw new InvalidDataException("Generated bundle omitted an input");
    return new { source = "Microsoft.NET.HostModel + independent BinaryReader/DeflateStream", host = path, major, minor, header_offset = header, bundle_id = bundleId, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), files = rows };
}
