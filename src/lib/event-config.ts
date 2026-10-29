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
