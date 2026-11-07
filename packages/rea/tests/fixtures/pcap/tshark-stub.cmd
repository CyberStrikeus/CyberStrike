@echo off
rem Pcap tool stub for Windows: emulates tshark --version and field output.
rem %1 is the first argument; the capture path arrives as %2 for -r/-c.

if "%~1"=="--version" (
    echo TShark ^(Wireshark^) 4.6.6-windows-stub
    exit /b 0
)

if not "%~1"=="-n" exit /b 2
if not "%~2"=="-r" exit /b 2
if not "%~4"=="-T" exit /b 2
if not "%~5"=="json" exit /b 2

for %%A in (%*) do if "%%~A"=="-x" goto rawDns

rem Emit the same JSON as the POSIX stub
echo [{"_source":{"layers":{"frame.number":["1"],"frame.protocols":["eth:ethertype:ip:udp:dns"],"ip.src":["192.168.1.100"],"ip.dst":["8.8.8.8"],"dns.qry.name":["api.example.com"],"dns.flags.response":["1"],"dns.a":["93.184.216.34"],"dns.qry.type":["1"],"dns.qry.class":["0x0001"],"dns.count.queries":["1"],"dns.count.answers":["1"],"dns.count.auth_rr":["0"],"dns.count.add_rr":["0"],"dns.resp.name":["api.example.com"],"dns.resp.type":["1"],"dns.resp.class":["0x0001"]}}},{"_source":{"layers":{"frame.number":["2"],"frame.protocols":["eth:ethertype:ip:tcp:tls"],"ip.src":["192.168.1.100"],"ip.dst":["93.184.216.34"],"tls.handshake.extensions_server_name":["api.example.com"]}}},{"_source":{"layers":{"frame.number":["3"],"frame.protocols":["eth:ethertype:ip:tcp:http"],"ip.src":["192.168.1.100"],"ip.dst":["93.184.216.34"],"http.request.full_uri":["http://api.example.com/v1/data"]}}}]
exit /b 0

:rawDns
echo [{"_source":{"layers":{"frame":{"frame.number":"1"},"dns_raw":["00018180000100010000000003617069076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822",42,49,0,1],"dns":{"dns.id_raw":["0001",42,2,0,5],"Queries":{"dns.qry.name":"api.example.com"},"Answers":{"dns.a":"93.184.216.34"}}}}}]
exit /b 0
