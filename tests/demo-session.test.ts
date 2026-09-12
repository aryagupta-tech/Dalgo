import {describe, expect, it} from 'vitest';
import {
  DEMO_BOT, DEMO_PREVIEW_MS, DEMO_READY_MS, DEMO_SEARCH_MS, DEMO_USER,
  advanceDemo, createDemo, demoPhase, finishDemo, previewAttempt, restoreDemo,
  setDemoScenario, skipDemoWait, toDemoMatch, type DemoScenario, type DemoState,
} from '../src/demo-session';
import {ARENAS, type PublicProblem} from '../shared/types';

const NOW = 1_800_000_000_000;
const problem: PublicProblem = {
  id: 'local-problem', version: 1, arena: 'easy', title: 'Local example', topic: 'Arrays',
  description: 'Return the supplied example.', constraints: ['An illustrative problem.'],
  parameters: [{name: 'items', type: 'int[]'}], returnType: 'int[]',
  examples: [{args: [[1, 2]], expected: [2, 1], explanation: 'Public sample output.'}],
  starter: {python: 'def solve(items): pass', javascript: 'function solve(items) {}', cpp: 'int solve() {}', java: 'static int solve() {}'},
};

function active(): DemoState {
  return skipDemoWait(skipDemoWait(createDemo('easy', problem, NOW), NOW), NOW);
}

describe('local demo transitions', () => {
  it('moves through a fifteen-second search and five-second ready stage', () => {
    const state = createDemo('easy', problem, NOW);
    expect(state.schema).toBe(1);
    expect(demoPhase(state, NOW)).toBe('searching');
    expect(demoPhase(state, NOW + DEMO_SEARCH_MS)).toBe('ready');
    expect(demoPhase(state, NOW + DEMO_SEARCH_MS + DEMO_READY_MS)).toBe('active');
    expect(state.endsAt - state.startsAt).toBe(ARENAS.easy.duration * 1000);
    expect(state.result).toBeNull();
  });

  it('skips each wait without changing the session ID or shortening active time', () => {
    const searching = createDemo('easy', problem, NOW);
    const ready = skipDemoWait(searching, NOW + 100);
    expect(demoPhase(ready, NOW + 100)).toBe('ready');
    expect(ready.startsAt).toBe(NOW + 100 + DEMO_READY_MS);
    const playing = skipDemoWait(ready, NOW + 200);
    expect(demoPhase(playing, NOW + 200)).toBe('active');
    expect(playing.id).toBe(searching.id);
    expect(playing.endsAt - playing.startsAt).toBe(600_000);
    expect(searching.startsAt).toBe(NOW + 20_000);
    expect(skipDemoWait(playing, NOW + 300)).toBe(playing);
  });

  it('resolves a sample after exactly 800ms using only detached public example outputs', () => {
    const state = active();
    const pending = previewAttempt(state, 'run', 'python', NOW);
    const original = JSON.stringify(pending);
    expect(pending.submissions[0].verdict).toBe('pending');
    expect(advanceDemo(pending, NOW + 799, problem)).toBe(pending);
    const done = advanceDemo(pending, NOW + 800, problem);
    expect(done.pending).toBeUndefined();
    expect(done.result).toBeNull();
    expect(done.submissions[0]).toMatchObject({verdict: 'accepted', completedAt: NOW + 800, sampleResults: [{passed: true, actual: [2, 1], expected: [2, 1]}]});
    expect(done.submissions[0].message).toContain('not executed');
    expect(JSON.stringify(pending)).toBe(original);
    expect(done.submissions[0].sampleResults![0].actual).not.toBe(problem.examples[0].expected);
    expect('source' in done.submissions[0]).toBe(false);
  });

  it.each([
    ['win', DEMO_USER, 'solved', 16, 'accepted'],
    ['loss', DEMO_BOT, 'solved', -16, 'wrong_answer'],
    ['draw', null, 'draw', 0, 'wrong_answer'],
    ['void', null, 'void', 0, 'judge_error'],
  ] as const)('finishes the selected %s illustration after a submission preview', (scenario, winnerId, reason, delta, verdict) => {
    const state = setDemoScenario(active(), scenario);
    const pending = previewAttempt(state, 'submit', 'javascript', NOW);
    const finished = advanceDemo(pending, NOW + 800, problem);
    expect(finished.result).toEqual({winnerId, reason, deltas: {[DEMO_USER]: delta}, settled: true});
    expect(finished.finishedAt).toBe(NOW + 800);
    expect(finished.submissions[0].verdict).toBe(verdict);
    expect(finished.submissions[0].sampleResults).toBeUndefined();
    expect(demoPhase(finished, NOW + 800)).toBe('finished');
    expect(advanceDemo(finished, NOW + 1000, problem)).toBe(finished);
  });

  it('draws when time expires without a pending attempt', () => {
    const state = active();
    expect(demoPhase(state, state.endsAt)).toBe('finished');
    const finished = advanceDemo(state, state.endsAt + 40_000, problem);
    expect(finished.result).toMatchObject({winnerId: null, reason: 'draw', deltas: {[DEMO_USER]: 0}});
    expect(finished.finishedAt).toBe(state.endsAt);
  });

  it('waits for an attempt received before expiry, then preserves its selected result', () => {
    const state = active();
    const pending = previewAttempt(state, 'submit', 'java', state.endsAt - 100);
    expect(demoPhase(pending, state.endsAt)).toBe('active');
    expect(advanceDemo(pending, state.endsAt, problem).result).toBeNull();
    const finished = advanceDemo(pending, state.endsAt + 700, problem);
    expect(finished.result?.winnerId).toBe(DEMO_USER);
    expect(finished.finishedAt).toBe(state.endsAt + 700);
  });

  it('resolves a pending sample before applying an expiry draw', () => {
    const state = active();
    const pending = previewAttempt(state, 'run', 'cpp', state.endsAt - 100);
    const finished = advanceDemo(pending, state.endsAt + 700, problem);
    expect(finished.submissions[0].verdict).toBe('accepted');
    expect(finished.result?.reason).toBe('draw');
    expect(finished.finishedAt).toBe(state.endsAt + 700);
  });

  it('rejects inactive, overlapping, and finished attempts with friendly errors', () => {
    expect(() => previewAttempt(createDemo('easy', problem, NOW), 'run', 'python', NOW)).toThrow('active demo');
    const pending = previewAttempt(active(), 'run', 'python', NOW);
    expect(() => previewAttempt(pending, 'submit', 'python', NOW + 1)).toThrow('current preview');
    expect(() => setDemoScenario(pending, 'loss')).toThrow('current preview');
    expect(() => previewAttempt(finishDemo(active(), 'win', NOW), 'run', 'python', NOW)).toThrow('active demo');
  });

  it('enforces the three-run and five-submission limits', () => {
    let state = active();
    for (let i = 0; i < 3; i++) state = advanceDemo(previewAttempt(state, 'run', 'python', NOW + i * 1000), NOW + i * 1000 + 800, problem);
    expect(() => previewAttempt(state, 'run', 'python', NOW + 4000)).toThrow('three sample');
    const history: DemoState = {...active(), submissions: Array.from({length: 5}, (_, sequence) => ({
      id: crypto.randomUUID(), userId: DEMO_USER, kind: 'submit', language: 'python', sequence,
      verdict: 'wrong_answer', receivedAt: NOW + sequence * 1000, completedAt: NOW + sequence * 1000 + 800,
    }))};
    expect(() => previewAttempt(history, 'submit', 'python', NOW + 6000)).toThrow('five submission');
  });

  it('clears a pending preview on resignation and keeps the final result immutable', () => {
    const pending = previewAttempt(active(), 'run', 'python', NOW);
    const finished = finishDemo(pending, 'win', NOW + 100, 'resigned');
    expect(finished.scenario).toBe('loss');
    expect(finished.pending).toBeUndefined();
    expect(finished.submissions[0]).toMatchObject({verdict: 'judge_error', completedAt: NOW + 100});
    expect(finished.result).toMatchObject({winnerId: DEMO_BOT, reason: 'resigned', deltas: {[DEMO_USER]: -16}});
    expect(finishDemo(finished, 'win', NOW + 200)).toBe(finished);
    expect(restoreDemo(JSON.stringify(finished), 'easy', problem, NOW + 200)).toEqual(finished);
  });
});

describe('demo session persistence and views', () => {
  it('restores an outstanding preview before its due time and resolves it on a later reload', () => {
    const pending = previewAttempt(setDemoScenario(active(), 'loss'), 'submit', 'python', NOW);
    const raw = JSON.stringify(pending);
    expect(restoreDemo(raw, 'easy', problem, NOW + 100)).toEqual(pending);
    const finished = restoreDemo(raw, 'easy', problem, NOW + DEMO_PREVIEW_MS);
    expect(finished?.result?.winnerId).toBe(DEMO_BOT);
    expect(finished?.pending).toBeUndefined();
    expect(JSON.stringify(pending)).toBe(raw);
  });

  it('restores an expired session as a completed draw', () => {
    const state = active();
    const restored = restoreDemo(JSON.stringify(state), 'easy', problem, state.endsAt + 10_000);
    expect(restored?.result?.reason).toBe('draw');
    expect(restored?.finishedAt).toBe(state.endsAt);
  });

  it('rejects wrong schemas, problem revisions, clock ranges, source data, and inconsistent pending rows', () => {
    const state = active();
    const pending = previewAttempt(state, 'run', 'python', NOW);
    const invalid: unknown[] = [
      null, 'broken JSON', {...state, schema: 2}, {...state, arena: 'hard'},
      {...state, problemVersion: 2}, {...state, id: 'not-an-id'},
      {...state, endsAt: state.endsAt + 1}, {...state, queuedAt: NOW + 1},
      {...state, source: 'code must not be persisted'},
      {...pending, pending: undefined},
      {...pending, pending: {...pending.pending, resolvesAt: NOW + 900}},
      {...pending, submissions: [{...pending.submissions[0], source: 'secret code'}]},
    ];
    for (const raw of invalid) expect(restoreDemo(raw, 'easy', problem, NOW)).toBeNull();
  });

  it('rejects tampered result deltas and modified sample outputs', () => {
    const finished = finishDemo(active(), 'win', NOW);
    expect(restoreDemo({...finished, result: {...finished.result, deltas: {[DEMO_USER]: 999}}}, 'easy', problem, NOW)).toBeNull();
    const sampled = advanceDemo(previewAttempt(active(), 'run', 'python', NOW), NOW + 800, problem);
    const tampered = structuredClone(sampled);
    tampered.submissions[0].sampleResults![0].actual = 'invented';
    expect(restoreDemo(tampered, 'easy', problem, NOW + 800)).toBeNull();
    expect(restoreDemo(sampled, 'easy', problem, NOW + 800)).toEqual(sampled);
  });

  it('produces a detached MatchView with public data, illustrative players, and accurate attempt counts', () => {
    const pending = previewAttempt(active(), 'run', 'python', NOW);
    const supplied = {...problem, tests: [{expected: 'private'}], reference: 'private implementation'};
    const view = toDemoMatch(pending, supplied, NOW + 800);
    expect(view.status).toBe('active');
    expect(view.mode).toBe('bot');
    expect(view.players.map(player => player.id)).toEqual([DEMO_USER, DEMO_BOT]);
    expect(view.attempts).toEqual({runs: 1, submits: 0});
    expect(view.submissions[0].verdict).toBe('accepted');
    expect('tests' in view.problem).toBe(false);
    expect('reference' in view.problem).toBe(false);
    expect('source' in view.submissions[0]).toBe(false);
    expect(pending.submissions[0].verdict).toBe('pending');
    expect(view.problem).not.toBe(problem);
  });
});
