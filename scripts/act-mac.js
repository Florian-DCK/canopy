// Mode compagnon, version macOS : équivalent de act.ps1 (même protocole, même sortie JSON), en JXA.
// Lancé par src/main/act.ts : osascript -l JavaScript scripts/act-mac.js <payload base64 JSON>
//   find / locate / invoke / click / type / key
// Prérequis : Canopy autorisé dans Réglages Système › Confidentialité et sécurité › Accessibilité.
ObjC.import('Cocoa')
ObjC.import('CoreGraphics')

const se = Application('System Events')
se.includeStandardAdditions = false
const std = Application.currentApplication()
std.includeStandardAdditions = true

const ROLES = { AXButton: 'Button', AXMenuItem: 'MenuItem', AXMenuBarItem: 'MenuItem', AXLink: 'Hyperlink', AXTextField: 'Edit', AXTextArea: 'Edit',
  AXComboBox: 'Edit', AXCheckBox: 'CheckBox', AXRadioButton: 'RadioButton', AXTab: 'TabItem', AXPopUpButton: 'ComboBox', AXStaticText: 'Text', AXImage: 'Image' }

const KEYCODES = { enter: 36, return: 36, tab: 48, space: 49, backspace: 51, delete: 117, del: 117, esc: 53, escape: 53, left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111 }

class Fail extends Error {}

function frontProc() {
  return se.processes.whose({ frontmost: true })[0]
}

function rootOf(proc) {
  try { const w = proc.windows[0]; w.role(); return w } catch (e) { return proc }
}

function str(v) { return typeof v === 'string' ? v : '' }

function kindOf(role, subrole, parentRole) {
  if (role === 'AXRadioButton' && (parentRole === 'AXTabGroup' || subrole === 'AXTabButton')) return 'TabItem'
  return ROLES[role] || String(role || 'Unknown').replace(/^AX/, '')
}

// Éléments visibles et nommés de la fenêtre active (profondeur et nombre bornés).
function items(root, max) {
  const out = []
  let visited = 0
  const maxVisit = max * 4 + 200
  function walk(el, depth, parentRole) {
    if (out.length >= max || visited >= maxVisit || depth > 12) return
    let kids = []
    try { kids = el.uiElements() } catch (e) { return }
    for (let i = 0; i < kids.length; i++) {
      if (out.length >= max || visited >= maxVisit) return
      visited++
      const k = kids[i]
      let pr
      try { pr = k.properties() } catch (e) { continue }
      const role = str(pr.role)
      const name = str(pr.title) || str(pr.description) || str(pr.value) || ''
      const pos = pr.position, size = pr.size
      if (name && name.length <= 120 && pos && size && size[0] >= 2 && size[1] >= 2) {
        out.push({ el: k, name: name, kind: kindOf(role, str(pr.subrole), parentRole), x: Math.round(pos[0]), y: Math.round(pos[1]), w: Math.round(size[0]), h: Math.round(size[1]) })
      }
      walk(k, depth + 1, role)
    }
  }
  walk(root, 0, '')
  return out
}

function target(root, name, kind) {
  let list = items(root, 1500)
  if (kind) list = list.filter((i) => i.kind.toLowerCase().indexOf(String(kind).toLowerCase()) >= 0)
  const n = String(name).toLowerCase()
  return list.find((i) => i.name === name) || list.find((i) => i.name.toLowerCase().indexOf(n) >= 0) || null
}

function rect(t) { return { x: t.x, y: t.y, w: t.w, h: t.h } }

function mouse(type, x, y, clicks) {
  const ev = $.CGEventCreateMouseEvent(null, type, { x: x, y: y }, $.kCGMouseButtonLeft)
  if (clicks) $.CGEventSetIntegerValueField(ev, $.kCGMouseEventClickState, clicks)
  $.CGEventPost($.kCGHIDEventTap, ev)
}

function click(x, y, double) {
  mouse($.kCGEventMouseMoved, x, y, 0)
  delay(0.03)
  for (let c = 1; c <= (double ? 2 : 1); c++) {
    mouse($.kCGEventLeftMouseDown, x, y, c)
    mouse($.kCGEventLeftMouseUp, x, y, c)
  }
}

function paste(text) {
  const pb = $.NSPasteboard.generalPasteboard
  const prev = ObjC.unwrap(pb.stringForType($.NSPasteboardTypeString))
  pb.clearContents
  pb.setStringForType($(String(text)), $.NSPasteboardTypeString)
  se.keystroke('v', { using: 'command down' })
  delay(0.15)
  if (prev) {
    pb.clearContents
    pb.setStringForType($(prev), $.NSPasteboardTypeString)
  }
}

function pressKeys(keys) {
  const parts = String(keys).toLowerCase().split('+').map((s) => s.trim()).filter(Boolean)
  const explicit = parts.some((k) => k === 'cmd' || k === 'command' || k === 'control')
  const mods = []
  const add = (m) => { if (mods.indexOf(m) < 0) mods.push(m) }
  let main = null
  for (const k of parts) {
    if (k === 'ctrl') add(explicit ? 'control down' : 'command down')
    else if (k === 'control') add('control down')
    else if (k === 'cmd' || k === 'command' || k === 'win' || k === 'super' || k === 'meta') add('command down')
    else if (k === 'alt' || k === 'option' || k === 'opt') add('option down')
    else if (k === 'shift') add('shift down')
    else if (main === null) main = k
    else throw new Fail(`Touche inconnue : « ${k} ».`)
  }
  if (main === null) {
    // « win » seul : sur Mac, l'équivalent du menu Démarrer est Spotlight.
    if (parts.length === 1 && (parts[0] === 'win' || parts[0] === 'super' || parts[0] === 'meta')) { se.keyCode(49, { using: ['command down'] }); return }
    throw new Fail('Aucune touche à presser (modificateurs seuls).')
  }
  if (KEYCODES[main] !== undefined) se.keyCode(KEYCODES[main], mods.length ? { using: mods } : {})
  else if (main.length === 1) mods.length ? se.keystroke(main, { using: mods }) : se.keystroke(main)
  else throw new Fail(`Touche inconnue : « ${main} ».`)
}

function run(argv) {
  const done = (o) => JSON.stringify(o)
  try {
    const p = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions($(argv[0]), 0), $.NSUTF8StringEncoding)))
    const proc = frontProc()
    const root = rootOf(proc)
    let win = ''
    try { win = str(root.title()) || str(proc.name()) } catch (e) { win = str(proc.name()) }
    const nf = (p) => `Introuvable dans « ${win} » : « ${p.target} ».`
    switch (p.action) {
      case 'find': {
        const list = items(root, 400).map((i) => `${i.kind} · ${i.name} · ${i.x},${i.y} ${i.w}×${i.h}`)
        return done({ ok: true, text: `Fenêtre active : « ${win} ». Éléments visibles (type · nom · x,y l×h) :\n` + list.join('\n') })
      }
      case 'locate': {
        const t = target(root, p.target, p.kind)
        if (!t) return done({ ok: false, text: nf(p) })
        return done({ ok: true, text: `${t.kind} « ${t.name} »`, rect: rect(t) })
      }
      case 'invoke': {
        const t = target(root, p.target, p.kind)
        if (!t) return done({ ok: false, text: nf(p) })
        let how = null
        try { t.el.actions.byName('AXPress').perform(); how = 'déclenché' } catch (e) {}
        if (!how) { click(t.x + Math.round(t.w / 2), t.y + Math.round(t.h / 2), false); how = 'cliqué' }
        return done({ ok: true, text: `${t.kind} « ${t.name} » ${how} dans « ${win} ».`, rect: rect(t) })
      }
      case 'click':
        click(Math.round(p.x), Math.round(p.y), !!(p.double || p.count === 2))
        return done({ ok: true, text: `Clic en ${p.x},${p.y} dans « ${win} ».` })
      case 'type': {
        if (p.target) {
          const t = target(root, p.target, p.kind)
          if (!t) return done({ ok: false, text: nf(p) })
          try { t.el.attributes.byName('AXFocused').value = true } catch (e) {}
          if (!p.append) {
            try {
              t.el.value = String(p.text)
              if (t.el.value() === String(p.text)) return done({ ok: true, text: `Écrit dans « ${t.name} ».`, rect: rect(t) })
            } catch (e) {}
          }
        }
        paste(p.text)
        return done({ ok: true, text: `Texte tapé dans « ${win} ».` })
      }
      case 'key':
        pressKeys(p.keys)
        return done({ ok: true, text: `Touches « ${p.keys} » dans « ${win} ».` })
      default:
        return done({ ok: false, text: `Action inconnue : ${p.action}` })
    }
  } catch (e) {
    const m = String((e && e.message) || e)
    if (e instanceof Fail) return done({ ok: false, text: m })
    if (/-1719|-25211|-25200|assistive|not allowed|not authori[sz]ed/i.test(m))
      return done({ ok: false, text: 'Accessibilité non autorisée : autorise Canopy dans Réglages Système › Confidentialité et sécurité › Accessibilité.' })
    return done({ ok: false, text: `Échec : ${m}` })
  }
}
