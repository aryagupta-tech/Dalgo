import type {
  Arena,
  Language,
  Mode,
  PublicProblem,
  Result,
  Verdict,
} from "./types";

export interface PublicReviewSubmission {
  id: string;
  language: Language;
  verdict: Verdict;
  receivedAt: number;
  sequence: number;
  source?: string;
}

export interface PublicReviewPlayer {
  id: string;
  name: string;
  avatar?: string;
  rating: number;
  isBot: boolean;
  submissions: PublicReviewSubmission[];
}

export interface PublicMatchReview {
  id: string;
  arena: Arena;
  mode: Mode;
  startsAt: number;
  endsAt: number;
  problem: PublicProblem;
  result: Result;
  players: PublicReviewPlayer[];
  codeStatus: "available" | "expired" | "not_available";
}
