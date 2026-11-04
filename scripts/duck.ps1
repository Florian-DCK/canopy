# Mode voix : baisse le son des autres applications pendant que Claude parle, puis le remet (mixeur de volume Windows).
#   duck    : chaque application qui joue du son (sauf Canopy) passe à -Factor de son volume ; l'original est mémorisé
#   restore : remet les volumes mémorisés
# Le code Core Audio est compilé une fois dans une DLL (dossier temporaire) pour que chaque appel reste rapide.
param([ValidateSet('duck', 'restore')][string]$Action, [double]$Factor = 0.3, [string]$Keep = 'electron,canopy')
$ErrorActionPreference = 'Stop'

$dll = Join-Path $env:TEMP 'canopy-duck-v1.dll'
$state = Join-Path $env:TEMP 'canopy-duck-state.json'
if (-not (Test-Path $dll)) {
  Add-Type -OutputAssembly $dll -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic; using System.Diagnostics;
namespace CanopyDuck {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { int NotImpl1(); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 { int NotImpl1(); int NotImpl2(); [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e); }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int n); [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s); }
  [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int NotImpl0(); int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4(); int NotImpl5(); int NotImpl6(); int NotImpl7(); int NotImpl8();
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
  }
  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume { [PreserveSig] int SetMasterVolume(float v, ref Guid ctx); [PreserveSig] int GetMasterVolume(out float v); }
  public class Session { public string Id; public string Name; public float Volume; public object Ctl; }
  public static class Mixer {
    public static List<Session> Sessions() {
      var list = new List<Session>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice dev; en.GetDefaultAudioEndpoint(0, 1, out dev);
      var iid = typeof(IAudioSessionManager2).GUID; object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
      IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se);
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) {
        IAudioSessionControl2 c; se.GetSession(i, out c);
        if (c.IsSystemSoundsSession() == 0) continue;
        uint pid; c.GetProcessId(out pid); string id; c.GetSessionInstanceIdentifier(out id);
        string name = ""; try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}
        float v; ((ISimpleAudioVolume)c).GetMasterVolume(out v);
        list.Add(new Session { Id = id, Name = name, Volume = v, Ctl = c });
      }
      return list;
    }
    public static void Set(Session s, float v) { var g = Guid.Empty; ((ISimpleAudioVolume)s.Ctl).SetMasterVolume(v, ref g); }
  }
}
"@
}
Add-Type -Path $dll

# Pas « $keep » : PowerShell confond les majuscules, et le paramètre typé [string] reconvertirait la liste en texte.
$keepList = $Keep.ToLower() -split ','
$sessions = [CanopyDuck.Mixer]::Sessions()
if ($Action -eq 'duck') {
  if (Test-Path $state) { exit 0 } # déjà baissé
  $saved = @{}
  foreach ($s in $sessions) {
    if ($keepList -contains $s.Name.ToLower() -or -not $s.Name) { continue }
    $saved[$s.Id] = $s.Volume
    [CanopyDuck.Mixer]::Set($s, [float]($s.Volume * $Factor))
  }
  $saved | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 $state
} else {
  if (-not (Test-Path $state)) { exit 0 }
  $saved = Get-Content -Raw -Encoding UTF8 $state | ConvertFrom-Json
  foreach ($s in $sessions) {
    $v = $saved.($s.Id)
    if ($null -ne $v) { [CanopyDuck.Mixer]::Set($s, [float]$v) }
  }
  Remove-Item $state
}
