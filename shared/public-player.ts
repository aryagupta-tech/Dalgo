import type { Arena, Mode, Rating } from "./types";

export interface PublicPlayerIdentity {
  id: string;
  username: string;
  name: string;
  avatar?: string;
}

export interface RankedRating extends Rating {
  rank: number | null;
}

export interface PublicPlayerProfile {
  player: PublicPlayerIdentity;
  ratings: RankedRating[];
  record: { matches: number; wins: number; losses: number; draws: number };
}

export interface PublicPlayerMatch {
  id: string;
  arena: Arena;
  mode: Mode;
  endedAt: string;
  outcome: "win" | "loss" | "draw" | "void";
  ratingDelta: number;
  opponent: PublicPlayerIdentity | null;
}

export interface PublicPlayerHistory {
  matches: PublicPlayerMatch[];
  nextCursor: string | null;
}
