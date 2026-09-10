import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Action, Execution, Quote, WalletUser } from './types.js';

/** Single-writer transactions also protect confirmations across worker processes. */
export class Ledger {
  private db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, 'assistant.sqlite');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS actions_user ON actions(user_id);
      CREATE TABLE IF NOT EXISTS sessions (user_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS refs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seen_updates (id INTEGER PRIMARY KEY, at INTEGER NOT NULL);`);
  }
  session<T>(id: string, fallback: T): T {
    const r = this.db.prepare('SELECT body FROM sessions WHERE user_id=?').get(id);
    return r ? JSON.parse(String(r.body)) : fallback;
  }
  setSession(id: string, value: unknown) {
    this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body').run(id, JSON.stringify(value));
  }
  ref(id: string, body: unknown): string {
    const token = randomBytes(10).toString('hex');
    this.db.prepare('INSERT INTO refs VALUES (?,?,?,?)').run(token, id, JSON.stringify(body), Date.now() + 86400000);
    return token;
  }
  resolveRef<T>(token: string, id: string): T | undefined {
    const r = this.db.prepare('SELECT body FROM refs WHERE id=? AND user_id=? AND expires>?').get(token, id, Date.now());
    return r ? JSON.parse(String(r.body)) : undefined;
  }
  close() { this.db.close(); }
  private atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  claimUpdate(id: number) {
    return this.db.prepare('INSERT OR IGNORE INTO seen_updates VALUES (?,?)').run(id, Date.now()).changes === 1;
  }
  user(id: string): WalletUser | undefined {
    const row = this.db.prepare('SELECT body FROM users WHERE id=?').get(id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  users(): WalletUser[] {
    return this.db.prepare('SELECT body FROM users').all().map(r => JSON.parse(String(r.body)));
  }
  createUser(user: WalletUser): WalletUser {
    this.db.prepare('INSERT OR IGNORE INTO users VALUES (?,?)').run(user.id, JSON.stringify(user));
    return this.user(user.id)!;
  }
  stage(id: string, stage: number) {
    this.atomic(() => {
      const u = this.user(id)!; u.stage = Math.max(u.stage, stage);
      this.db.prepare('UPDATE users SET body=? WHERE id=?').run(JSON.stringify(u), id);
    });
  }
  checkIn(id: string, now = Date.now()): WalletUser {
    return this.atomic(() => {
      const u = this.user(id)!;
      const today = new Date(now).toISOString().slice(0, 10);
      const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
      if (u.lastDay !== today) {
        u.streak = u.lastDay === yesterday ? u.streak + 1 : 1;
        u.lastDay = today; u.xp += 10;
        this.db.prepare('UPDATE users SET body=? WHERE id=?').run(JSON.stringify(u), id);
      }
      return u;
    });
  }
  prepare(userId: string, quote: Action['quote']): Action {
    return this.atomic(() => {
      if (this.actions(userId).some(a => ['executing','unknown'].includes(a.state)))
        throw new Error('Your earlier transaction needs reconciliation. Check /activity before making another trade.');
      // There is only one active confirmation per user. Old buttons become inert.
      for (const old of this.actions(userId).filter(a => a.state === 'pending')) {
        old.state = 'cancelled'; this.saveAction(old);
      }
      const a: Action = { id: randomBytes(10).toString('hex'), userId, quote, state: 'pending', createdAt: Date.now() };
      this.db.prepare('INSERT INTO actions VALUES (?,?,?,?)').run(a.id, userId, a.state, JSON.stringify(a));
      return a;
    });
  }
  action(id: string, userId: string): Action | undefined {
    const r = this.db.prepare('SELECT body FROM actions WHERE id=? AND user_id=?').get(id, userId);
    return r ? JSON.parse(String(r.body)) : undefined;
  }
  actions(userId: string): Action[] {
    return this.db.prepare('SELECT body FROM actions WHERE user_id=? ORDER BY rowid DESC').all(userId).map(r => JSON.parse(String(r.body)));
  }
  claim(id: string, userId: string, now = Date.now()): Action {
    return this.atomic(() => {
      const a = this.action(id, userId);
      if (!a || a.state !== 'pending') throw new Error('This confirmation is no longer active. Use /activity or make a new quote.');
      if (a.quote.expiresAt <= now) { throw new Error('This quote expired. Pick the market again for fresh prices.'); }
      if (this.actions(userId).some(x => x.state === 'executing' || x.state === 'unknown'))
        throw new Error('An earlier transaction is still being checked.');
      a.state = 'executing'; this.saveAction(a); return a;
    });
  }
  recordSubmission(id: string, userId: string, submission: NonNullable<Action['submissions']>[number]) {
    this.atomic(() => {
      const a = this.action(id, userId);
      if (!a || a.state !== 'executing') throw new Error('No executing action to journal');
      a.submissions = [...(a.submissions ?? []), submission]; this.saveAction(a);
    });
  }
  cancel(id: string, userId: string) {
    this.atomic(() => {
      const a = this.action(id, userId);
      if (a?.state === 'pending') { a.state = 'cancelled'; this.saveAction(a); }
    });
  }
  finish(id: string, userId: string, state: Action['state'], result?: Execution, error?: string) {
    this.atomic(() => {
      const a = this.action(id, userId);
      if (!a || !['executing','unknown'].includes(a.state)) throw new Error('Invalid action transition');
      a.state = state; a.result = result; a.error = error; this.saveAction(a);
    });
  }
  private saveAction(a: Action) {
    this.db.prepare('UPDATE actions SET state=?, body=? WHERE id=?').run(a.state, JSON.stringify(a), a.id);
  }
}
