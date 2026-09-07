import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { cfg, PAPER_START_SAND } from "./config.js";

export type Side = "Rise" | "Fall";
export type Mode = "paper" | "live";

export interface Prophecy {
  id: string;
  userId: string;
  asset: string;
  marketId: string;
  pool: string;
  side: Side;
  stake: number;
  price: number | null;
  payout: number | null;
  mode: Mode;
  tx: string | null;
  status: "open" | "won" | "lost" | "voided";
  createdAt: number;
  expiry: number;
}

export interface User {
  id: string;
  name: string;
  sand: number;
  xp: number;
  streak: number;
  best: number;
  wins: number;
  settled: number;
  mode: Mode;
  createdAt: number;
}

interface DB {
  users: Record<string, User>;
  prophecies: Prophecy[];
}

function blank(): DB {
  return { users: {}, prophecies: [] };
}

export class Store {
  private db: DB;

  constructor(private path = cfg.dataPath) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try {
        this.db = { ...blank(), ...JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        this.db = blank();
      }
    } else {
      this.db = blank();
      this.save();
    }
  }

  private save(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.path);
  }

  user(id: string, name: string): { u: User; isNew: boolean } {
    const found = this.db.users[id];
    if (found) {
      if (name && found.name !== name) {
        found.name = name.slice(0, 64);
        this.save();
      }
      return { u: found, isNew: false };
    }
    const u: User = {
      id,
      name: (name || "nameless mage").slice(0, 64),
      sand: PAPER_START_SAND,
      xp: 0,
      streak: 0,
      best: 0,
      wins: 0,
      settled: 0,
      mode: "paper",
      createdAt: Date.now(),
    };
    this.db.users[id] = u;
    this.save();
    return { u, isNew: true };
  }

  adjustSand(id: string, delta: number): User {
    const u = this.db.users[id];
    if (!u) throw new Error("unknown mage");
    u.sand = Math.max(0, u.sand + delta);
    this.save();
    return u;
  }

  addXp(id: string, amount: number): User {
    const u = this.db.users[id];
    if (!u) throw new Error("unknown mage");
    u.xp += amount;
    this.save();
    return u;
  }

  setMode(id: string, mode: Mode): User {
    const u = this.db.users[id];
    if (!u) throw new Error("unknown mage");
    u.mode = mode;
    this.save();
    return u;
  }

  recordWin(id: string): User {
    const u = this.db.users[id];
    if (!u) throw new Error("unknown mage");
    u.streak += 1;
    u.best = Math.max(u.best, u.streak);
    u.wins += 1;
    u.settled += 1;
    this.save();
    return u;
  }

  recordLoss(id: string): { u: User; streakWas: number } {
    const u = this.db.users[id];
    if (!u) throw new Error("unknown mage");
    const streakWas = u.streak;
    u.streak = 0;
    u.settled += 1;
    this.save();
    return { u, streakWas };
  }

  recordVoid(id: string): User {
    const u = this.db.users[id];
    if (!u) throw new Error("unknown mage");
    u.settled += 1;
    this.save();
    return u;
  }

  addProphecy(p: Prophecy): void {
    this.db.prophecies.push(p);
    this.save();
  }

  setProphecyStatus(id: string, status: Prophecy["status"]): void {
    const p = this.db.prophecies.find((x) => x.id === id);
    if (!p) return;
    p.status = status;
    this.save();
  }

  openFor(userId: string): Prophecy[] {
    return this.db.prophecies.filter((p) => p.userId === userId && p.status === "open");
  }

  openAll(): Prophecy[] {
    return this.db.prophecies.filter((p) => p.status === "open");
  }

  allUsers(): User[] {
    return Object.values(this.db.users);
  }

  top(limit = 10): User[] {
    return this.allUsers()
      .sort((a, b) => b.sand - a.sand || b.xp - a.xp)
      .slice(0, limit);
  }
}
