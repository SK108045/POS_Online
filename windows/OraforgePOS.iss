; A single-file, per-user Windows installer created from the verified portable bundle.
#ifndef SourceDir
  #error SourceDir must be passed to ISCC, e.g. /DSourceDir=C:\path\to\OraforgePOS
#endif
#ifndef OutputDir
  #define OutputDir "Output"
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{72B9E249-71E2-48CA-974B-5BC0BAA96A6D}
AppName=Oraforge POS
AppVersion={#AppVersion}
AppPublisher=Oraforge Technologies
DefaultDirName={localappdata}\Programs\OraforgePOS
DefaultGroupName=Oraforge POS
OutputBaseFilename=OraforgePOS-Setup-Windows-x64
OutputDir={#OutputDir}
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\OraforgePOS.exe
DisableProgramGroupPage=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Oraforge POS"; Filename: "{app}\OraforgePOS.exe"
Name: "{autoprograms}\Stop Oraforge POS"; Filename: "{app}\Stop POS.cmd"
Name: "{autoprograms}\Configure Oraforge eTIMS Helper"; Filename: "{app}\runtime\etims\OraforgeEtims\OraforgeEtims.exe"; Parameters: "--configure"
Name: "{autodesktop}\Oraforge POS"; Filename: "{app}\OraforgePOS.exe"; Tasks: desktopicon
Name: "{userstartup}\Oraforge eTIMS Helper"; Filename: "{app}\runtime\etims\OraforgeEtims\OraforgeEtims.exe"; Tasks: etimsstartup

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"
Name: etimsstartup; Description: "Start the eTIMS Windows Helper when I sign in"; GroupDescription: "Windows integration:"

[Run]
Filename: "{app}\OraforgePOS.exe"; Description: "Launch Oraforge POS"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Intentionally empty: never erase %LOCALAPPDATA%\OraforgePOS customer data.
