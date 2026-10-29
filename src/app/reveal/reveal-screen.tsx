"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, SLOT_PREFIX, type Category } from "@/lib/event-config";

type Result = { id: string; contestantName: string; costumeName: string; category: Category; isGroup: boolean; votes: number; average: number | null };
type Contestant = { id: string; slot: string; name: string; costume: string; isGroup: boolean; score: number; votes: number; walk: number };
type Round = { key: string; title: string; note: string; lineup: Contestant[]; top: Contestant[] };
type Step = "lineup" | "count" | "stage" | "third" | "duel";

const STAGGER = 0.8;
const COUNT = 1.4;
const THIRD = 2.5;
const LINEUP_MAX = 8;

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const fmt = (value: number) => value.toFixed(2);

// Tie rule: higher average wins, then more votes, then whoever walked first.
function rank(list: Contestant[]) {
  return [...list].sort((a, b) => b.score - a.score || b.votes - a.votes || a.walk - b.walk);
}

function buildRounds(results: Result[]): Round[] {
  const seen: Partial<Record<Category, number>> = {};
  const contestants = results.map((result, walk) => {
    const position = (seen[result.category] ?? 0) + 1;
    seen[result.category] = position;
    return { id: result.id, slot: `${SLOT_PREFIX[result.category]}${position}`, name: result.contestantName, costume: result.costumeName, isGroup: result.isGroup, score: result.average ?? 0, votes: result.votes, walk, category: result.category };
  });

  const rounds: Round[] = [];
  const winners = new Set<string>();
  for (const category of CATEGORIES) {
    const list = contestants.filter((contestant) => contestant.category === category);
    if (!list.length) continue;
    const top = rank(list).slice(0, 3);
    winners.add(top[0].id);
    rounds.push({ key: category, title: CATEGORY_LABELS[category], note: `${list.length} costume${list.length === 1 ? "" : "s"}, in walk order`, lineup: list, top });
  }

  // Best Solo: the highest-scoring solo costume that didn't already win a category.
  const eligible = rank(contestants.filter((contestant) => !contestant.isGroup && !winners.has(contestant.id) && contestant.votes > 0));
  if (eligible.length) {
    const lineup = eligible.slice(0, LINEUP_MAX).sort((a, b) => a.walk - b.walk);
    rounds.push({ key: "solo", title: "Best Solo", note: "Top solo scores from contestants who didn't win a category", lineup, top: eligible.slice(0, 3) });
  }
  return rounds;
}

function stepsFor(round: Round): Step[] {
  return round.top.length >= 3 ? ["lineup", "count", "stage", "third", "duel"] : ["lineup", "count", "stage", "duel"];
}

const NEXT_LABEL: Record<Step, string> = { lineup: "Count the scores →", count: "Show the top 3 →", stage: "Reveal 3rd place →", third: "Reveal the winner →", duel: "Next category →" };

const DEMO: Result[] = [
  ["El", "hella tall man", "Funniest", false, 4.61], ["CJ", "himself", "Funniest", false, 4.68], ["Morad and the gang", "Shaun The Sheeps", "Funniest", true, 4.21], ["Averina Subianto", "Pirates of The Caribbean", "Funniest", false, 3.87],
  ["Dina", "Mermaid Queen", "Prettiest", false, 4.4], ["Sari", "Corpse Bride", "Prettiest", false, 4.7], ["Tia", "Moth Fairy", "Prettiest", false, 3.6], ["Lala", "Glam Witch", "Prettiest", false, 4.65],
  ["The Addams crew", "The Addams Family", "Group", true, 4.55], ["Squad Ghoul", "Ghostbusters", "Group", true, 4.5], ["Office 3B", "Zombie Office", "Group", true, 3.8],
  ["reno", "himself", "Scariest", false, 2.0], ["Bima", "Pennywise", "Scariest", false, 4.72], ["Yoga", "Plague Doctor", "Scariest", false, 4.69], ["Nanda", "Pocong", "Scariest", false, 4.3],
].map(([contestantName, costumeName, category, isGroup, average], index) => ({ id: `demo-${index}`, contestantName, costumeName, category, isGroup, average, votes: 180 } as Result));

export default function RevealScreen() {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [problem, setProblem] = useState<"signin" | "error" | "empty" | null>(null);
  const [demo, setDemo] = useState(false);
  const [duelSeconds, setDuelSeconds] = useState(10);
  const [position, setPosition] = useState({ round: 0, step: 0, t0: 0 });
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const seconds = Number(params.get("duel"));
    if (seconds >= 3 && seconds <= 30) setDuelSeconds(seconds);
    if (params.has("demo")) {
      setDemo(true);
      setRounds(buildRounds(DEMO));
      return;
    }
    const response = await fetch("/api/organizer/results", { cache: "no-store" }).catch(() => null);
    if (!response || response.status === 401) { setProblem(response ? "signin" : "error"); return; }
    if (!response.ok) { setProblem("error"); return; }
    const built = buildRounds((await response.json()).results ?? []);
    setProblem(built.length ? null : "empty");
    setRounds(built);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let frame = 0;
    const loop = () => { setNow(performance.now()); frame = requestAnimationFrame(loop); };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const finished = rounds !== null && position.round >= rounds.length;
  const round = rounds && !finished ? rounds[position.round] : null;
  const steps = useMemo(() => (round ? stepsFor(round) : []), [round]);
  const step = steps[position.step];

  const go = useCallback((roundIndex: number, stepIndex: number) => setPosition({ round: roundIndex, step: stepIndex, t0: performance.now() }), []);
  const next = useCallback(() => {
    if (!rounds) return;
    if (finished) go(0, 0);
    else if (position.step < steps.length - 1) go(position.round, position.step + 1);
    else go(position.round + 1, 0);
  }, [rounds, finished, position, steps.length, go]);
  const back = useCallback(() => {
    if (!rounds) return;
    if (finished) go(rounds.length - 1, stepsFor(rounds[rounds.length - 1]).length - 1);
    else if (position.step > 0) go(position.round, position.step - 1);
    else if (position.round > 0) go(position.round - 1, stepsFor(rounds[position.round - 1]).length - 1);
  }, [rounds, finished, position, go]);
  const replay = useCallback(() => go(position.round, position.step), [go, position]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter" || event.key === "PageDown") { event.preventDefault(); next(); }
      else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); back(); }
      else if (event.key === "r" || event.key === "R") replay();
      else if (event.key === "f" || event.key === "F") void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, replay]);

  const elapsed = Math.max(0, (now - position.t0) / 1000);

  if (problem === "signin") return <main className="rv-shell rv-message"><h1>Sign in first</h1><p>Open <a href="/host">/host</a> in this browser, unlock it with the host password, then come back to this page.</p><p><a href="/reveal?demo">Or rehearse with sample scores →</a></p></main>;
  if (problem === "error") return <main className="rv-shell rv-message"><h1>Couldn&apos;t load the scores</h1><p>Check the internet connection and reload this page.</p></main>;
  if (problem === "empty") return <main className="rv-shell rv-message"><h1>No contestants yet</h1><p>Add contestants and run the walk at <a href="/host">/host</a> first.</p><p><a href="/reveal?demo">Or rehearse with sample scores →</a></p></main>;
  if (!rounds) return <main className="rv-shell rv-message"><p>Loading the scores…</p></main>;

  const top = round?.top ?? [];
  const [first, second, third] = top;
  const isTop = (contestant: Contestant) => top.some((candidate) => candidate.id === contestant.id);
  const winnerIn = step === "duel" && elapsed >= duelSeconds;
  const headline: Record<Step, [string, string]> = {
    lineup: ["the lineup", round?.note ?? ""],
    count: ["the scores", "Counting up in walk order"],
    stage: [top.length >= 3 ? "the top 3" : `the top ${top.length}`, top.length >= 3 ? "Three left standing" : "Still in the running"],
    third: ["in third place…", "Lowest of the top 3 first"],
    duel: winnerIn && first ? ["the winner!", `${first.name} as ${first.costume}`] : ["and the winner is…", second ? "Two scores, climbing together" : "Here it comes"],
  };
  const isLastRound = position.round === rounds.length - 1;
  const nextLabel = finished ? "Start over" : step === "duel" ? (isLastRound ? "Finish →" : "Next category →") : step === "stage" && top.length < 3 ? "Reveal the winner →" : NEXT_LABEL[step];

  return (
    <main className="rv-shell">
      <header className="rv-top">
        <div className="rv-brand">SCARE <i>to</i> <b>Impress</b></div>
        <div className="rv-progress">
          {rounds.map((candidate, index) => <span key={candidate.key} className={!finished && index === position.round ? "now" : index < position.round ? "done" : ""}>{candidate.title.toUpperCase()}</span>)}
        </div>
      </header>

      {round && step ? (
        <>
          <div className="rv-heading">
            <div><h1>{round.title}</h1><em>{headline[step][0]}</em></div>
            <p>{headline[step][1]}</p>
          </div>

          {step === "lineup" || step === "count" ? (
            <div className="rv-lineup">
              {round.lineup.map((contestant, index) => {
                const start = index * STAGGER;
                const started = step === "count" && elapsed >= start;
                const topHit = started && isTop(contestant);
                const counting = started && !topHit && elapsed < start + COUNT;
                const value = started && !topHit ? contestant.score * easeOut((elapsed - start) / COUNT) : 0;
                return (
                  <div key={contestant.id} className={`rv-row ${topHit ? "top" : counting ? "counting" : ""}`}>
                    <span className="rv-slot">{contestant.slot}</span>
                    <div className="rv-row-main">
                      <div className="rv-row-name">{contestant.name} <i>as</i> <b>{contestant.costume}</b></div>
                      <div className="rv-bar"><span className={topHit ? "hatched" : ""} style={{ width: `${((topHit ? 5 : value) / 5) * 100}%` }} /></div>
                    </div>
                    <div className={`rv-row-score ${topHit ? "top" : started ? "live" : ""}`}>{topHit ? "TOP 3" : started ? fmt(value) : "—"}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rv-stage" style={{ gridTemplateColumns: `repeat(${top.length}, minmax(0, 1fr))` }}>
              {[...top].sort((a, b) => a.walk - b.walk).map((contestant) => {
                let value: number | null = null;
                let badge = "";
                let settled = false;
                if (third && contestant.id === third.id && (step === "third" || step === "duel")) {
                  value = step === "third" ? contestant.score * easeOut(elapsed / THIRD) : contestant.score;
                  settled = step === "duel" || elapsed >= THIRD;
                  if (settled) badge = "3rd place";
                }
                if (step === "duel" && contestant.id !== third?.id && first) {
                  const shared = first.score * easeOut(elapsed / duelSeconds);
                  value = Math.min(contestant.score, shared);
                  settled = contestant.id === first.id ? elapsed >= duelSeconds : shared >= contestant.score && elapsed > 0.3;
                  if (settled) badge = contestant.id === first.id ? "WINNER" : "2nd place";
                }
                const live = value !== null && !settled;
                const winner = settled && contestant.id === first?.id;
                const out = step === "duel" && contestant.id === third?.id;
                return (
                  <div key={contestant.id} className={`rv-card ${winner ? "winner" : live ? "live" : ""} ${out ? "out" : ""}`}>
                    <div className="rv-card-top"><span className="rv-slot">{contestant.slot}</span>{badge && <span className={`rv-badge ${winner ? "winner" : ""}`}>{badge}</span>}</div>
                    <div className="rv-card-name"><span>{contestant.name}</span><i>as</i><b>{contestant.costume}</b></div>
                    <div className="rv-card-score">
                      <div className={`rv-big ${value === null ? "hidden" : ""} ${live && step === "duel" ? "glow" : ""}`}>{value === null ? "?.??" : fmt(value)}<small> / 5</small></div>
                      <div className="rv-bar thick"><span style={{ width: `${((value ?? 0) / 5) * 100}%` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="rv-end"><h1>Happy Halloween</h1><p>Congratulations to every winner, and thanks for judging.</p></div>
      )}

      <footer className="rv-controls">
        <span>{demo ? "Rehearsal · sample scores" : "Live scores"} · → next · ← back · R replay · F full screen</span>
        <div>
          <button type="button" onClick={back}>← Back</button>
          <button type="button" onClick={replay}>Replay step</button>
          {!demo && <button type="button" onClick={() => { void load(); go(position.round, position.step); }}>Reload scores</button>}
          <button type="button" className="primary" onClick={next}>{nextLabel}</button>
        </div>
      </footer>
    </main>
  );
}
