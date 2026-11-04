' Lance Atelier en mode dev (rechargement à chaud de l'interface, redémarrage auto d'Electron),
' sans fenêtre de console. Les sessions tournent dans le démon et survivent aux redémarrages.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = dir
sh.Environment("PROCESS").Remove("ANTHROPIC_API_KEY")
sh.Run "cmd /c npx electron-vite dev -w > """ & dir & "\dev.log"" 2>&1", 0, False
