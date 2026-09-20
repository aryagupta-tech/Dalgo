export type Arena = "easy" | "medium" | "hard";
export type Mode = "human" | "bot";
export type Language = "python" | "cpp" | "java" | "javascript";
export const ARENAS = {
  easy: {
    name: "Easy",
    duration: 600,
    label: "Find your rhythm",
    description: "Build confidence with focused fundamentals.",
    topics: "Arrays · Strings · Hash maps",
    color: "#81cbb5",
  },
  medium: {
    name: "Medium",
    duration: 1200,
    label: "Push your thinking",
    description: "Connect the dots. Find the better approach.",
    topics: "Trees · Graphs · Dynamic programming",
    color: "#7aa2ff",
  },
  hard: {
    name: "Hard",
    duration: 1800,
    label: "Meet your challenge",
    description: "Go deeper on problems that make you think.",
    topics: "Advanced graphs · DP · Optimization",
    color: "#c3a4ee",
  },
} as const;
export const LANGUAGES: Record<Language, { name: string; monaco: string }> = {
  python: { name: "Python", monaco: "python" },
  cpp: { name: "C++", monaco: "cpp" },
  java: { name: "Java", monaco: "java" },
  javascript: { name: "JavaScript", monaco: "javascript" },
};
export interface Example {
  args: unknown[];
  expected: unknown;
  explanation: string;
}
export interface PublicProblem {
  id: string;
  version: number;
  title: string;
  arena: Arena;
  topic: string;
  description: string;
  constraints: string[];
  parameters: { name: string; type: string }[];
  returnType: string;
  examples: Example[];
  starter: Record<Language, string>;
}
export interface Problem extends PublicProblem {
  tests: { args: unknown[]; expected: unknown }[];
  reference: string;
  references: Record<Language, string>;
  complexity: string;
}
export interface Player {
  id: string;
  name: string;
  avatar?: string;
  rating: number;
  isBot?: boolean;
}
export type Verdict =
  | "pending"
  | "accepted"
  | "wrong_answer"
  | "compile_error"
  | "runtime_error"
  | "time_limit"
  | "output_limit"
  | "judge_error";
export interface Submission {
  id: string;
  userId: string;
  kind: "run" | "submit";
  language: Language;
  source: string;
  receivedAt: number;
  sequence: number;
  verdict: Verdict;
  message?: string;
  sampleResults?: { passed: boolean; actual: unknown; expected: unknown }[];
  completedAt?: number;
  attempt?: number;
}
export interface Result {
  winnerId: string | null;
  reason: "solved" | "draw" | "resigned" | "void";
  deltas: Record<string, number>;
  settled: boolean;
}
export interface AttemptLimits {
  runs: number;
  submits: number;
}
// Older live matches and the isolated demo retain their original allowance.
export const DEFAULT_ATTEMPT_LIMITS: Readonly<AttemptLimits> = Object.freeze({
  runs: 3,
  submits: 5,
});
export interface MatchView {
  id: string;
  arena: Arena;
  mode: Mode;
  status: "ready" | "active" | "settling" | "finished";
  players: Player[];
  problem: PublicProblem;
  startsAt: number;
  endsAt: number;
  serverNow: number;
  opponentStatus?: "Ready" | "Solving" | "Judging" | "Finished";
  submissions: Omit<Submission, "source">[];
  attempts: { runs: number; submits: number };
  attemptLimits?: AttemptLimits;
  result: Result | null;
}
export interface Rating {
  arena: Arena;
  mode: Mode;
  rating: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
}
export interface Admission {
  mode: "disabled" | "staging" | "public";
  canJoin: boolean;
  reason: string;
}
export interface Config {
  admissionMode?: Admission["mode"];
  attemptLimits?: AttemptLimits;
  supabaseUrl: string;
  supabaseKey: string;
  playEnabled: boolean;
  reason: string;
  dailyCapacity: number | null;
  executionCapacity?: {
    concurrentExecutions: number;
    activeMatches: number;
  } | null;
  apiBase?: string;
}
export interface QueueView {
  attemptLimits?: AttemptLimits;
  requestId?: string;
  status: "idle" | "waiting" | "matched" | "capacity";
  joinedAt?: number;
  serverNow: number;
  matchId?: string;
  arena?: Arena;
  message?: string;
}
export type FriendChallengeStatus =
  "open" | "accepted" | "declined" | "cancelled" | "expired";
export interface FriendIdentity {
  id: string;
  publicId: string;
  name: string;
  avatar?: string;
}
export interface FriendChallenge {
  id: string;
  arena: Arena;
  status: FriendChallengeStatus;
  challenger: FriendIdentity;
  challenged: FriendIdentity;
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
  matchId?: string;
}
export interface FriendChallengeView {
  serverNow: number;
  incoming: FriendChallenge[];
  outgoing: FriendChallenge[];
  recent: FriendChallenge[];
  currentMatchId?: string;
}
export interface HistoryRow {
  id: string;
  arena: Arena;
  mode: Mode;
  started_at: string;
  ended_at: string;
  result: {
    winnerId: string | null;
    reason: string;
    deltas: Record<string, number>;
  };
  opponent?: string;
  problem_title?: string;
}
export interface LeaderRow {
  user_id: string;
  rating: number;
  matches: number;
  wins: number;
  profiles: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}
