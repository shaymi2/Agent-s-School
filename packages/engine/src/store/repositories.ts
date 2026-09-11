/**
 * Thin repositories over the SQLite tables.
 *
 * Every read hands back a domain object, every write takes one. Nothing above
 * this layer touches SQL, so the store could be swapped without the
 * orchestrator noticing.
 */

import { openDatabase } from './db.ts';
import type { Db } from './db.ts';
import { listExercises, listSkills } from '../exercises/catalog.ts';
import { newId } from '../domain/ids.ts';
import type {
  AgentConfig,
  CoachFeedback,
  Evaluation,
  ExerciseDefinition,
  FitnessProfile,
  GymEvent,
  Session,
} from '../domain/types.ts';

type Row = Record<string, unknown>;

export interface SessionSnapshot {
  exerciseId: string;
  agent: AgentConfig;
  calls: unknown[];
  writes: unknown[];
  finalState: unknown[];
  firedEvents: unknown[];
  finalResponse: string;
  stopReason: string;
}

export class GymStore {
  readonly db: Db;

  constructor(location?: string) {
    this.db = openDatabase(location);
    this.seedCatalog();
  }

  close(): void {
    this.db.close();
  }

  /** Skills and exercises are code-owned data; the tables mirror them for queries. */
  private seedCatalog(): void {
    const skill = this.db.prepare(
      'INSERT INTO skills (id, name, icon, blurb, status) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, blurb=excluded.blurb, status=excluded.status',
    );
    for (const s of listSkills()) skill.run(s.id, s.name, s.icon, s.blurb, s.status);

    const exercise = this.db.prepare(
      'INSERT INTO exercises (id, skill, difficulty, title, task, definition) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET skill=excluded.skill, difficulty=excluded.difficulty, ' +
        'title=excluded.title, task=excluded.task, definition=excluded.definition',
    );
    for (const e of listExercises()) {
      exercise.run(e.id, e.skill, e.difficulty, e.title, e.task, JSON.stringify(e));
    }
  }

  /* ------------------------------------------------------------- agents -- */

  createAgent(input: Partial<AgentConfig> & { name: string }): AgentConfig {
    const agent: AgentConfig = {
      id: input.id ?? newId('agent'),
      name: input.name,
      provider: input.provider ?? 'heuristic',
      model: input.model ?? 'reflex-v1',
      systemPrompt: input.systemPrompt,
      temperature: input.temperature,
      maxSteps: input.maxSteps ?? 12,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        'INSERT INTO agents (id, name, provider, model, system_prompt, temperature, max_steps, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, ' +
          'provider=excluded.provider, model=excluded.model, system_prompt=excluded.system_prompt, ' +
          'temperature=excluded.temperature, max_steps=excluded.max_steps',
      )
      .run(
        agent.id,
        agent.name,
        agent.provider,
        agent.model,
        agent.systemPrompt ?? null,
        agent.temperature ?? null,
        agent.maxSteps,
        agent.createdAt,
      );
    return agent;
  }

  getAgent(id: string): AgentConfig | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToAgent(row) : null;
  }

  listAgents(): AgentConfig[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY created_at').all() as Row[];
    return rows.map(rowToAgent);
  }

  /* ----------------------------------------------------------- sessions -- */

  createSession(session: Session): Session {
    this.db
      .prepare(
        'INSERT INTO sessions (id, agent_id, exercise_id, skill, attempt, status, started_at, guidance) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        session.id,
        session.agentId,
        session.exerciseId,
        session.skill,
        session.attempt,
        session.status,
        session.startedAt,
        session.guidance ? JSON.stringify(session.guidance) : null,
      );
    return session;
  }

  updateSession(session: Session): void {
    this.db
      .prepare(
        'UPDATE sessions SET status = ?, finished_at = ?, final_response = ?, score = ?, success = ?, error = ? WHERE id = ?',
      )
      .run(
        session.status,
        session.finishedAt ?? null,
        session.finalResponse ?? null,
        session.score ?? null,
        session.success === undefined ? null : session.success ? 1 : 0,
        session.error ?? null,
        session.id,
      );
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToSession(row) : null;
  }

  listSessions(filter: { agentId?: string; exerciseId?: string; limit?: number } = {}): Session[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (filter.agentId) {
      clauses.push('agent_id = ?');
      args.push(filter.agentId);
    }
    if (filter.exerciseId) {
      clauses.push('exercise_id = ?');
      args.push(filter.exerciseId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...(args as never[]), filter.limit ?? 100) as Row[];
    return rows.map(rowToSession);
  }

  countAttempts(agentId: string, exerciseId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE agent_id = ? AND exercise_id = ?')
      .get(agentId, exerciseId) as Row;
    return Number(row.n ?? 0);
  }

  /* ------------------------------------------------------------- events -- */

  appendEvent(event: GymEvent): void {
    this.db
      .prepare(
        'INSERT INTO events (id, session_id, agent_id, exercise_id, seq, type, at, label, payload) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        event.id,
        event.sessionId,
        event.agentId,
        event.exerciseId,
        event.seq,
        event.type,
        event.at,
        event.label,
        JSON.stringify(event.payload),
      );
  }

  listEvents(sessionId: string, afterSeq = -1): GymEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq')
      .all(sessionId, afterSeq) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      agentId: String(row.agent_id),
      exerciseId: String(row.exercise_id),
      seq: Number(row.seq),
      type: String(row.type) as GymEvent['type'],
      at: Number(row.at),
      label: String(row.label),
      payload: JSON.parse(String(row.payload)),
    }));
  }

  /* -------------------------------------------------------- evaluations -- */

  saveEvaluation(evaluation: Evaluation): void {
    this.db
      .prepare(
        'INSERT INTO evaluations (session_id, score, success, payload, created_at) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT(session_id) DO UPDATE SET score=excluded.score, success=excluded.success, payload=excluded.payload',
      )
      .run(
        evaluation.sessionId,
        evaluation.score,
        evaluation.success ? 1 : 0,
        JSON.stringify(evaluation),
        evaluation.createdAt,
      );
  }

  getEvaluation(sessionId: string): Evaluation | null {
    const row = this.db.prepare('SELECT payload FROM evaluations WHERE session_id = ?').get(sessionId) as
      | Row
      | undefined;
    return row ? (JSON.parse(String(row.payload)) as Evaluation) : null;
  }

  saveFeedback(feedback: CoachFeedback): void {
    this.db
      .prepare(
        'INSERT INTO coach_feedback (session_id, agent_id, payload, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload',
      )
      .run(feedback.sessionId, feedback.agentId, JSON.stringify(feedback), feedback.createdAt);
  }

  /** The coaching currently in force for an athlete in one skill. */
  getLatestGuidance(agentId: string, skill: string): CoachFeedback | null {
    const row = this.db
      .prepare(
        'SELECT cf.payload AS payload FROM coach_feedback cf JOIN sessions s ON s.id = cf.session_id ' +
          'WHERE cf.agent_id = ? AND s.skill = ? ORDER BY cf.created_at DESC LIMIT 1',
      )
      .get(agentId, skill) as Row | undefined;
    return row ? (JSON.parse(String(row.payload)) as CoachFeedback) : null;
  }

  getFeedback(sessionId: string): CoachFeedback | null {
    const row = this.db.prepare('SELECT payload FROM coach_feedback WHERE session_id = ?').get(sessionId) as
      | Row
      | undefined;
    return row ? (JSON.parse(String(row.payload)) as CoachFeedback) : null;
  }

  /* ----------------------------------------------------------- profiles -- */

  saveProfile(profile: FitnessProfile): void {
    this.db
      .prepare(
        'INSERT INTO agent_skill_profiles (agent_id, skill, payload, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(agent_id, skill) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
      )
      .run(profile.agentId, profile.skill, JSON.stringify(profile), profile.updatedAt);
  }

  getProfile(agentId: string, skill: string): FitnessProfile | null {
    const row = this.db
      .prepare('SELECT payload FROM agent_skill_profiles WHERE agent_id = ? AND skill = ?')
      .get(agentId, skill) as Row | undefined;
    return row ? (JSON.parse(String(row.payload)) as FitnessProfile) : null;
  }

  listProfiles(agentId: string): FitnessProfile[] {
    const rows = this.db
      .prepare('SELECT payload FROM agent_skill_profiles WHERE agent_id = ?')
      .all(agentId) as Row[];
    return rows.map((row) => JSON.parse(String(row.payload)) as FitnessProfile);
  }

  /* ---------------------------------------------------------- snapshots -- */

  saveSnapshot(sessionId: string, snapshot: SessionSnapshot): void {
    this.db
      .prepare(
        'INSERT INTO session_snapshots (session_id, payload) VALUES (?, ?) ' +
          'ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload',
      )
      .run(sessionId, JSON.stringify(snapshot));
  }

  getSnapshot(sessionId: string): SessionSnapshot | null {
    const row = this.db.prepare('SELECT payload FROM session_snapshots WHERE session_id = ?').get(
      sessionId,
    ) as Row | undefined;
    return row ? (JSON.parse(String(row.payload)) as SessionSnapshot) : null;
  }

  /* --------------------------------------------------------- exercises --- */

  listExerciseRows(skill?: string): ExerciseDefinition[] {
    const rows = (
      skill
        ? this.db.prepare('SELECT definition FROM exercises WHERE skill = ? ORDER BY id').all(skill)
        : this.db.prepare('SELECT definition FROM exercises ORDER BY id').all()
    ) as Row[];
    return rows.map((row) => JSON.parse(String(row.definition)) as ExerciseDefinition);
  }
}

function rowToAgent(row: Row): AgentConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: String(row.provider) as AgentConfig['provider'],
    model: String(row.model),
    systemPrompt: row.system_prompt === null ? undefined : String(row.system_prompt),
    temperature: row.temperature === null ? undefined : Number(row.temperature),
    maxSteps: Number(row.max_steps),
    createdAt: String(row.created_at),
  };
}

function rowToSession(row: Row): Session {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    exerciseId: String(row.exercise_id),
    skill: String(row.skill),
    attempt: Number(row.attempt),
    status: String(row.status) as Session['status'],
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? undefined : Number(row.finished_at),
    guidance: row.guidance === null ? null : JSON.parse(String(row.guidance)),
    finalResponse: row.final_response === null ? undefined : String(row.final_response),
    score: row.score === null ? undefined : Number(row.score),
    success: row.success === null ? undefined : Number(row.success) === 1,
    error: row.error === null ? undefined : String(row.error),
  };
}
