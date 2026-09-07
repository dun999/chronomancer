import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Ledger } from './ledger.js';
import type { WalletUser } from './types.js';

/** Custodial testnet wallets. The master key never enters prompts or Telegram. */
export class Wallets {
  private key: Buffer;
  constructor(private ledger: Ledger, dir: string, masterKey = '') {
    const file = join(dir, 'wallet-master.key');
    if (masterKey) {
      if (!/^[0-9a-f]{64}$/i.test(masterKey)) throw new Error('WALLET_MASTER_KEY must be 32 bytes of hex');
      this.key = Buffer.from(masterKey, 'hex');
    } else {
      if (!existsSync(file)) {
        if (ledger.users().length) throw new Error('Wallet master key missing. Restore your backup; refusing to replace wallets.');
        try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      }
      chmodSync(file, 0o600); this.key = readFileSync(file);
      if (this.key.length !== 32) throw new Error('Invalid wallet master key');
    }
    // Detect a wrong key at startup, before presenting any deposit address.
    const existing = ledger.users()[0]; if (existing) this.privateKey(existing.id);
  }
  ensure(id: string, name: string): WalletUser {
    const existing = this.ledger.user(id); if (existing) return existing;
    const pk = generatePrivateKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(id));
    const encrypted = Buffer.concat([cipher.update(pk, 'utf8'), cipher.final()]);
    return this.ledger.createUser({
      id, name: name.slice(0, 64), address: privateKeyToAccount(pk).address,
      wallet: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64'),
      stage: 0, streak: 0, lastDay: '', xp: 0, createdAt: Date.now(),
    });
  }
  privateKey(id: string): `0x${string}` {
    const u = this.ledger.user(id); if (!u) throw new Error('Use /start first');
    const data = Buffer.from(u.wallet, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0,12));
    decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(data.subarray(12,28));
    const pk = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8') as `0x${string}`;
    if (privateKeyToAccount(pk).address !== u.address) throw new Error('Wallet integrity check failed');
    return pk;
  }
}
