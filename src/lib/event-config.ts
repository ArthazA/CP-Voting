// Shared by the API routes and the browser, so keep this free of server-only imports.
export const ROUND_SECONDS = 10;

// Walk order for the night. New contestants are slotted into this order automatically.
export const CATEGORIES = ["Funniest", "Prettiest", "Group", "Scariest"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = { Funniest: "Funniest", Prettiest: "Prettiest", Group: "Best Group", Scariest: "Scariest" };
export const SLOT_PREFIX: Record<Category, string> = { Funniest: "F", Prettiest: "P", Group: "G", Scariest: "S" };
export const SLOT_LIMIT: Record<Category, number> = { Funniest: 8, Prettiest: 8, Group: 6, Scariest: 8 };

export const PUMPKIN_LABELS = ["meh", "ok", "nice", "love it", "WOW!!!"] as const;

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export function categoryRank(category: string) {
  const rank = (CATEGORIES as readonly string[]).indexOf(category);
  return rank < 0 ? CATEGORIES.length : rank;
}

// Guest reactions shown on the live big screen. They are never stored and never count as votes.
export const REACTIONS = [
  { kind: "ghost", emoji: "👻", label: "Spooky" },
  { kind: "fire", emoji: "🔥", label: "Fire" },
  { kind: "heart", emoji: "🖤", label: "Love" },
  { kind: "skull", emoji: "💀", label: "Dead" },
  { kind: "clap", emoji: "👏", label: "Applause" },
] as const;
export type ReactionKind = (typeof REACTIONS)[number]["kind"];
export type ReactionCounts = Partial<Record<ReactionKind, number>>;

export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === "string" && REACTIONS.some((reaction) => reaction.kind === value);
}

// Realtime topics. Guests only join LIVE_TOPIC; vote counts go to the host desk only,
// and reactions go to the big screen only, so 220 phones don't each receive every vote and every tap.
export const LIVE_TOPIC = "costume-party-live";
export const HOST_TOPIC = "costume-party-host";
export const REACTIONS_TOPIC = "costume-party-reactions";
