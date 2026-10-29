"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, CATEGORY_LABELS, PUMPKIN_LABELS, ROUND_SECONDS, SLOT_LIMIT, SLOT_PREFIX, categoryRank, type Category } from "@/lib/event-config";

type Entry = { id: string; contestantName: string; costumeName: string; category: Category; isGroup: boolean };
type Vote = { entryId: string; score: number };
type OrganizerResult = { id: string; contestantName: string; costumeName: string; category: Category; isGroup: boolean; votes: number; average: number | null };
type Mode = "audience" | "organizer";
type SessionStatus = "waiting" | "voting" | "paused";

function makeUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function getVoterKey() {
  let key = window.localStorage.getItem("cp-voter-key");
  if (!key) {
    key = makeUuid();
    window.localStorage.setItem("cp-voter-key", key);
  }
  return key;
}

const categories = CATEGORIES;
const starterEntries: Entry[] = [
  { id: "f-1", contestantName: "Taylor", costumeName: "The Office Goblin", category: "Funniest", isGroup: false },
  { id: "f-2", contestantName: "Morad and the gang", costumeName: "Shaun The Sheeps", category: "Funniest", isGroup: true },
  { id: "p-1", contestantName: "Morgan", costumeName: "Moonlit Monarch", category: "Prettiest", isGroup: false },
  { id: "g-1", contestantName: "The Addams crew", costumeName: "The Addams Family", category: "Group", isGroup: true },
  { id: "s-1", contestantName: "Alex", costumeName: "The Haunted Doll", category: "Scariest", isGroup: false },
];

// Slot codes (F1, P3, G2, S8…) follow each contestant's position within their category in the walk order.
function slotCodes(entries: Entry[]) {
  const seen: Partial<Record<Category, number>> = {};
  return new Map(entries.map((entry) => {
    const position = (seen[entry.category] ?? 0) + 1;
    seen[entry.category] = position;
    return [entry.id, `${SLOT_PREFIX[entry.category]}${position}`];
  }));
}

export default function PartyApp({ mode }: { mode: Mode }) {
  const [entries, setEntries] = useState<Entry[]>(starterEntries);
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);
  const [lastEntryId, setLastEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<SessionStatus>("waiting");
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [remoteMode, setRemoteMode] = useState(false);
  const [liveAverage, setLiveAverage] = useState(0);
  const [liveVoteCount, setLiveVoteCount] = useState(0);
  const [organizerAuthed, setOrganizerAuthed] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [actionError, setActionError] = useState("");
  const [votes, setVotes] = useState<Vote[]>([]);
  const [organizerResults, setOrganizerResults] = useState<OrganizerResult[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [newContestantName, setNewContestantName] = useState("");
  const [newCostumeName, setNewCostumeName] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("Funniest");
  const [newIsGroup, setNewIsGroup] = useState(false);
  const resultsRefresh = useRef<number | null>(null);
  const currentEntryRef = useRef<string | null>(null);
  const [notice, setNotice] = useState("Preview mode · Supabase is not connected yet");

  const currentEntry = entries.find((entry) => entry.id === currentEntryId) ?? null;
  const entryVotes = votes.filter((vote) => vote.entryId === currentEntryId);
  const average = entryVotes.length
    ? entryVotes.reduce((sum, vote) => sum + vote.score, 0) / entryVotes.length
    : 0;
  const displayedAverage = remoteMode ? liveAverage : average;
  const displayedVoteCount = remoteMode ? liveVoteCount : entryVotes.length;
  const slots = slotCodes(entries);
  const categoryCounts = Object.fromEntries(categories.map((category) => [category, entries.filter((entry) => entry.category === category).length])) as Record<Category, number>;

  useEffect(() => { currentEntryRef.current = currentEntryId; }, [currentEntryId]);
  const orderAnchorId = status === "waiting" ? lastEntryId ?? currentEntryId : currentEntryId;
  const orderAnchorIndex = entries.findIndex((entry) => entry.id === orderAnchorId);
  const upNextEntries = orderAnchorIndex >= 0 ? entries.slice(orderAnchorIndex + 1) : entries;

  function getEntryResult(entryId: string) {
    if (remoteMode) return organizerResults.find((result) => result.id === entryId) ?? null;
    const entryVotes = votes.filter((vote) => vote.entryId === entryId);
    return { votes: entryVotes.length, average: entryVotes.length ? entryVotes.reduce((sum, vote) => sum + vote.score, 0) / entryVotes.length : null };
  }

  const loadOrganizerResults = useCallback(async () => {
    const response = await fetch("/api/organizer/results", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    setOrganizerResults(result.results ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let realtimeChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    const loadState = async () => {
      try {
        const voterKey = getVoterKey();
        const response = await fetch(`/api/state?voterKey=${encodeURIComponent(voterKey)}`, { cache: "no-store" });
        const state = await response.json();
        if (!response.ok || !state.configured || cancelled) return false;
        setRemoteMode(true);
        setNotice("Connected · live event state");
        setEntries(state.entries);
        setCurrentEntryId(state.control.current_entry_id);
        setLastEntryId(state.control.last_entry_id ?? null);
        setStatus(state.control.status);
        setSessionId(state.control.session_id);
        setEndsAt(state.control.ends_at);
        setRemaining(Math.ceil((state.control.remaining_ms ?? 0) / 1000));
        setHasVoted(Boolean(state.hasVoted));
        setSelectedScore(typeof state.myScore === "number" ? state.myScore : null);
        setLiveAverage(state.average ?? 0);
        setLiveVoteCount(state.voteCount ?? 0);
        return true;
      } catch {
        return false;
      }
    };

    void loadState().then((connected) => {
      if (!connected || cancelled) return;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) return;
      const supabase = createClient(url, key);
      realtimeChannel = supabase
        .channel("costume-party-live", { config: { private: false } })
        .on("broadcast", { event: "state_updated" }, ({ payload }) => {
          // Pausing or resuming the same costume keeps the guest's pick; a new costume clears it.
          const sameCostume = (payload.current_entry_id ?? null) === currentEntryRef.current;
          setCurrentEntryId(payload.current_entry_id ?? null);
          setLastEntryId(payload.last_entry_id ?? null);
          setStatus(payload.status);
          setSessionId(payload.session_id ?? null);
          setEndsAt(payload.ends_at ?? null);
          setRemaining(payload.status === "paused" ? Math.ceil((payload.paused_remaining_ms ?? 0) / 1000) : ROUND_SECONDS);
          if (!sameCostume) {
            setHasVoted(false);
            setSelectedScore(null);
            setLiveAverage(0);
            setLiveVoteCount(0);
          }
          setNotice(payload.status === "voting" ? "A costume is live · cast your vote" : payload.status === "paused" ? "Voting paused by organizer" : "Waiting for the next costume");
        })
        .on("broadcast", { event: "votes_updated" }, ({ payload }) => {
          setLiveVoteCount(Number(payload.vote_count ?? 0));
          setOrganizerResults((previous) => previous.map((result) => result.id === payload.entry_id
            ? { ...result, votes: Number(payload.vote_count ?? 0) }
            : result));
          // The broadcast carries no average (the channel is public), so the host desk re-fetches it, at most once a second.
          if (mode === "organizer" && resultsRefresh.current === null) {
            resultsRefresh.current = window.setTimeout(() => {
              resultsRefresh.current = null;
              void loadState();
              void loadOrganizerResults();
            }, 1000);
          }
        })
        .on("broadcast", { event: "entries_updated" }, () => { void loadState(); })
        .subscribe((connectionStatus) => {
          if (connectionStatus === "SUBSCRIBED") void loadState();
        });
    });

    return () => {
      cancelled = true;
      if (realtimeChannel) void realtimeChannel.unsubscribe();
      if (resultsRefresh.current !== null) window.clearTimeout(resultsRefresh.current);
    };
  }, [mode, loadOrganizerResults]);

  useEffect(() => {
    if (status !== "voting") return;
    const timer = window.setInterval(() => {
      if (remoteMode && endsAt) {
        const nextRemaining = Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000));
        setRemaining(nextRemaining);
        if (nextRemaining === 0) {
          setStatus("waiting");
          setNotice("Time's up. Your vote is locked in.");
          if (organizerAuthed) void loadOrganizerResults();
        }
      } else {
        setRemaining((seconds) => {
          if (seconds <= 1) {
            setStatus("waiting");
            setNotice("Time's up. Your vote is locked in.");
            return 0;
          }
          return seconds - 1;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status, remoteMode, endsAt, organizerAuthed, loadOrganizerResults]);

  async function apiAction(action: string, entryId?: string) {
    setActionError("");
    const response = await fetch("/api/organizer/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, entryId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not update the session.");
    return result.control;
  }

  async function startEntry(entry: Entry) {
    if (remoteMode) {
      try {
        const control = await apiAction("start", entry.id);
        setCurrentEntryId(control.current_entry_id);
        setSessionId(control.session_id);
        setEndsAt(control.ends_at);
        setRemaining(ROUND_SECONDS);
        setHasVoted(false);
        setSelectedScore(null);
        setStatus("voting");
        setNotice(`Now voting: ${entry.contestantName} as ${entry.costumeName}`);
      } catch (error) { setActionError(error instanceof Error ? error.message : "Could not start voting."); }
      return;
    }
    setCurrentEntryId(entry.id);
    setRemaining(ROUND_SECONDS);
    setHasVoted(false);
    setSelectedScore(null);
    setStatus("voting");
    setNotice(`Now voting: ${entry.contestantName} as ${entry.costumeName}`);
  }

  async function submitVote(score: number) {
    if (!currentEntry || status !== "voting" || score === selectedScore) return;
    const previousScore = selectedScore;
    setSelectedScore(score);
    setHasVoted(true);
    if (remoteMode) {
      const response = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: currentEntry.id, sessionId, voterKey: getVoterKey(), score }),
      });
      const result = await response.json();
      if (!response.ok) {
        setSelectedScore(previousScore);
        setHasVoted(previousScore !== null);
        setActionError(result.error ?? "Could not save your vote.");
        return;
      }
      setActionError("");
      if (typeof result.voteCount === "number") setLiveVoteCount(result.voteCount);
      setNotice("Vote saved. Tap another pumpkin to change it before time's up.");
      return;
    }
    setVotes((previous) => [...previous.filter((vote) => vote.entryId !== currentEntry.id), { entryId: currentEntry.id, score }]);
  }

  async function pauseOrResume() {
    if (remoteMode) {
      try {
        const control = await apiAction(status === "voting" ? "pause" : "resume");
        setStatus(control.status);
        setEndsAt(control.ends_at);
        setRemaining(control.status === "paused" ? Math.ceil((control.paused_remaining_ms ?? 0) / 1000) : Math.ceil((Date.parse(control.ends_at) - Date.now()) / 1000));
        setNotice(control.status === "paused" ? "Voting paused. The timer is frozen." : "Voting resumed.");
      } catch (error) { setActionError(error instanceof Error ? error.message : "Could not pause or resume."); }
      return;
    }
    if (status === "voting") {
      setStatus("paused");
      setNotice("Voting paused. The timer is frozen.");
    } else if (status === "paused") {
      setStatus("voting");
      setNotice("Voting resumed.");
    }
  }

  async function stopSession() {
    if (remoteMode) {
      try {
        const control = await apiAction("stop");
        if (organizerAuthed) await loadOrganizerResults();
        setLastEntryId(control.last_entry_id ?? currentEntryId);
        setStatus("waiting");
        setCurrentEntryId(null);
        setSessionId(null);
        setEndsAt(null);
        setRemaining(ROUND_SECONDS);
        setHasVoted(false);
        setSelectedScore(null);
        setNotice("Waiting for the organizer to start the next costume.");
      } catch (error) { setActionError(error instanceof Error ? error.message : "Could not end session."); }
      return;
    }
    setStatus("waiting");
    setLastEntryId(currentEntryId);
    setCurrentEntryId(null);
    setRemaining(ROUND_SECONDS);
    setHasVoted(false);
    setSelectedScore(null);
    setNotice("Waiting for the organizer to start the next costume.");
  }

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contestantName = newContestantName.trim();
    const costumeName = newCostumeName.trim();
    if (!contestantName || !costumeName) return;
    if (remoteMode) {
      setActionError("");
      const response = await fetch("/api/organizer/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contestantName, costumeName, category: newCategory, isGroup: newIsGroup }),
      });
      const result = await response.json();
      if (!response.ok) { setActionError(result.error ?? "Could not add the contestant."); return; }
      setEntries((previous) => { const next = [...previous]; next.splice(result.position ?? next.length, 0, result.entry); return next; });
      setOrganizerResults((previous) => [...previous, { ...result.entry, votes: 0, average: null }]);
      setNewContestantName("");
      setNewCostumeName("");
      setNewIsGroup(false);
      setNotice(`${contestantName} as ${costumeName} added to ${CATEGORY_LABELS[newCategory]}.`);
      return;
    }
    if (categoryCounts[newCategory] >= SLOT_LIMIT[newCategory]) { setActionError(`${CATEGORY_LABELS[newCategory]} is full (${SLOT_LIMIT[newCategory]} slots).`); return; }
    const entry: Entry = { id: makeUuid(), contestantName, costumeName, category: newCategory, isGroup: newCategory === "Group" || newIsGroup };
    setEntries((previous) => {
      const next = [...previous];
      let insertAt = 0;
      next.forEach((candidate, index) => { if (categoryRank(candidate.category) <= categoryRank(entry.category)) insertAt = index + 1; });
      next.splice(insertAt, 0, entry);
      return next;
    });
    setNewContestantName("");
    setNewCostumeName("");
    setNewIsGroup(false);
    setNotice(`${contestantName} as ${costumeName} added to ${CATEGORY_LABELS[newCategory]}.`);
  }

  async function deleteEntry(entry: Entry) {
    const displayName = `${entry.contestantName} as ${entry.costumeName}`;
    const confirmed = window.confirm(`Delete ${displayName}? This also permanently deletes all votes for this costume.`);
    if (!confirmed) return;
    setActionError("");
    if (remoteMode) {
      const response = await fetch("/api/organizer/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: entry.id }),
      });
      const result = await response.json();
      if (!response.ok) { setActionError(result.error ?? "Could not delete the costume."); return; }
    }
    setEntries((previous) => previous.filter((candidate) => candidate.id !== entry.id));
    setOrganizerResults((previous) => previous.filter((candidate) => candidate.id !== entry.id));
    setVotes((previous) => previous.filter((vote) => vote.entryId !== entry.id));
    if (currentEntryId === entry.id) {
      setCurrentEntryId(null);
      setStatus("waiting");
      setHasVoted(false);
      setSelectedScore(null);
    }
    if (lastEntryId === entry.id) setLastEntryId(null);
    setNotice(`${displayName} deleted.`);
  }

  async function moveEntry(entryId: string, direction: -1 | 1) {
    const fromIndex = entries.findIndex((entry) => entry.id === entryId);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= entries.length) return;

    const reordered = [...entries];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    setEntries(reordered);
    setActionError("");
    if (!remoteMode) return;

    try {
      const response = await fetch("/api/organizer/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: reordered.map((entry) => entry.id) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the planned order.");
    } catch (error) {
      setEntries(entries);
      setActionError(error instanceof Error ? error.message : "Could not save the planned order.");
    }
  }

  // The host desk lives at /host. Check the sign-in cookie once the live connection is up.
  useEffect(() => {
    if (mode !== "organizer" || !remoteMode) return;
    let cancelled = false;
    void fetch("/api/organizer/results", { cache: "no-store" }).then(async (response) => {
      if (cancelled) return;
      setOrganizerAuthed(response.ok);
      if (response.ok) setOrganizerResults((await response.json()).results ?? []);
    });
    return () => { cancelled = true; };
  }, [mode, remoteMode]);

  async function signInOrganizer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    const response = await fetch("/api/organizer/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: loginPassword }),
    });
    const result = await response.json();
    if (!response.ok) { setLoginError(result.error ?? "Could not sign in."); return; }
    setOrganizerAuthed(true);
    setLoginPassword("");
    await loadOrganizerResults();
  }

  return (
    <main className="party-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <a className="brand" href="#home" aria-label="Costume Party home">
          <span className="brand-mark">🎃</span>
          <span>Costume <b>Party</b></span>
        </a>
        <div className="connection-pill"><span className="status-dot" /> {notice}</div>
        {mode === "organizer" && <nav className="mode-switch" aria-label="Pages">
          <Link className="selected" href="/host">Host desk</Link>
          <Link href="/" target="_blank" rel="noreferrer">Guest view ↗</Link>
        </nav>}
      </header>

      {mode === "audience" ? (
        <section className="audience-view" id="home">
          <div className="audience-masthead"><span>HALLOWEEN COSTUME WALK</span><span className="live-tag"><i /> LIVE</span></div>
          <div className="category-rail" aria-label="Costume categories">
            {categories.map((category) => {
              const activeCategory = status === "waiting" ? upNextEntries[0]?.category : currentEntry?.category;
              const categoryEmoji: Record<Category, string> = { Funniest: "🤡", Prettiest: "🦋", Group: "👯", Scariest: "👹" };
              return <span key={category} className={`rail-category ${activeCategory === category ? "active" : ""}`}><i>{categoryEmoji[category]}</i>{CATEGORY_LABELS[category]}</span>;
            })}
          </div>
          {status === "waiting" || !currentEntry ? (
            <div className="waiting-card">
              <div className="waiting-copy">
                <span className="small-label">STANDBY</span>
                <h1>Wait a moment...</h1>
                <p className="judges-word">judges</p>
                <p className="instruction">The next contestant is getting ready.<br />Keep this page open.</p>
                {upNextEntries[0] && <div className="next-preview"><small>UP NEXT · {slots.get(upNextEntries[0].id)}{upNextEntries[0].isGroup ? " · GROUP" : ""}</small><strong>{upNextEntries[0].contestantName}</strong><span>as {upNextEntries[0].costumeName}</span></div>}
              </div>
              <div className="waiting-web-mark" aria-hidden="true">✳</div>
            </div>
          ) : (
            <div className="vote-card">
              <div className="vote-topline"><div className="walking-label"><small>NOW WALKING</small><span className={`category-chip ${currentEntry.category.toLowerCase()}`}>{CATEGORY_LABELS[currentEntry.category]}</span></div><span className={`vote-clock ${remaining <= 5 ? "urgent" : ""}`} aria-label={`${remaining} seconds remaining`}><small>TIME LEFT</small><b>{remaining} s</b></span></div>
              <div className="vote-heading">
                <div className="vote-title">
                  <div className="contestant-tags"><span className="slot-tag">{slots.get(currentEntry.id)}</span>{currentEntry.isGroup && <span className="group-tag">GROUP</span>}</div>
                  <p><span className="contestant-highlight">{currentEntry.contestantName}</span> <i>as</i></p>
                  <h1><span className="costume-highlight">{currentEntry.costumeName}</span></h1>
                </div>
              </div>
              <div className="score-panel">
                <div className="score-prompt"><b>TAP A PUMPKIN TO VOTE</b><small>YOU CAN CHANGE IT UNTIL TIME&apos;S UP</small></div>
                <div className="score-row" aria-label="Choose a score from one to five pumpkins">
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button key={score} className={`pumpkin-button ${selectedScore === score ? "selected" : ""} ${selectedScore !== null && score < selectedScore ? "prior-lit" : ""}`} onClick={() => void submitVote(score)} disabled={status !== "voting"} aria-pressed={selectedScore === score} aria-label={`${PUMPKIN_LABELS[score - 1]}, ${score} out of 5`}>
                      <span>🎃</span><small>{score}</small><em className="pumpkin-label">{PUMPKIN_LABELS[score - 1]}</em>
                    </button>
                  ))}
                </div>
              </div>
              {hasVoted && selectedScore !== null && <div className="thank-you"><span>🕯️</span><div><b>Your vote: {PUMPKIN_LABELS[selectedScore - 1]}</b><small>Tap another pumpkin to change it</small></div></div>}
              {actionError && <p className="form-error">{actionError}</p>}
              <div className="live-footer">
                <div className="vote-count"><small>VOTES</small><b>{displayedVoteCount}</b></div>
              </div>
              {status === "paused" && <div className="pause-overlay"><span>Ⅱ</span><b>Voting paused</b><small>Please wait for the organizer.</small></div>}
            </div>
          )}
        </section>
      ) : (
        <section className="organizer-view">
          <div className="organizer-intro"><div><span className="small-label">CONTROL ROOM</span><h1>Organizer <em>desk</em></h1><p>Run the walk one costume at a time.</p></div><div className="preview-badge"><span /> {remoteMode ? organizerAuthed ? "ORGANIZER SIGNED IN" : "SIGN-IN REQUIRED" : "PREVIEW CONTROLS"}</div></div>
          {remoteMode && !organizerAuthed ? (
            <div className="organizer-grid"><div className="control-card login-card"><span className="small-label">PRIVATE ORGANIZER ACCESS</span><h2>Sign in to run the event</h2><p>Enter the organizer password configured on the MacBook.</p><form className="add-form" onSubmit={signInOrganizer}><label htmlFor="organizer-password">Password</label><input id="organizer-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} /><button className="primary-control" type="submit">Unlock controls</button>{loginError && <p className="form-error">{loginError}</p>}</form></div></div>
          ) : <div className="organizer-grid">
            <div className="control-card">
              <div className="card-heading"><div><span className="small-label">CURRENT SESSION</span><h2>{currentEntry ? <>{currentEntry.contestantName} <i>as</i> {currentEntry.costumeName}</> : "Waiting to begin"}</h2></div><span className={`session-status ${status}`}>{status}</span></div>
              <div className="control-current">
                <div className="session-category">{currentEntry ? <><span className={`category-chip ${currentEntry.category.toLowerCase()}`}>{CATEGORY_LABELS[currentEntry.category]}</span> <span className="slot-tag">{slots.get(currentEntry.id)}</span>{currentEntry.isGroup && <span className="group-tag">GROUP</span>}</> : <span className="category-chip">No active category</span>}</div>
                <div className="big-timer">00:{String(remaining).padStart(2, "0")}<small> seconds</small></div>
                <div className="organizer-stats"><div><small>AVERAGE SCORE</small><b>{displayedVoteCount ? displayedAverage.toFixed(2) : "—"}<span> / 5</span></b></div><div><small>VOTES RECEIVED</small><b>{displayedVoteCount}</b></div></div>
              </div>
              <div className="control-buttons">
                {status === "voting" || status === "paused" ? <button className="secondary-control" onClick={() => void pauseOrResume()}>{status === "paused" ? "▶  Resume voting" : "Ⅱ  Pause voting"}</button> : <button className="primary-control" onClick={() => void stopSession()} disabled={!currentEntry}>■  End session</button>}
                {status !== "voting" && status !== "paused" && <span className="control-hint">Choose a contestant below to start a {ROUND_SECONDS}-second round.</span>}
              </div>
              {actionError && <p className="form-error">{actionError}</p>}
              <p className="organizer-note">Only this desk sees the average. Guests see the costume, the timer and their own vote, which they can change until time&apos;s up.</p>
            </div>

            <div className="add-card">
              <div className="card-heading"><div><span className="small-label">QUICK ADD</span><h2>Add a costume</h2></div><span className="sparkle-icon">✦</span></div>
              <form onSubmit={(event) => void addEntry(event)} className="add-form">
                <label htmlFor="contestant-name">Contestant name</label>
                <input id="contestant-name" value={newContestantName} onChange={(event) => setNewContestantName(event.target.value)} placeholder="e.g. Alex Smith" maxLength={60} required />
                <label htmlFor="costume-name">Costume name</label>
                <input id="costume-name" value={newCostumeName} onChange={(event) => setNewCostumeName(event.target.value)} placeholder="e.g. The Velvet Vampire" maxLength={60} required />
                <label htmlFor="category">Category</label>
                <select id="category" value={newCategory} onChange={(event) => setNewCategory(event.target.value as Category)}>{categories.map((category) => <option key={category} value={category} disabled={categoryCounts[category] >= SLOT_LIMIT[category]}>{CATEGORY_LABELS[category]} ({categoryCounts[category]}/{SLOT_LIMIT[category]}{categoryCounts[category] >= SLOT_LIMIT[category] ? " · full" : ""})</option>)}</select>
                <label className="group-check"><input type="checkbox" checked={newCategory === "Group" || newIsGroup} disabled={newCategory === "Group"} onChange={(event) => setNewIsGroup(event.target.checked)} /> This is a group</label>
                <button className="add-button" type="submit">＋ Add contestant</button>
                {actionError && <p className="form-error">{actionError}</p>}
              </form>
            </div>

            <div className="lineup-card planned-order-card">
              <div className="card-heading"><div><span className="small-label">PLANNED ORDER</span><h2>Who walks next</h2></div><span className="lineup-count">{entries.length} entries</span></div>
              <p className="planned-hint">Use the arrows to rearrange the shared queue. The first upcoming contestant appears on attendee screens.</p>
              <div className="planned-order-list">
                {entries.length ? entries.map((entry, index) => {
                  const result = getEntryResult(entry.id);
                  const isActive = entry.id === currentEntryId && (status === "voting" || status === "paused");
                  return <div className={`planned-row ${entry.id === currentEntryId ? "current" : ""}`} key={entry.id}>
                    <span className="lineup-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="planned-person"><span className="slot-tag">{slots.get(entry.id)}</span><span className={`category-chip ${entry.category.toLowerCase()}`}>{CATEGORY_LABELS[entry.category]}</span>{entry.isGroup && <span className="group-tag">GROUP</span>}<b>{entry.contestantName}</b><small>as {entry.costumeName}{isActive ? " · LIVE" : ""}</small></span>
                    <span className="lineup-result"><b>{result?.average == null ? "—" : result.average.toFixed(2)}</b><small>{result?.votes ?? 0} votes</small></span>
                    <div className="planned-actions">
                      <div className="reorder-buttons"><button type="button" onClick={() => void moveEntry(entry.id, -1)} disabled={index === 0} aria-label={`Move ${entry.contestantName} up`} title="Move up">↑</button><button type="button" onClick={() => void moveEntry(entry.id, 1)} disabled={index === entries.length - 1} aria-label={`Move ${entry.contestantName} down`} title="Move down">↓</button></div>
                      <button className="start-button" onClick={() => void startEntry(entry)} disabled={status === "voting" || status === "paused"}>{isActive ? "LIVE" : "Start"}</button>
                      <button className="delete-button" type="button" onClick={() => void deleteEntry(entry)} disabled={isActive} title={isActive ? "End this round before deleting the active costume" : `Delete ${entry.contestantName} as ${entry.costumeName}`} aria-label={`Delete ${entry.contestantName} as ${entry.costumeName}`}>Delete</button>
                    </div>
                  </div>;
                }) : <p className="empty-category">Add a contestant to build the walk order.</p>}
              </div>
              <p className="lineup-footnote">Order changes update the attendee ticker. Vote totals stay beside each contestant.</p>
            </div>
          </div>}
        </section>
      )}

      {mode === "audience" && <div className="broadcast-ticker" aria-label="Upcoming contestants">
        <span className="ticker-label">UP NEXT</span>
        <div className="ticker-window">
          {upNextEntries.length ? <div className="ticker-track">{[0, 1].map((copy) => <div className="ticker-set" key={copy} aria-hidden={copy === 1}>{upNextEntries.map((entry) => <span className="ticker-entry" key={`${copy}-${entry.id}`}><span className="slot-tag">{slots.get(entry.id)}</span><b>{entry.contestantName}</b><i>as</i><strong>{entry.costumeName}</strong>{entry.isGroup && <span className="group-tag">GROUP</span>}<em>{CATEGORY_LABELS[entry.category]}</em></span>)}</div>)}</div> : <span className="ticker-empty">The next contestant is getting ready</span>}
        </div>
      </div>}

      <footer className="page-footer"><span>MADE FOR A LITTLE HALLOWEEN MAGIC</span><span>✦</span><span>ONE VOTE PER COSTUME</span><span className="footer-spacer" /><span>ROOM 13 · COSTUME PARTY</span></footer>
    </main>
  );
}
