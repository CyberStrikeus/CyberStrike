"""JDK-only TCP transport regression using the production admission methods.

Run: python3 tests/fixtures/ghidraHandshakeProbe.py /path/to/java
Ghidra request parsing/dispatch are fixture seams; no engine is required.
"""
import pathlib
import subprocess
import sys
import tempfile

root = pathlib.Path(__file__).resolve().parents[2]
bridge = (root / "bridge/ghidra/ReaGhidraBridge.java").read_text()
start = bridge.index("    private static String readLoopbackHandshake(")
end = bridge.index("    private void acceptClient(", start)
methods = bridge[start:end]
harness = r'''
import java.io.*;
import java.net.*;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public class ReaHandshakeProbe {
    record SessionDescriptor(String token) {}
    record Request(String method) {}
    private Request parseRequest(String line, String token) {
        if (!line.equals(token + ":ping")) throw new IllegalArgumentException();
        return new Request("ping");
    }
    private void serveClient(SessionDescriptor descriptor, BufferedReader reader,
            BufferedWriter writer, Request first) throws Exception {
        if (!first.method().equals("ping")) throw new AssertionError("first request lost");
        String next = reader.readLine();
        if (next == null || next.length() != 200_000)
            throw new AssertionError("pipelined authenticated request lost or capped");
        writer.write("accepted\n");
        writer.flush();
    }
    static Socket connect(int port) throws Exception {
        Socket peer = new Socket("127.0.0.1", port);
        peer.setSoTimeout(3_000);
        return peer;
    }
    static void closed(Socket peer) throws Exception {
        if (peer.getInputStream().read() != -1) throw new AssertionError("peer not rejected");
    }
    public static void main(String[] args) throws Exception {
        try (ServerSocketChannel server = ServerSocketChannel.open();
                ExecutorService worker = Executors.newSingleThreadExecutor()) {
            server.bind(new InetSocketAddress("127.0.0.1", 0));
            int port = ((InetSocketAddress) server.getLocalAddress()).getPort();
            Future<?> serving = worker.submit(() -> {
                try { new ReaHandshakeProbe().acceptAuthenticatedLoopbackClient(
                    server, new SessionDescriptor("secret")); }
                catch (Exception error) { throw new RuntimeException(error); }
            });
            try (Socket invalid = connect(port)) {
                invalid.getOutputStream().write("bad-token:ping\n".getBytes(StandardCharsets.UTF_8));
                closed(invalid);
            }
            // EOF before a newline is not an authenticated request.
            try (Socket eof = connect(port)) {
                eof.getOutputStream().write("secret:ping".getBytes(StandardCharsets.UTF_8));
                eof.shutdownOutput();
                closed(eof);
            }
            try (Socket oversized = connect(port)) {
                oversized.getOutputStream().write(new byte[64 * 1024 + 1]);
                closed(oversized);
            }
            try (Socket idle = connect(port)) {
                long start = System.nanoTime();
                closed(idle);
                long elapsed = (System.nanoTime() - start) / 1_000_000;
                if (elapsed < 700 || elapsed > 2_500) throw new AssertionError("idle deadline " + elapsed);
            }
            try (Socket trickle = connect(port)) {
                long start = System.nanoTime();
                for (int i = 0; i < 4; i++) {
                    trickle.getOutputStream().write('x');
                    Thread.sleep(250);
                }
                closed(trickle);
                if ((System.nanoTime() - start) / 1_000_000 > 2_000)
                    throw new AssertionError("slow input extended deadline");
            }
            // Same write contains the first and the following frame. The first
            // reader must consume exactly one line without swallowing lookahead.
            try (Socket valid = connect(port)) {
                valid.getOutputStream().write(("secret:ping\n" + "x".repeat(200_000) + "\n")
                    .getBytes(StandardCharsets.UTF_8));
                String reply = new BufferedReader(new InputStreamReader(valid.getInputStream(),
                    StandardCharsets.UTF_8)).readLine();
                if (!"accepted".equals(reply)) throw new AssertionError("legitimate client failed");
            }
            serving.get(3, TimeUnit.SECONDS);
        }
        System.out.println("PASS: rejection, EOF, frame ceiling, idle/trickle deadlines, retry, pipeline, authenticated large request");
    }
__METHODS__
}
'''.replace("__METHODS__", methods)
with tempfile.TemporaryDirectory(prefix="rea-ghidra-handshake-") as directory:
    source = pathlib.Path(directory) / "ReaHandshakeProbe.java"
    source.write_text(harness)
    subprocess.run([sys.argv[1] if len(sys.argv) > 1 else "java", str(source)],
                   check=True, timeout=30)
