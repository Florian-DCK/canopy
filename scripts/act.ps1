# Mode compagnon (planche 33) : Claude agit sur l'écran de l'utilisateur, d'abord par l'accessibilité Windows (UI Automation),
# la souris et le clavier simulés en dernier recours. Appelé par src/main/act.ts ; entrée et sortie en JSON.
#   find   : éléments utiles de la fenêtre active (nom, type, rectangle)
#   locate : rectangle de l'élément visé (pour que la main de Claude y glisse avant d'agir)
#   invoke : déclenche l'élément visé (bouton, menu, lien, case…), sinon clique en son centre
#   click  : clic à des coordonnées écran
#   type   : tape du texte (dans l'élément visé s'il y en a un)
#   key    : touches (« ctrl+l », « enter », « win », « alt+f4 »…)
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Act {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, IntPtr.Zero); mouse_event(4, 0, 0, 0, IntPtr.Zero); }
  public static void Key(byte vk, bool up) { keybd_event(vk, 0, up ? 2u : 0u, IntPtr.Zero); }
}
"@

$AE = [System.Windows.Automation.AutomationElement]
function Root { $AE::FromHandle([Act]::GetForegroundWindow()) }
function Rect($e) { $r = $e.Current.BoundingRectangle; @{ x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height } }
function Kind($e) { $e.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' }

# Éléments visibles et nommés de la fenêtre active (limités pour rester lisibles).
function Items([int]$max = 400) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::IsOffscreenProperty, $false)
  $all = (Root).FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $out = @()
  foreach ($e in $all) {
    if ($out.Count -ge $max) { break }
    $n = $e.Current.Name
    if (-not $n -or $n.Length -gt 120) { continue }
    $r = $e.Current.BoundingRectangle
    if ($r.Width -lt 2 -or $r.Height -lt 2) { continue }
    $out += [pscustomobject]@{ el = $e; name = $n; kind = (Kind $e) }
  }
  $out
}

# L'élément visé : nom exact d'abord, puis contenu ; un type peut départager (« Button », « MenuItem »…).
function Target([string]$name, [string]$kind) {
  $items = Items 1500
  if ($kind) { $items = $items | Where-Object { $_.kind -like "*$kind*" } }
  $hit = $items | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $hit) { $hit = $items | Where-Object { $_.name -like "*$name*" } | Select-Object -First 1 }
  $hit
}

function Done($obj) { $obj | ConvertTo-Json -Compress -Depth 4; exit 0 }
function Fail($msg) { @{ ok = $false; text = $msg } | ConvertTo-Json -Compress; exit 0 }

$VK = @{ ctrl = 0x11; control = 0x11; alt = 0x12; shift = 0x10; win = 0x5B; enter = 0x0D; return = 0x0D; esc = 0x1B; escape = 0x1B; tab = 0x09; space = 0x20;
  backspace = 0x08; delete = 0x2E; del = 0x2E; up = 0x26; down = 0x28; left = 0x25; right = 0x27; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22;
  f1 = 0x70; f2 = 0x71; f3 = 0x72; f4 = 0x73; f5 = 0x74; f6 = 0x75; f7 = 0x76; f8 = 0x77; f9 = 0x78; f10 = 0x79; f11 = 0x7A; f12 = 0x7B }

try {
  $win = (Root).Current.Name
  switch ($p.action) {
    'find' {
      $list = Items 400 | ForEach-Object { $r = $_.el.Current.BoundingRectangle; '{0} · {1} · {2},{3} {4}×{5}' -f $_.kind, $_.name, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height }
      Done @{ ok = $true; text = "Fenêtre active : « $win ». Éléments visibles (type · nom · x,y l×h) :`n" + ($list -join "`n") }
    }
    'locate' {
      $t = Target $p.target $p.kind
      if (-not $t) { Fail "Introuvable dans « $win » : « $($p.target) »." }
      Done @{ ok = $true; text = "$($t.kind) « $($t.name) »"; rect = (Rect $t.el) }
    }
    'invoke' {
      $t = Target $p.target $p.kind
      if (-not $t) { Fail "Introuvable dans « $win » : « $($p.target) »." }
      $e = $t.el
      $how = $null
      foreach ($pat in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.ExpandCollapsePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern)) {
        $o = $null
        if ($e.TryGetCurrentPattern($pat, [ref]$o)) {
          switch ($pat.ProgrammaticName) {
            'InvokePatternIdentifiers.Pattern' { $o.Invoke(); $how = 'déclenché' }
            'ExpandCollapsePatternIdentifiers.Pattern' { $o.Expand(); $how = 'ouvert' }
            'SelectionItemPatternIdentifiers.Pattern' { $o.Select(); $how = 'sélectionné' }
            'TogglePatternIdentifiers.Pattern' { $o.Toggle(); $how = 'basculé' }
          }
          break
        }
      }
      if (-not $how) { $r = Rect $e; [Act]::Click($r.x + [int]($r.w / 2), $r.y + [int]($r.h / 2)); $how = 'cliqué' }
      Done @{ ok = $true; text = "$($t.kind) « $($t.name) » $how dans « $win »."; rect = (Rect $e) }
    }
    'click' {
      [Act]::Click([int]$p.x, [int]$p.y)
      Done @{ ok = $true; text = "Clic en $($p.x),$($p.y) dans « $win »." }
    }
    'type' {
      if ($p.target) {
        $t = Target $p.target $p.kind
        if (-not $t) { Fail "Introuvable dans « $win » : « $($p.target) »." }
        $t.el.SetFocus()
        $o = $null
        if ($t.el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$o) -and -not $p.append) {
          $o.SetValue([string]$p.text)
          Done @{ ok = $true; text = "Écrit dans « $($t.name) »."; rect = (Rect $t.el) }
        }
      }
      # Par le presse-papiers (puis Ctrl+V) : la frappe simulée dépend de la disposition du clavier (AZERTY : « % » devient « 5 »).
      $prev = $null
      try { $prev = [System.Windows.Forms.Clipboard]::GetText() } catch {}
      [System.Windows.Forms.Clipboard]::SetText([string]$p.text)
      [Act]::Key(0x11, $false); [Act]::Key(0x56, $false); [Act]::Key(0x56, $true); [Act]::Key(0x11, $true)
      Start-Sleep -Milliseconds 150
      if ($prev) { try { [System.Windows.Forms.Clipboard]::SetText($prev) } catch {} }
      Done @{ ok = $true; text = "Texte tapé dans « $win »." }
    }
    'key' {
      $keys = ([string]$p.keys).ToLower() -split '\+' | ForEach-Object { $_.Trim() }
      $codes = foreach ($k in $keys) {
        if ($VK.ContainsKey($k)) { [byte]$VK[$k] } elseif ($k.Length -eq 1) { [byte][char]$k.ToUpper() } else { Fail "Touche inconnue : « $k »." }
      }
      foreach ($c in $codes) { [Act]::Key($c, $false) }
      [array]::Reverse($codes)
      foreach ($c in $codes) { [Act]::Key($c, $true) }
      Done @{ ok = $true; text = "Touches « $($p.keys) » dans « $win »." }
    }
    default { Fail "Action inconnue : $($p.action)" }
  }
} catch {
  Fail "Échec : $($_.Exception.Message)"
}
