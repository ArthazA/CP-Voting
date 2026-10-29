"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES, CATEGORY_LABELS, HOST_TOPIC, LIVE_TOPIC, PUMPKIN_LABELS, REACTIONS, ROUND_SECONDS, SLOT_LIMIT, SLOT_PREFIX, categoryRank, type Category, type ReactionCounts, type ReactionKind } from "@/lib/event-config";

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
// Taps are bundled on the phone and sent about once a second, so guests can spam freely.
const REACTION_SEND_MS = 900;
// If the live connection can't be made (e.g. Supabase's connection cap), check in on this interval instead.
const FALLBACK_POLL_MS = 3000;
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
  const [entries, setEntries] = useState<Entry[]>([]);
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
  const [, setHasVoted] = useState(false);
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [newContestantName, setNewContestantName] = useState("");
  const [newCostumeName, setNewCostumeName] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("Funniest");
  const [newIsGroup, setNewIsGroup] = useState(false);
  const resultsRefresh = useRef<number | null>(null);
  const currentEntryRef = useRef<string | null>(null);
  const pendingReactions = useRef<ReactionCounts>({});
  const reactionTimer = useRef<number | null>(null);
  const burstId = useRef(0);
  const [reactionBursts, setReactionBursts] = useState<{ id: number; emoji: string; x: number }[]>([]);
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
    let supabase: ReturnType<typeof createClient> | null = null;
    let pollTimer: number | null = null;
    let fallbackTimer: number | null = null;
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
    const startPolling = () => { pollTimer ??= window.setInterval(() => { void loadState(); }, FALLBACK_POLL_MS); };
    const stopPolling = () => { if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; } };

    const onVotesUpdated = ({ payload }: { payload: { entry_id?: string; vote_count?: number } }) => {
      setLiveVoteCount(Number(payload.vote_count ?? 0));
      setOrganizerResults((previous) => previous.map((result) => result.id === payload.entry_id
        ? { ...result, votes: Number(payload.vote_count ?? 0) }
        : result));
      // The broadcast carries no average, so the host desk re-fetches it, at most once a second.
      if (resultsRefresh.current === null) {
        resultsRefresh.current = window.setTimeout(() => {
          resultsRefresh.current = null;
          void loadState();
          void loadOrganizerResults();
        }, 1000);
      }
    };

    void loadState().then((connected) => {
      if (cancelled) return;
      if (!connected) { setEntries(starterEntries); return; }
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) { startPolling(); return; }
      supabase = createClient(url, key);
      const liveChannel = supabase
        .channel(LIVE_TOPIC, { config: { private: false } })
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
        .on("broadcast", { event: "entries_updated" }, () => { void loadState(); });
      // Until migration 0005 runs, vote counts still arrive on the shared topic; the host desk listens on both.
      if (mode === "organizer") liveChannel.on("broadcast", { event: "votes_updated" }, onVotesUpdated);
      liveChannel.subscribe((connectionStatus) => {
        if (connectionStatus === "SUBSCRIBED") { stopPolling(); void loadState(); }
        else startPolling();
      });
      // A phone that still isn't connected after a few seconds checks in on a timer instead.
      fallbackTimer = window.setTimeout(() => {
        const live = supabase?.getChannels().some((channel) => channel.state === "joined");
        if (!live) startPolling();
      }, 6000);
      if (mode === "organizer") {
        supabase.channel(HOST_TOPIC, { config: { private: false } }).on("broadcast", { event: "votes_updated" }, onVotesUpdated).subscribe();
      }
    });

    return () => {
      cancelled = true;
      stopPolling();
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (supabase) void supabase.removeAllChannels();
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

  function flushReactions() {
    reactionTimer.current = null;
    const counts = pendingReactions.current;
    pendingReactions.current = {};
    if (!remoteMode || !Object.keys(counts).length) return;
    void fetch("/api/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ counts }), keepalive: true }).catch(() => {});
  }

  function sendReaction(kind: ReactionKind, emoji: string) {
    if (!currentEntry) return;
    pendingReactions.current[kind] = (pendingReactions.current[kind] ?? 0) + 1;
    reactionTimer.current ??= window.setTimeout(flushReactions, REACTION_SEND_MS);
    // A little burst on the phone so every tap feels like it landed.
    burstId.current += 1;
    const id = burstId.current;
    setReactionBursts((previous) => [...previous.slice(-14), { id, emoji, x: 10 + ((id * 37) % 80) }]);
    window.setTimeout(() => setReactionBursts((previous) => previous.filter((burst) => burst.id !== id)), 1200);
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

  if (mode === "audience") {
    const timeUp = status === "waiting" && currentEntry !== null;
    const live = (status === "voting" || status === "paused") && currentEntry !== null;
    const tickerEntries = live ? [currentEntry, ...upNextEntries] : upNextEntries;
    const urgent = status === "voting" && remaining <= 3;
    const timerSeconds = live ? remaining : timeUp ? 0 : ROUND_SECONDS;
    const categoryEmoji: Record<Category, string> = { Funniest: "🤡", Prettiest: "🦋", Group: "👯", Scariest: "😈" };
    const shownCategory = live || timeUp ? currentEntry?.category : upNextEntries[0]?.category;
    return (
      <main className="sti-shell">
        <header className="sti-header">
          <div className="sti-brand" aria-label="Scare to Impress"><span>SCARE <i>to</i></span><b>Impress</b></div>
          <span className="sti-live">LIVE</span>
        </header>

        <div className="sti-now">
          <div className="sti-now-label">
            <small>{live ? "NOW WALKING" : timeUp ? "JUST WALKED" : "UP NEXT"}</small>
            {shownCategory && <span className="sti-category">{CATEGORY_LABELS[shownCategory]} {categoryEmoji[shownCategory]}</span>}
          </div>
          <div className={`sti-timer ${urgent ? "urgent" : ""}`} aria-label={`${timerSeconds} seconds ${live ? "remaining" : "per round"}`}>
            <small>Time Left</small>
            <b>{timerSeconds} s</b>
          </div>
        </div>

        {live && currentEntry ? (
          <section className="sti-stage">
            <div className="sti-tags"><span className="slot-tag">{slots.get(currentEntry.id)}</span>{currentEntry.isGroup && <span className="group-tag">GROUP</span>}</div>
            <p className="sti-name">{currentEntry.contestantName}</p>
            <p className="sti-as">as</p>
            <h1 className="sti-costume">{currentEntry.costumeName}</h1>

            <div className="sti-vote-head">
              <b>Tap to Vote</b>
              <span>{selectedScore ? <>you chose <strong>{PUMPKIN_LABELS[selectedScore - 1]}</strong></> : <>meh → WOW!!!</>}</span>
            </div>
            <div className="sti-pumpkins" role="group" aria-label="Choose a score from one to five pumpkins">
              {[1, 2, 3, 4, 5].map((score) => (
                <button key={score} type="button" className={`sti-pumpkin ${selectedScore !== null && score <= selectedScore ? "lit" : ""} ${selectedScore === score ? "picked" : ""} ${selectedScore === null ? "idle" : ""}`} onClick={() => void submitVote(score)} disabled={status !== "voting"} aria-pressed={selectedScore === score} aria-label={`${PUMPKIN_LABELS[score - 1]}, ${score} out of 5`}>
                  <span aria-hidden="true">🎃</span>
                </button>
              ))}
            </div>
            <p className="sti-vote-note">{selectedScore ? "Saved. Tap another pumpkin to change it until time's up." : "Your vote counts the moment you tap."}</p>
            {actionError && <p className="sti-error">{actionError}</p>}

            <div className="sti-react">
              <b>React on The Big Screen</b>
              <div className="sti-react-row">
                {REACTIONS.map((reaction) => (
                  <button key={reaction.kind} type="button" className="sti-react-button" onClick={() => sendReaction(reaction.kind, reaction.emoji)} aria-label={`Send ${reaction.label} to the big screen`}>
                    <span aria-hidden="true">{reaction.emoji}</span>
                  </button>
                ))}
              </div>
              <small>Tap as much as you like · reactions don&apos;t count as votes</small>
              <div className="sti-bursts" aria-hidden="true">{reactionBursts.map((burst) => <span key={burst.id} style={{ left: `${burst.x}%` }}>{burst.emoji}</span>)}</div>
            </div>

            {status === "paused" && <div className="sti-paused"><b>Voting paused</b><small>Hold on, the host will resume in a moment.</small></div>}
          </section>
        ) : timeUp && currentEntry ? (
          <section className="sti-stage">
            <div className="sti-tags"><span className="slot-tag">{slots.get(currentEntry.id)}</span>{currentEntry.isGroup && <span className="group-tag">GROUP</span>}</div>
            <p className="sti-name">{currentEntry.contestantName}</p>
            <p className="sti-as">as</p>
            <h1 className="sti-costume">{currentEntry.costumeName}</h1>
            <div className="sti-locked">
              <small>TIME&apos;S UP · VOTE LOCKED</small>
              {selectedScore ? <><span>Your vote</span><b>{PUMPKIN_LABELS[selectedScore - 1]}</b><span>{selectedScore} of 5 pumpkins</span></> : <><b>No vote</b><span>Catch the next one!</span></>}
            </div>
            <p className="sti-vote-note">Winners are revealed at the end of the night.</p>
          </section>
        ) : (
          <section className="sti-stage sti-waiting">
            <h1>Wait a moment, <i>judges</i></h1>
            <p>The next contestant is getting ready. Keep this page open and it&apos;ll update by itself.</p>
          </section>
        )}

        <div className="sti-ticker" aria-label="Upcoming contestants">
          <span className="sti-ticker-label">UP NEXT</span>
          <div className="sti-ticker-window">
            {tickerEntries.length ? (
              <div className="sti-ticker-track">
                {[0, 1].map((copy) => (
                  <div className="sti-ticker-set" key={copy} aria-hidden={copy === 1}>
                    {tickerEntries.map((entry) => entry && (
                      <span className="sti-ticker-entry" key={`${copy}-${entry.id}`}>
                        <span className="sti-ticker-slot">{slots.get(entry.id)}</span>{entry.contestantName} <i>as</i> <b>{entry.costumeName}</b><em>|</em>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ) : <span className="sti-ticker-entry">The next contestant is getting ready</span>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="party-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <Link className="brand" href="/host" aria-label="Scare to Impress host desk">
          <span className="brand-mark">🎃</span>
          <span>Scare to <b>Impress</b></span>
        </Link>
        <div className="connection-pill"><span className="status-dot" /> {notice}</div>
        <nav className="mode-switch" aria-label="Pages">
          <Link className="selected" href="/host">Host desk</Link>
          <Link href="/" target="_blank" rel="noreferrer">Guest view ↗</Link>
          <Link href="/live" target="_blank" rel="noreferrer">Live screen ↗</Link>
          <Link href="/reveal" target="_blank" rel="noreferrer">Reveal ↗</Link>
        </nav>
      </header>

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

      <footer className="page-footer"><span>SCARE TO IMPRESS · HOST DESK</span><span className="footer-spacer" /><span>GUESTS VOTE AT THE MAIN PAGE</span></footer>
    </main>
  );
}
