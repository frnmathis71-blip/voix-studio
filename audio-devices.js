// Périphériques audio de Windows : liste, micro par défaut, installation du câble virtuel.
// Windows n'a pas d'API publique pour changer le périphérique par défaut : on passe par
// l'interface COM IPolicyConfig (celle qu'utilise le panneau Son), via PowerShell.
const { app, net } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CS_SOURCE = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace VoixStudio {
  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Sequential)] public struct PropVariant { public ushort vt; public ushort r1, r2, r3; public IntPtr p; public IntPtr p2; }
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore { void GetCount(out int c); void GetAt(int i, out PropertyKey k); void GetValue(ref PropertyKey k, out PropVariant v); void SetValue(ref PropertyKey k, ref PropVariant v); void Commit(); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice { void Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); void OpenPropertyStore(int access, out IPropertyStore ps); void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); void GetState(out int s); }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceCollection { void GetCount(out int n); void Item(int i, out IMMDevice d); }
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator { void EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d); }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator {}
  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPolicyConfig { void M1(); void M2(); void M3(); void M4(); void M5(); void M6(); void M7(); void M8(); void M9(); void M10(); [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role); void M12(); }
  [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] public class PolicyConfigClient {}
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume { int M1(); int M2(); int M3(); int M4(); int M5(); int M6(); int M7(); int M8(); int M9(); int M10(); int M11(); [PreserveSig] int SetMute(bool m, ref Guid ctx); [PreserveSig] int GetMute(out bool m); }
  public static class Audio {
    static string Id(IMMDevice d) { string s; d.GetId(out s); return s; }
    static string Name(IMMDevice d) {
      IPropertyStore ps; d.OpenPropertyStore(0, out ps);
      PropertyKey k = new PropertyKey(); k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 14;
      PropVariant v; ps.GetValue(ref k, out v);
      return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    }
    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }
    static string DefaultId(IMMDeviceEnumerator e, int flow, int role) { IMMDevice d; return e.GetDefaultAudioEndpoint(flow, role, out d) == 0 ? Id(d) : ""; }
    static IAudioEndpointVolume Volume(IMMDevice d) {
      Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A"); object o;
      d.Activate(ref iid, 23, IntPtr.Zero, out o);
      return (IAudioEndpointVolume)o;
    }
    static bool Muted(IMMDevice d) { try { bool m; Volume(d).GetMute(out m); return m; } catch { return false; } }
    // Un micro coupé dans Windows (ou par son bouton tactile) n'envoie que du silence
    public static void Unmute(string id) {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice d; e.GetDevice(id, out d);
      Guid ctx = Guid.Empty;
      Marshal.ThrowExceptionForHR(Volume(d).SetMute(false, ref ctx));
    }
    public static string List() {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      StringBuilder sb = new StringBuilder("{");
      for (int flow = 0; flow < 2; flow++) {
        string def = DefaultId(e, flow, 0), com = DefaultId(e, flow, 2);
        IMMDeviceCollection c; e.EnumAudioEndpoints(flow, 1, out c);
        int n; c.GetCount(out n);
        sb.Append(flow == 0 ? "\"render\":[" : ",\"capture\":[");
        for (int i = 0; i < n; i++) {
          IMMDevice d; c.Item(i, out d);
          string id = Id(d);
          if (i > 0) sb.Append(",");
          sb.AppendFormat("{{\"id\":\"{0}\",\"name\":\"{1}\",\"isDefault\":{2},\"isComms\":{3},\"muted\":{4}}}", Esc(id), Esc(Name(d)), id == def ? "true" : "false", id == com ? "true" : "false", flow == 1 && Muted(d) ? "true" : "false");
        }
        sb.Append("]");
      }
      return sb.Append("}").ToString();
    }
    public static void SetDefault(string id, string roles) {
      IPolicyConfig p = (IPolicyConfig)new PolicyConfigClient();
      foreach (char r in roles) Marshal.ThrowExceptionForHR(p.SetDefaultEndpoint(id, r - '0'));
    }
    // Change la description du périphérique (« CABLE Output » → « Voix Studio »), comme le panneau Son
    public static void Rename(string id, string name) {
      IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice d; e.GetDevice(id, out d);
      IPropertyStore ps; d.OpenPropertyStore(2, out ps);
      PropertyKey k = new PropertyKey(); k.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.pid = 2;
      PropVariant v = new PropVariant(); v.vt = 31; v.p = Marshal.StringToCoTaskMemUni(name);
      try { ps.SetValue(ref k, ref v); ps.Commit(); } finally { Marshal.FreeCoTaskMem(v.p); }
    }
  }
}`;

// La DLL compilée est mise en cache : la compilation prend une seconde, le chargement presque rien.
const DLL_VERSION = 3;

const PS_SCRIPT = `
param([string]$Action, [string]$Id = '', [string]$Roles = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$dll = Join-Path $env:VS_CACHE 'VoixStudioAudio-${DLL_VERSION}.dll'
if (-not (Test-Path $dll)) {
  Add-Type -TypeDefinition (Get-Content -Raw -Encoding UTF8 (Join-Path $env:VS_CACHE 'audio.cs')) -OutputAssembly $dll -OutputType Library
}
Add-Type -Path $dll
switch ($Action) {
  'list' { [VoixStudio.Audio]::List() }
  'set' { [VoixStudio.Audio]::SetDefault($Id, $Roles); 'ok' }
  'rename' { [VoixStudio.Audio]::Rename($Id, $Roles); 'ok' }
  'unmute' { [VoixStudio.Audio]::Unmute($Id); 'ok' }
}
`;

const CABLE_ZIP = 'https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip';
const isCableCapture = (d) => /^CABLE Output|VB-Audio Virtual Cable/i.test(d.name);
// Micros virtuels d'autres logiciels : jamais une bonne source pour Voix Studio
const isVirtualCapture = (d) => isCableCapture(d) || /voicemod|virtual|voicemeeter|steam streaming/i.test(d.name);

let cacheDir = null;

function ensureScript() {
  if (cacheDir) return cacheDir;
  cacheDir = path.join(app.getPath('userData'), 'audio-helper');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'audio.cs'), CS_SOURCE, 'utf8');
  fs.writeFileSync(path.join(cacheDir, 'audio.ps1'), '﻿' + PS_SCRIPT, 'utf8');
  return cacheDir;
}

function runPs(args) {
  const dir = ensureScript();
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'audio.ps1'), ...args],
      { env: { ...process.env, VS_CACHE: dir }, windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim()))
    );
  });
}

async function listDevices() {
  return JSON.parse(await runPs(['list']));
}

function setDefault(id, roles) {
  return runPs(['set', id, roles]);
}

// Micro par défaut d'avant Voix Studio, gardé sur disque pour pouvoir le rendre même après un plantage
const prevFile = () => path.join(app.getPath('userData'), 'micro-precedent.json');
function readPrevious() {
  try { return JSON.parse(fs.readFileSync(prevFile(), 'utf8')); } catch (e) { return null; }
}

async function status() {
  const devs = await listDevices();
  const cable = devs.capture.find(isCableCapture) || null;
  const def = devs.capture.find((d) => d.isDefault) || null;
  const prev = readPrevious();
  // Le vrai micro de l'utilisateur : le micro par défaut d'avant s'il est physique, sinon le premier micro physique
  const candidates = [def, prev && devs.capture.find((d) => d.id === prev.consoleId), ...devs.capture];
  const real = candidates.find((d) => d && !isVirtualCapture(d));
  const cfg = cable ? await cableConfig() : {};
  return {
    installed: !!cable,
    cableName: cable ? cable.name : '',
    renamed: !!(cable && cable.name.startsWith(CABLE_NAME)),
    isDefault: !!(cable && def && def.id === cable.id),
    realMicName: real ? real.name : '',
    realMicMuted: !!(real && real.muted),
    latency: cfg.latency || 0,
    sampleRate: cfg.sampleRate || 48000,
    captures: devs.capture.map((d) => ({ name: d.name, virtual: isVirtualCapture(d) })),
  };
}

// ---------- Nom et délai du câble virtuel
const CABLE_NAME = 'Voix Studio';
const CABLE_KEY = 'HKLM\\SOFTWARE\\VB-Audio\\Cable';

// Réactive un micro coupé, retrouvé par son nom (celui qu'affiche Voix Studio)
async function unmuteMic(name) {
  const devs = await listDevices();
  const mic = devs.capture.find((d) => d.name === name || (name && (name.startsWith(d.name) || d.name.startsWith(name))));
  if (!mic) throw new Error('Micro introuvable.');
  if (mic.muted) await runPs(['unmute', mic.id]);
  return true;
}

async function renameCable() {
  const devs = await listDevices();
  const cable = devs.capture.find(isCableCapture);
  if (!cable) throw new Error('Le micro virtuel n’est pas installé.');
  if (!cable.name.startsWith(CABLE_NAME)) await runPs(['rename', cable.id, CABLE_NAME]);
  return true;
}

// Réglages du pilote VB-CABLE : réserve de son (en échantillons) et fréquence interne
function cableConfig() {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', CABLE_KEY], { windowsHide: true }, (err, stdout) => {
      if (err) { resolve({}); return; }
      const val = (name) => {
        const m = stdout.match(new RegExp(name + '\\s+REG_DWORD\\s+0x([0-9a-f]+)', 'i'));
        return m ? parseInt(m[1], 16) : 0;
      };
      resolve({ latency: val('VBAudioCableWDM_Latency'), sampleRate: val('VBAudioCableWDM_SR') });
    });
  });
}

const LATENCIES = [512, 1024, 2048, 3072, 7168];

// Écrire dans HKLM demande les droits administrateur : Windows affiche sa demande d'autorisation
async function setCableLatency(samples) {
  if (!LATENCIES.includes(samples)) throw new Error('Valeur de délai inconnue.');
  const args = `add ${CABLE_KEY} /v VBAudioCableWDM_Latency /t REG_DWORD /d ${samples} /f`;
  const cmd = `$p = Start-Process -FilePath reg.exe -ArgumentList '${args}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true }, () => resolve());
  });
  const cfg = await cableConfig();
  if (cfg.latency !== samples) throw new Error('Le délai n’a pas été changé : l’autorisation de Windows a été refusée.');
  return cfg.latency;
}

async function makeDefault() {
  const devs = await listDevices();
  const cable = devs.capture.find(isCableCapture);
  if (!cable) throw new Error('Le micro virtuel n’est pas installé.');
  const def = devs.capture.find((d) => d.isDefault);
  const com = devs.capture.find((d) => d.isComms);
  if (def && def.id !== cable.id && !readPrevious()) {
    fs.writeFileSync(prevFile(), JSON.stringify({
      consoleId: def.id,
      consoleName: def.name,
      commsId: com ? com.id : def.id,
    }));
  }
  await setDefault(cable.id, '012');
  return true;
}

async function restoreDefault() {
  const prev = readPrevious();
  if (!prev) return false;
  const devs = await listDevices();
  const ids = devs.capture.map((d) => d.id);
  if (ids.includes(prev.consoleId)) await setDefault(prev.consoleId, '01');
  if (ids.includes(prev.commsId)) await setDefault(prev.commsId, '2');
  fs.unlinkSync(prevFile());
  return true;
}

// Télécharge le pilote officiel VB-CABLE et lance son installateur (Windows demande l'autorisation)
async function installCable() {
  const dir = path.join(app.getPath('temp'), 'voixstudio-vbcable');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const res = await net.fetch(CABLE_ZIP);
  if (!res.ok) throw new Error('Téléchargement impossible (' + res.status + ').');
  const zip = path.join(dir, 'vbcable.zip');
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const setup = path.join(dir, 'VBCABLE_Setup_x64.exe');
  const cmd = [
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`,
    `$p = Start-Process -FilePath '${setup}' -Verb RunAs -Wait -PassThru`,
    'exit $p.ExitCode',
  ].join('; ');
  // Le code de sortie de l'installateur ne dit pas grand-chose : on regarde plutôt si le câble est apparu
  await new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true }, () => resolve());
  });
  return status();
}

module.exports = { status, makeDefault, restoreDefault, installCable, readPrevious, renameCable, setCableLatency, unmuteMic, micMuted };

// Le micro choisi dans Voix Studio est-il coupé dans Windows ?
async function micMuted(name) {
  const devs = await listDevices();
  const mic = devs.capture.find((d) => d.name === name || (name && (name.startsWith(d.name) || d.name.startsWith(name))));
  return !!(mic && mic.muted);
}
