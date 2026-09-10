# TurboPickle / Chronomancer: event-contract exit assistant

Product direction: “Tell me what I can recover, help me close, then send the
available collateral to my wallet.” The current app at `/turbopickle` is branded
Chronomancer and is a landing page for the Telegram bot.

## Implemented in this change

- Position-aware close conversations and `/close` with an explicit picker.
- On-chain state and both outcome balances determine available merge, IOC sale,
  and redemption routes. No invented holdings or automatic choice of a position.
- Complete-set merge reveals collateral that can be recovered without a buyer.
- Reviewed tUSDC transfers with full destination, amount, token, network, expiry,
  simulation, gas reserve, and an exact ERC-20 Transfer event check.
- Existing single-use, owner-bound journal covers transfers and market actions
  together. An unknown broadcast blocks both until reconciliation.
- Plain-word wallet, claim, order, exit and withdrawal intents are available to
  the language model; recipient and amount extraction for transfers stays in code.

This is a first route-selection implementation. It does not rank exits by net
proceeds, execute a multi-step close automatically, sweep every market, or run
stop-loss or payout schedules. IOC exits can partially fill. Escrowed shares
need order cancellation. tUSDC transfers are testnet only.

## Differentiators worth building next

| Priority | Feature | Event-contract mechanic | Evidence the demo should show |
| --- | --- | --- | --- |
| 1 | Exit cost comparison | Compare direct outcome sale, held-pair merge, and buying the missing outcome then merging | Real depth, lot/tick sizing, fees, gas, spend required and net proceeds for each feasible route; abstain when data is stale |
| 2 | Settlement inbox | Markets expire and leave the live list; winning/voided tokens require redemption | Scan finalized markets as well as tracked holdings, reconcile on-chain claims, and show exactly where collateral remains |
| 3 | Expiry-aware protection | Each market has a hard trading window and a successor with a different market ID | A user-configured close deadline and price floor; cancel locked orders, handle partial fills, stop at expiry and switch to settlement tracking |

The first is the strongest differentiator: an execution decision backed by the
complete-set structure. It must not claim risk-free arbitrage. Buying the missing
leg spends collateral and introduces execution risk; two sequential transactions
are not atomic. Compare actionable full-depth quotes and display minimum proceeds,
fees and gas. Refresh after each step before requesting another confirmation.

A settlement inbox is useful, but auto-claim alone is not distinctive: the Bot Kit
already includes EC Settlement and claim loops. Expiry protection should use
explicit user policies and durable state; the assistant should never infer a
standing mandate from an ordinary chat message.

## Sources reviewed, 10 September 2026

- [DreamDEX event-contract developer docs](https://docs.dreamdex.io/developers/event-contracts): markets SDK 0.29+, complete-set mint/merge, one book/two outcomes, scheduled expiry, chain-driven watches.
- [Bot Kit event-contract notes](https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/docs/event-contracts.md): finalized-market scans, claimed winnings, market IDs rather than recycled pool addresses, nonce serialization and IOC remainder handling. Some older SDK warnings are superseded by the current developer docs.
- [Starter template](https://github.com/IronicDeGawd/ec-dreamdex-hackathon-template): mint/trade/redeem lifecycle is a primitive, not product differentiation.
- [Bot Builder](https://dreambot-builder.vercel.app/): inspected Event contracts → EC Settlement → Testnet → Dry-run → generated configuration. The Builder supplies setup for the separate kit worker, not the existing Telegram assistant. No keys were entered or deployments started.

The Builder preview used EC Settlement, CLAIM=1, CLAIM_SCAN=25 and
WATCH_POLL_MS=15000. Do not run a second signing worker against the assistant’s
wallet: both would compete for its nonce. The assistant continues to use its
existing markets SDK and per-user encrypted wallets. No dependency replacement
or separate autonomous bot is needed for the implemented features.

## Verification and rollout

Automated tests use synthetic wallets and mocked RPC/Telegram. They cover
route selection, unavailable liquidity, settlement outcomes, amount/destination
validation, changed funds, gas and network checks, exact receipt verification,
unknown-broadcast recovery, confirmation ownership/replay, and the chat journey.
They do not prove a live fill or token transfer.

Before release, deploy the changed bot from this repository, retain the existing
assistant SQLite database and wallet master key, and restart only its existing
polling service. Publish the rebuilt landing page to its existing `/turbopickle`
location. Server connection, app path and service name must come from the owner’s
deployment configuration. A funded test-wallet acceptance run remains required.
