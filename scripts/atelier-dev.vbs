' Lance Atelier en mode dev (rechargement à chaud de l'interface, redémarrage auto d'Electron),
' sans fenêtre de console. Les sessions tournent dans le démon et survivent aux redémarrages.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = dir
sh.Environment("PROCESS").Remove("ANTHROPIC_API_KEY")
' Journal : dev.log, ou dev-2.log si une instance précédente le tient encore ouvert (sinon le lancement échouerait sans bruit).
logName = "dev.log"
On Error Resume Next
Set probe = CreateObject("Scripting.FileSystemObject").OpenTextFile(dir & "\dev.log", 8, True)
If Err.Number <> 0 Then
  logName = "dev-2.log"
  Err.Clear
Else
  probe.Close
End If
On Error GoTo 0
sh.Run "cmd /c npx electron-vite dev -w > """ & dir & "\" & logName & """ 2>&1", 0, False
