@echo off
rem capinfos stub for Windows: emulates capinfos --version and metadata output.

if "%~1"=="--version" (
    echo Capinfos ^(Wireshark^) 4.6.6-windows-stub
    exit /b 0
)

if not "%~1"=="-M" exit /b 2
if not "%~2"=="-S" exit /b 2
if not "%~3"=="--" exit /b 2
if "%~4"=="" exit /b 2

echo File name:           capture.pcap
echo File type:           Wireshark/tcpdump/... - pcap
echo File encapsulation:  Ethernet
echo Packet size limit:   file hdr: 262144 bytes
echo Number of packets:   3
echo Capture duration:    0.123 seconds
echo Earliest packet time: 1791728020.608505
echo Latest packet time:   1791728020.981978
exit /b 0
