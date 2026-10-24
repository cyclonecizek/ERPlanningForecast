#!/usr/bin/env python3
"""Build ER_Weather_Tools.html: the planning, exposure, LMEF and TAF pages in one self-contained file.

Double-click the file to open it in Edge or Chrome; nothing to install. Scripts, styles, the 45 WS
patch and the TFC-style templates are built in. Model guidance comes straight from the public
services, and the data this repo's GitHub Actions mirror (MOS, high-res, SPC, launches, protons)
is read from the GitHub Pages site.

Usage:  python pipeline/build_standalone.py [--base https://<user>.github.io/<repo>/] [--out docs/ER_Weather_Tools.html]
Standard library only.
"""
import argparse
import base64
import json
import os
import re
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
PAGES = [("planning", "index.html", "Planning forecast"), ("exposure", "exposure.html", "Exposure forecasts"),
         ("lmef", "lmef.html", "Launch forecast (LMEF)"), ("taf", "taf.html", "TAF generator"), ("verify", "verify.html", "Verification")]
HREF_TO_TAB = {"./": "planning", "index.html": "planning", "exposure.html": "exposure", "lmef.html": "lmef", "taf.html": "taf", "verify.html": "verify", "verify.html#exposure": "verify", "./#brief": "planning#brief"}


def page_html(fname, base, logo_uri):
    html = open(os.path.join(DOCS, fname), encoding="utf-8").read()

    # inline every local script
    def inline(m):
        src = m.group(1).split("?")[0]
        path = os.path.join(DOCS, src)
        if not os.path.exists(path):
            return m.group(0)
        code = open(path, encoding="utf-8").read().replace("</script", "<\\/script")
        return f"<script>\n/* {src} */\n{code}\n</script>"
    html = re.sub(r'<script src="([\w.-]+\.js(?:\?v=[0-9a-f]+)?)"></script>', inline, html)
    # logo and data locations
    html = html.replace('src="45ws-logo.png"', f'src="{logo_uri}"')
    boot = ("<script>window.DATA_BASE = " + json.dumps(base) + "; window.LOGO_SRC = " + json.dumps(logo_uri)
            + "; window.STANDALONE = true; try { window.FORCE_DEMO = /[?&]demo=1\\b/.test(window.parent.location.search); } catch (e) {}</script>\n"
            + STANDALONE_JS)
    html = html.replace("<head>", "<head>\n" + boot, 1)
    return html


# inside each tool: the tab bar switches tools in the parent file, and the theme follows the other tabs
STANDALONE_JS = """<script>
(function(){
  var st = document.createElement("style"); st.textContent = ".pagenav a.offl{display:none !important}"; document.head.appendChild(st);
  var MAP = %s;
  document.addEventListener("DOMContentLoaded", function(){
    var nav = document.querySelector(".pagenav"), sp = nav && nav.querySelector(".navsp"); if (!sp) return;
    var w = document.createElement("a"); w.href = "#workspace"; w.className = "wsl"; w.textContent = "Workspace"; w.title = "Save or open a shared workspace file (shift handoff)";
    w.style.cssText = "font:600 13px Barlow, sans-serif; border-bottom:0; margin-right:10px;";
    w.addEventListener("click", function(e){ e.preventDefault(); window.parent.postMessage({ erwxWorkspace:true }, "*"); });
    sp.after(w);
  });
  document.addEventListener("click", function(e){
    var a = e.target.closest && e.target.closest(".pagenav a"); if (!a || !window.parent || window.parent === window) return;
    var t = MAP[a.getAttribute("href")]; if (!t) return;
    e.preventDefault(); e.stopPropagation(); window.parent.postMessage({ erwxTab: t }, "*");
  }, true);
  window.addEventListener("message", function(e){ if (e.data && e.data.erwxBrief && typeof wantBrief === "function") wantBrief(); });
  /* copying from inside the file's frames can be refused; fall back to the older copy command */
  try {
    var C = window.Clipboard && Clipboard.prototype, orig = C && C.writeText;
    var legacy = function(t){ var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok ? Promise.resolve() : Promise.reject(new Error("copy failed")); };
    if (C) C.writeText = function(t){ var self = this; return orig ? orig.call(self, t).catch(function(){ return legacy(t); }) : legacy(t); };
  } catch (e) {}
  window.addEventListener("storage", function(e){
    if (e.key !== "erwx:theme") return;
    if (e.newValue === "light" || e.newValue === "dark") document.documentElement.setAttribute("data-theme", e.newValue); else document.documentElement.removeAttribute("data-theme");
    window.dispatchEvent(new Event("themechange"));
  });
})();
</script>
""" % json.dumps(HREF_TO_TAB)

LAUNCHER = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eastern Range Weather Tools | 45th Weather Squadron</title>
<link rel="icon" href="__LOGO__">
<style>
html,body{margin:0;height:100%;background:#EDF0F2;font:14px "Segoe UI",Arial,sans-serif}
@media (prefers-color-scheme: dark){html,body{background:#0E141B}}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:none;background:transparent}
iframe.on{display:block}
#ws{position:fixed;inset:0;z-index:10;background:rgba(10,16,23,.55);display:flex;align-items:center;justify-content:center;padding:20px}
#ws[hidden]{display:none}
#ws .card{background:#fff;color:#13202E;border-radius:14px;max-width:560px;width:100%;padding:20px 22px;box-shadow:0 24px 60px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px}
#ws h2{margin:0;font:700 22px "Segoe UI",Arial,sans-serif}
#ws .sub{margin:0;color:#4A5767;line-height:1.45}
#ws fieldset{border:1px solid #D3DAE0;border-radius:10px;padding:8px 12px;display:grid;gap:6px}
#ws legend{font-weight:600;padding:0 4px}
#ws label{display:flex;gap:8px;align-items:center}
#ws label.note{flex-direction:column;align-items:stretch;gap:4px;font-weight:600}
#ws textarea{font:14px "Segoe UI",Arial,sans-serif;border:1px solid #D3DAE0;border-radius:8px;padding:8px}
#ws .info{font-size:13px;color:#4A5767;background:#F5F7F8;border-radius:8px;padding:8px 10px;line-height:1.45}
#ws .info:empty{display:none}
#ws .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
#ws button{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid #D3DAE0;background:#fff;font:600 14px "Segoe UI",Arial,sans-serif;cursor:pointer}
#ws button.pri{background:#13202E;color:#fff;border-color:#13202E}
#msg{position:fixed;inset:auto 0 0 0;padding:8px 14px;font-size:12px;color:#7E8A97;text-align:center}
</style>
</head>
<body>
<div id="ws" hidden role="dialog" aria-modal="true" aria-labelledby="wsT">
  <div class="card">
    <h2 id="wsT">Workspace</h2>
    <p class="sub">Share in-progress forecasts between forecasters: save to a file on the shared drive, and open the latest one at the start of a shift. Each person keeps their own initials and display settings.</p>
    <fieldset><legend>Tools</legend>
      <label><input type="checkbox" data-tool="planning" checked> Planning forecast and leadership brief</label>
      <label><input type="checkbox" data-tool="exposure" checked> Exposure forecasts</label>
      <label><input type="checkbox" data-tool="lmef" checked> Launch forecast (LMEF)</label>
      <label><input type="checkbox" data-tool="taf" checked> TAF drafts</label>
    </fieldset>
    <label class="note">Handoff note (optional)<textarea id="wsNote" rows="3" placeholder="e.g. Updated LC-39A exposure for the crane lift; LMEF delay day still needs review"></textarea></label>
    <div id="wsInfo" class="info"></div>
    <div class="row"><button id="wsClose" type="button">Close</button><button id="wsOpen" type="button">Open workspace file…</button><button id="wsSave" type="button" class="pri">Save workspace file…</button></div>
    <input type="file" id="wsFile" accept=".json,application/json" hidden>
  </div>
</div>
<div id="msg">Loading. Built __BUILT__ from the ERPlanningForecast repository. Guidance comes from the public services and __BASE__</div>
<script>
/* each tool runs in its own frame so their settings and scripts stay separate */
var PAGES = __PAGES__;
var frames = {};
function show(tab){
  var brief = tab.indexOf("#brief") > 0; tab = tab.replace("#brief", "");
  if (!PAGES[tab]) tab = "planning";
  if (!frames[tab]){
    var f = document.createElement("iframe"); f.title = tab; f.setAttribute("allow", "clipboard-write");
    f.srcdoc = PAGES[tab]; document.body.appendChild(f); frames[tab] = f;
    if (brief) f.addEventListener("load", function(){ setTimeout(function(){ f.contentWindow.postMessage({ erwxBrief:true }, "*"); }, 300); });
  } else if (brief) frames[tab].contentWindow.postMessage({ erwxBrief:true }, "*");
  for (var k in frames) frames[k].className = k === tab ? "on" : "";
  document.getElementById("msg").style.display = "none";
  try { localStorage.setItem("erwx:lastTab", tab); } catch (e) {}
  history.replaceState(null, "", "#" + tab);
}
window.addEventListener("message", function(e){ if (e.data && e.data.erwxTab) show(e.data.erwxTab); if (e.data && e.data.erwxWorkspace) openWs(); });
/* ---------- shared workspace file ----------
   Each tool keeps its work in this browser's storage under its own prefix; the workspace file
   carries those entries between computers. Personal settings (initials, theme) stay local. */
var TOOLS = { planning:["planfx:"], exposure:["expfx:"], lmef:["lmfx:","lmef:"], taf:["taffx:"] };
var PERSONAL = ["initials","tz","wu","theme"];
var wsHandle = null;
function chosen(){ return [].slice.call(document.querySelectorAll("#ws [data-tool]")).filter(function(c){ return c.checked; }).map(function(c){ return c.dataset.tool; }); }
function openWs(){ document.getElementById("ws").hidden = false; document.getElementById("wsInfo").textContent = wsHandle ? "Linked to " + wsHandle.name + " for this session: Save writes straight to it." : ""; }
function closeWs(){ document.getElementById("ws").hidden = true; }
function initialsNow(){ try { var p = JSON.parse(localStorage.getItem("planfx:v1:prefs") || "{}"); return (p.initials || "").toUpperCase(); } catch (e) { return ""; } }
function collect(){
  var tools = chosen(), data = {};
  for (var i = 0; i < localStorage.length; i++){
    var k = localStorage.key(i);
    tools.forEach(function(t){ TOOLS[t].forEach(function(pre){ if (k.indexOf(pre) === 0) data[k] = localStorage.getItem(k); }); });
  }
  return { kind:"erwx-workspace", version:1, savedAt:new Date().toISOString(), savedBy:initialsNow(), note:document.getElementById("wsNote").value.trim(), tools:tools, data:data };
}
function stamp(){ var d = new Date(), p = function(n){ return String(n).padStart(2, "0"); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()); }
async function saveWs(){
  var ws = collect(), text = JSON.stringify(ws), name = "ER_Workspace_" + (ws.savedBy || "team") + "_" + stamp() + ".json";
  try {
    if (window.showSaveFilePicker){
      if (!wsHandle) wsHandle = await window.showSaveFilePicker({ suggestedName:name, types:[{ description:"Workspace", accept:{ "application/json":[".json"] } }] });
      var w = await wsHandle.createWritable(); await w.write(text); await w.close();
      document.getElementById("wsInfo").textContent = "Saved to " + wsHandle.name + " at " + new Date().toLocaleTimeString() + ". Save again any time to update it.";
      return;
    }
  } catch (e) { if (e && e.name === "AbortError") return; wsHandle = null; }
  var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type:"application/json" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  document.getElementById("wsInfo").textContent = "Downloaded " + name + ". Move it to the shared drive for the next forecaster.";
}
function applyWs(ws){
  if (!ws || ws.kind !== "erwx-workspace"){ alert("That isn't a workspace file."); return; }
  var tools = chosen().filter(function(t){ return (ws.tools || []).indexOf(t) >= 0; });
  if (!tools.length){ alert("The file doesn't include the tools you ticked."); return; }
  var when = ws.savedAt ? new Date(ws.savedAt).toLocaleString() : "unknown time";
  if (!confirm("Open the workspace saved by " + (ws.savedBy || "someone") + " on " + when + "?\n\nThis replaces your current work in: " + tools.join(", ") + "." + (ws.note ? "\n\nNote: " + ws.note : ""))) return;
  /* keep personal settings from this computer */
  var keep = {};
  for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (/:prefs$/.test(k)){ try { keep[k] = JSON.parse(localStorage.getItem(k)); } catch (e) {} } }
  var drop = [];
  for (var j = 0; j < localStorage.length; j++){ var k2 = localStorage.key(j); tools.forEach(function(t){ TOOLS[t].forEach(function(pre){ if (k2.indexOf(pre) === 0) drop.push(k2); }); }); }
  drop.forEach(function(k){ localStorage.removeItem(k); });
  Object.keys(ws.data || {}).forEach(function(k){
    if (!tools.some(function(t){ return TOOLS[t].some(function(pre){ return k.indexOf(pre) === 0; }); })) return;
    var v = ws.data[k];
    if (/:prefs$/.test(k) && keep[k]){ try { var o = JSON.parse(v); PERSONAL.forEach(function(f){ if (keep[k][f] !== undefined) o[f] = keep[k][f]; else delete o[f]; }); v = JSON.stringify(o); } catch (e) {} }
    localStorage.setItem(k, v);
  });
  /* reload the open tools so they pick up the new work */
  Object.keys(frames).forEach(function(t){ if (tools.indexOf(t) >= 0){ frames[t].srcdoc = PAGES[t]; } });
  document.getElementById("wsInfo").textContent = "Opened the workspace from " + (ws.savedBy || "someone") + " (" + when + ")." + (ws.note ? " Note: " + ws.note : "");
}
async function openFile(){
  try {
    if (window.showOpenFilePicker){
      var hs = await window.showOpenFilePicker({ types:[{ description:"Workspace", accept:{ "application/json":[".json"] } }] });
      wsHandle = hs[0]; var f = await wsHandle.getFile(); applyWs(JSON.parse(await f.text())); return;
    }
  } catch (e) { if (e && e.name === "AbortError") return; }
  document.getElementById("wsFile").click();
}
document.getElementById("wsSave").onclick = saveWs;
document.getElementById("wsOpen").onclick = openFile;
document.getElementById("wsClose").onclick = closeWs;
document.getElementById("ws").addEventListener("click", function(e){ if (e.target.id === "ws") closeWs(); });
document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeWs(); });
document.getElementById("wsFile").onchange = function(e){ var f = e.target.files[0]; if (!f) return; f.text().then(function(t){ try { applyWs(JSON.parse(t)); } catch (x) { alert("Couldn't read that file."); } }); e.target.value = ""; };
var start = (location.hash || "").slice(1); if (!PAGES[start.replace("#brief", "")]){ try { start = localStorage.getItem("erwx:lastTab") || "planning"; } catch (e) { start = "planning"; } }
show(start);
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("PAGES_BASE", "https://cyclonecizek.github.io/ERPlanningForecast/"))
    ap.add_argument("--out", default=os.path.join(DOCS, "ER_Weather_Tools.html"))
    a = ap.parse_args()
    base = a.base if a.base.endswith("/") else a.base + "/"
    logo = open(os.path.join(DOCS, "45ws-logo.png"), "rb").read()
    logo_uri = "data:image/png;base64," + base64.b64encode(logo).decode()
    pages = {key: page_html(fname, base, logo_uri) for key, fname, _ in PAGES if os.path.exists(os.path.join(DOCS, fname))}
    built = datetime.now(timezone.utc).strftime("%d %b %Y %H%MZ")
    out = (LAUNCHER.replace("__PAGES__", json.dumps(pages).replace("</", "<\\/"))
           .replace("__LOGO__", logo_uri).replace("__BUILT__", built).replace("__BASE__", base))
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {a.out} ({os.path.getsize(a.out)/1e6:.1f} MB, {len(pages)} tools)")


if __name__ == "__main__":
    main()
