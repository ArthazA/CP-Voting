"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { CATEGORY_LABELS, LIVE_TOPIC, REACTIONS, REACTIONS_TOPIC, SLOT_PREFIX, type Category, type ReactionCounts, type ReactionKind } from "@/lib/event-config";

type Entry = { id: string; contestantName: string; costumeName: string; category: Category; isGroup: boolean };
type Control = { status: "waiting" | "voting" | "paused"; current_entry_id: string | null; last_entry_id: string | null; ends_at: string | null; paused_remaining_ms: number | null };
type Floater = { id: number; emoji: string; x: number; drift: number; duration: number; delay: number; size: number };

const MAX_FLOATERS = 70;
const MAX_PER_BATCH = 8;
const SOURCE_KEY = "sti-live-source";
const EMOJI: Record<ReactionKind, string> = Object.fromEntries(REACTIONS.map((reaction) => [reaction.kind, reaction.emoji])) as Record<ReactionKind, string>;
const EMPTY_TALLY: Record<ReactionKind, number> = { ghost: 0, fire: 0, heart: 0, skull: 0, clap: 0 };

function slotCodes(entries: Entry[]) {
  const seen: Partial<Record<Category, number>> = {};
  return new Map(entries.map((entry) => {
    const position = (seen[entry.category] ?? 0) + 1;
    seen[entry.category] = position;
    return [entry.id, `${SLOT_PREFIX[entry.category]}${position}`];
  }));
}

export default function LiveScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentRef = useRef<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [control, setControl] = useState<Control | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [source, setSource] = useState<string>("");
  const [sourceError, setSourceError] = useState("");
  const [hasStream, setHasStream] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [tally, setTally] = useState<Record<ReactionKind, number>>(EMPTY_TALLY);
  const [qr, setQr] = useState("");
  const [voteUrl, setVoteUrl] = useState("");

  // ---- event state (who's walking, the timer) ----
  const loadState = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const state = await response.json();
    if (!state.configured) return;
    setEntries(state.entries ?? []);
    setControl(state.control);
  }, []);

  // ---- floating reactions ----
  const addReactions = useCallback((counts: ReactionCounts) => {
    setTally((previous) => {
      const next = { ...previous };
      for (const [kind, amount] of Object.entries(counts)) if (kind in next) next[kind as ReactionKind] += Number(amount) || 0;
      return next;
    });
    const fresh: Floater[] = [];
    for (const [kind, amount] of Object.entries(counts)) {
      const emoji = EMOJI[kind as ReactionKind];
      if (!emoji) continue;
      const shown = Math.min(MAX_PER_BATCH, Number(amount) || 0);
      for (let index = 0; index < shown; index += 1) {
        fresh.push({ id: Math.random(), emoji, x: Math.random() * 70, drift: (Math.random() - 0.5) * 80, duration: 3.2 + Math.random() * 1.6, delay: Math.random() * 0.5, size: 44 + Math.random() * 30 });
      }
    }
    if (!fresh.length) return;
    setFloaters((previous) => [...previous, ...fresh].slice(-MAX_FLOATERS));
    const longest = Math.max(...fresh.map((floater) => floater.duration + floater.delay));
    window.setTimeout(() => setFloaters((previous) => previous.filter((floater) => !fresh.includes(floater))), longest * 1000 + 100);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadState();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    // Safety net: refresh every 10 seconds even if a live update is missed.
    const poll = window.setInterval(() => { void loadState(); }, 10_000);
    if (!url || !key) return () => window.clearInterval(poll);
    const supabase = createClient(url, key);
    supabase.channel(LIVE_TOPIC, { config: { private: false } })
      .on("broadcast", { event: "state_updated" }, ({ payload }) => setControl(payload as Control))
      .on("broadcast", { event: "entries_updated" }, () => { void loadState(); })
      .subscribe((status) => { if (status === "SUBSCRIBED") void loadState(); });
    supabase.channel(REACTIONS_TOPIC, { config: { private: false } })
      .on("broadcast", { event: "reactions" }, ({ payload }) => addReactions((payload?.counts ?? {}) as ReactionCounts))
      .subscribe();
    return () => { window.clearInterval(poll); void supabase.removeAllChannels(); };
  }, [loadState, addReactions]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(tick);
  }, []);

  // New contestant on the catwalk: start their reaction tally from zero.
  useEffect(() => {
    const id = control?.current_entry_id ?? null;
    if (id && id !== currentRef.current) setTally(EMPTY_TALLY);
    currentRef.current = id;
  }, [control?.current_entry_id]);

  // ---- camera / shared window ----
  const stopStream = () => { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setHasStream(false); };

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setDevices(all.filter((device) => device.kind === "videoinput"));
  }, []);

  const openCamera = useCallback(async (deviceId?: string) => {
    setSourceError("");
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 } } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setHasStream(true);
      const id = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? "";
      setSource(id);
      try { localStorage.setItem(SOURCE_KEY, id); } catch {}
      await refreshDevices();
    } catch (error) {
      setSourceError(error instanceof Error && error.name === "NotAllowedError" ? "Camera blocked. Click the camera icon in the address bar and allow it." : "Couldn't open that camera. Check the iPhone is plugged in and unlocked once, then try again.");
    }
  }, [refreshDevices]);

  async function shareWindow() {
    setSourceError("");
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setHasStream(true);
      setSource("screen");
    } catch {
      setSourceError("Window sharing was cancelled.");
    }
  }

  useEffect(() => {
    let saved = "";
    try { saved = localStorage.getItem(SOURCE_KEY) ?? ""; } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openCamera(saved || undefined);
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => { navigator.mediaDevices?.removeEventListener("devicechange", refreshDevices); stopStream(); };
  }, [openCamera, refreshDevices]);

  // ---- QR code for latecomers ----
  useEffect(() => {
    const url = window.location.origin;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoteUrl(url.replace(/^https?:\/\//, ""));
    void QRCode.toDataURL(url, { margin: 1, width: 400, color: { dark: "#070305", light: "#ffffff" } }).then(setQr);
  }, []);

  // ---- hide controls when the mouse is still ----
  useEffect(() => {
    let timer = window.setTimeout(() => setControlsVisible(false), 3000);
    const show = () => { setControlsVisible(true); window.clearTimeout(timer); timer = window.setTimeout(() => setControlsVisible(false), 3000); };
    window.addEventListener("mousemove", show);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "f" || event.key === "F") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener("mousemove", show); window.removeEventListener("keydown", onKey); };
  }, []);

  const slots = slotCodes(entries);
  const current = entries.find((entry) => entry.id === control?.current_entry_id) ?? null;
  const anchorId = control?.status === "waiting" ? control.last_entry_id ?? control.current_entry_id : control?.current_entry_id;
  const anchor = entries.findIndex((entry) => entry.id === anchorId);
  const upNext = anchor >= 0 ? entries.slice(anchor + 1) : entries;
  const remaining = control?.status === "voting" && control.ends_at ? Math.max(0, Math.ceil((Date.parse(control.ends_at) - now) / 1000)) : control?.status === "paused" ? Math.ceil((control.paused_remaining_ms ?? 0) / 1000) : 0;
  const voting = control?.status === "voting" && remaining > 0;
  const onStage = current && (control?.status === "voting" || control?.status === "paused") ? current : null;
  const ticker = upNext;

  return (
    <main className={`lv-shell ${controlsVisible ? "" : "lv-quiet"}`}>
      <video ref={videoRef} className={`lv-video ${mirror ? "mirror" : ""}`} autoPlay playsInline muted />
      {!hasStream && <div className="lv-nocam"><b>Waiting for the camera</b><span>{sourceError || "Plug in the iPhone, then pick it below."}</span></div>}
      <div className="lv-fade-top" /><div className="lv-fade-bottom" />

      <header className="lv-top">
        <div className="lv-brand">SCARE <i>to</i> <b>Impress</b></div>
        <div className="lv-top-right">
          <span className="lv-live"><i />LIVE</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          {qr && <div className="lv-qr"><img src={qr} alt="QR code to vote" /><span>Scan to vote<br /><b>{voteUrl}</b></span></div>}
        </div>
      </header>

      <div className="lv-floats" aria-hidden="true">
        {floaters.map((floater) => (
          <span key={floater.id} style={{ left: `${floater.x}%`, fontSize: floater.size, animationDuration: `${floater.duration}s`, animationDelay: `${floater.delay}s`, ["--drift" as string]: `${floater.drift}px` }}>{floater.emoji}</span>
        ))}
      </div>

      <section className="lv-lower">
        {onStage ? (
          <div className="lv-now">
            <div className="lv-tags">
              <span className="lv-slot">{slots.get(onStage.id)}</span>
              {onStage.isGroup && <span className="lv-group">GROUP</span>}
              <span className="lv-cat">{CATEGORY_LABELS[onStage.category]}</span>
            </div>
            <div className="lv-name">{onStage.contestantName} <i>as</i></div>
            <div className="lv-costume">{onStage.costumeName}</div>
          </div>
        ) : (
          <div className="lv-now">
            <div className="lv-tags"><span className="lv-cat">{upNext[0] ? "Up next" : "Stand by"}</span></div>
            {upNext[0] ? <><div className="lv-name">{upNext[0].contestantName} <i>as</i></div><div className="lv-costume">{upNext[0].costumeName}</div></> : <div className="lv-costume">The catwalk opens soon</div>}
          </div>
        )}
        <div className="lv-side">
          <div className="lv-tally">{REACTIONS.map((reaction) => <span key={reaction.kind}>{reaction.emoji}<b>{tally[reaction.kind]}</b></span>)}</div>
          {onStage && <div className={`lv-timer ${voting && remaining <= 3 ? "urgent" : ""}`}><small>{control?.status === "paused" ? "PAUSED" : voting ? "VOTE NOW" : "TIME'S UP"}</small><b>{String(remaining).padStart(2, "0")}</b></div>}
        </div>
      </section>

      <div className="lv-ticker">
        <span className="lv-ticker-label">UP NEXT</span>
        <div className="lv-ticker-window">
          {ticker.length ? (
            <div className="lv-ticker-track">
              {[0, 1].map((copy) => <div key={copy} className="lv-ticker-set" aria-hidden={copy === 1}>{ticker.map((entry) => <span key={`${copy}-${entry.id}`}><em>{slots.get(entry.id)}</em>{entry.contestantName} <i>as</i> <b>{entry.costumeName}</b><span className="lv-sep">|</span></span>)}</div>)}
            </div>
          ) : <span className="lv-ticker-empty">Scan the QR code to vote and react</span>}
        </div>
      </div>

      <div className="lv-controls">
        <select value={source} onChange={(event) => { if (event.target.value === "screen") void shareWindow(); else void openCamera(event.target.value); }}>
          {!devices.length && <option value="">No camera found</option>}
          {devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
          <option value="screen">Share a window instead…</option>
        </select>
        <button type="button" onClick={() => void openCamera(source && source !== "screen" ? source : undefined)}>Reconnect</button>
        <button type="button" onClick={() => setMirror((value) => !value)}>{mirror ? "Unmirror" : "Mirror"}</button>
        <button type="button" onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>Full screen (F)</button>
        {sourceError && <span className="lv-error">{sourceError}</span>}
      </div>
    </main>
  );
}
