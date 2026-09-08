# Chronomancer — DreamDEX event contracts, in a Telegram chat

<img width="1284" height="2601" alt="image" src="https://github.com/user-attachments/assets/a84318e7-4364-474c-a145-56041988e521" />

A Telegram bot that turns **DreamDEX Event Contracts on Somnia Shannon testnet**
into a conversation. It makes you a wallet, shows you the real two-sided book,
takes an order in plain words, and hands back a mined receipt with the fills that
actually happened.

Nothing here is paper. Every price is read from the venue, every balance from the
chain, and every receipt is decoded from its transaction. When the bot cannot
substantiate a number, it says so rather than inventing one.

- **Chain:** Somnia Shannon testnet (50312) · gas in STT
- **Collateral:** tUSDC, 6 decimals
- **SDK:** `@somnia-chain/markets-sdk` 0.29.0 against `SOMNIA_TESTNET_ADDRESSES`
- **Surface:** the event-contract SDK, not the spot HTTP API

## The problem

Prediction markets are a genuinely good idea buried under a trading interface.
Before a newcomer can place their first position, they are expected to already
know what slippage is, how to read liquidity depth, what a CLOB is, and how an
order book turns their intent into a fill. None of that is the thing they came
for. They had an opinion about an outcome and wanted to back it.

The onboarding tax is worse than the vocabulary. Install a wallet extension,
write down a seed phrase, find a faucet, connect the wallet, approve a token,
sign a popup, then work out why the order only partly filled. Every one of those
steps is a place to give up, and most people do.

Chronomancer is an attempt at the same markets made **simple, accessible and
scalable**:

- **Accessible** — it lives in Telegram, where people already are. No app to
  install, no browser extension, no wallet to connect. `/start` and you have a
  wallet.
- **Simple** — you say what you want in plain words. "Find me something worth a
  look", "10 tUSDC on Up". The agent reads the live book, sizes the order against
  the venue's tick and lot grid, and hands you one review to approve. No
  connect-wallet handshake, no seed phrase, no external signing popup — a single
  tap in the chat, and the position is placed and settled on chain.
- **Scalable** — a bot serves everyone in the same interface at once, with no
  frontend to ship and nothing for the user to keep updated.

The jargon does not disappear; it stops being a prerequisite. Slippage still
exists, so the bot bounds it for you and tells you what actually filled. Depth
still matters, so it refuses a side with no liquidity rather than quietly giving
you a worse price. The order book is still there — you simply do not have to
operate it by hand to take a position.

## The loop

1. `/start` creates one wallet for that Telegram user and walks through Up/Down
   shares, the order book, complete sets, and settlement. No model is called.
2. `/wallet` shows the address with live STT and tUSDC balances and both faucets.
   Funding is checked on chain before any order is accepted.
3. `/market` pages through open markets with real asks on **both** outcomes.
4. "Find something worth a look" runs the optional research layer over current
   snapshots and source-linked news. It is allowed to abstain, and often should.
5. "10 tUSDC on Up" builds a specific review: market, side, budget, price limit,
   order type, expiry. **Confirm transaction** is the only thing that signs.
6. The receipt reports the actual fills — including partial and zero — with the
   mined hash. Unfilled IOC quantity is cancelled, never left resting silently.
7. "Check my position" reads outcome balances on chain and renders a P/L card.

Private chats only. This is a **custodial testnet bot**: the server holds
encrypted keys and signs exactly what the user confirms.

## DreamDEX event contract primitives

The interesting part of this project. Each primitive is used as the venue defines
it, with the preflight that the recipes and gotchas call for.

### Discovery and liveness

`listLiveBinaryMarkets({ limit: 8, offset, venueId? })` pages the listing, and
every row is then re-checked **on chain** with `getMarketOnchain` before it is
shown: `status === 1`, not `finalized`, and at least 120 seconds left before
expiry. `getMarket` supplies question, asset, expiry, trading start and quote
decimals. Rows whose collateral is not the configured tUSDC — or that fall
outside the configured venue — are dropped.

State is keyed by **market ID**, never by pool address, because DreamDEX recycles
pools. A market ID must match `0x` + 64 hex before it is used at all.

### The book and the grid

`getBinaryOrderBook(pool, { depth: 20, decimals })` gives top-of-book bid and ask
for both outcomes. The book is only read when the market is genuinely live, so a
settled position can never be marked against the next market in a recycled pool.

`getBinaryBookParams(pool)` supplies `tickSize`, `lotSize` and `minQuantity`, and
every number the bot sends is snapped to that grid — prices floored to a tick,
quantities floored to a lot, anything under `minQuantity` refused with a reason.
All money arithmetic is integer; nothing round-trips through a float.

Prices are stored in **YES terms** for the raw trader, so a Down price is
`1 − p`. The interface always displays the price of the outcome you chose.

### Order types

| Intent | Order type | Behaviour |
| --- | --- | --- |
| Buy / sell now | `ORDER_TYPE.MARKET` | IOC: fills what it can, cancels the rest |
| Rest a quote | `ORDER_TYPE.POST_ONLY` | Rests until `min(market expiry, now + 5 min)` |

IOC orders carry a **two percentage point** cushion off the displayed price,
tick-aligned and clamped strictly inside 0 and 1, so a quote that was accurate a
moment ago still crosses. Budget sizing reserves the **larger** of the maker and
taker fee (`feeBpsTimes1k`) against full notional, plus raw rounding dust, so the
signed maximum cost is genuinely the maximum.

`trader.placeOrder` takes the pool, `BUY_YES` / `BUY_NO` / `SELL_YES` / `SELL_NO`,
price, quantity, collateral, outcome token and both token IDs. Resting orders are
listed with `getOrders(address, { status: 'Open' })`, verified for ownership with
`getOrderOnchain`, and withdrawn with `trader.cancelOrder`.

### Complete sets

`trader.mintSet` turns collateral into one Up **and** one Down share;
`trader.burnSet` turns the pair back into collateral. The pool's `oneCollateral`
is checked against `10 ** decimals` first, so a "set" is verified to be one whole
unit of collateral rather than assumed.

### Positions and P/L

`getOutcomeBalance({ outcomeToken, account, id })` is the source of truth for what
you hold. `getBinaryPositionPnL` supplies cost basis, mark value, unrealized and
realized P/L from the indexer — but it is only displayed when the indexed leg
balance **equals** the on-chain balance. When the indexer lags, the card still
shows real shares and labels the accounting unavailable. `getOpenPositionsWithPnL`
backs the portfolio view.

### Settlement, resolution and void

`getClaimable` finds payouts; `getMarketOnchain` decides what may be claimed.
A **resolved** market pays only the winning `outcomeIdx`; a **voided** market lets
both sides claim. `trader.redeem` goes through the binary module with the market
ID, market address, outcome token, outcome index and amount.

### Fills are decoded, never assumed

A submitted size is not a filled size. `OrderFill` entries from the receipt are
summed into filled quantity and cash at the actual `fillPrice`, converted into the
side you chose. Partial and zero fills are reported as themselves.

### Crash recovery

Before broadcast, the bot journals `keccak256(signedTx)`, the target address, and
whether the transaction is the action or an approval. **The signed bytes are never
stored.** `/activity` replays a journaled hash: fetch the receipt, verify that
`from` is your wallet and `to` is the journaled target, then decode the pool's logs
with `orderBookEventsAbi` for `OrderFilled` and `OrderPlaced`. If the outcome of a
broadcast is unknown, further writes stay blocked rather than risking a double
send.

### Invariants held before anything is signed

Everything below happens before a signer object exists, so a failure is a known
no-send:

- RPC chain ID is 50312, re-checked at quote **and** at execution
- the market is re-read live; closing or finalized markets are refused
- `getBinaryPoolParams` must still agree with the market: same market address,
  same `yesId`, not finalized, same collateral, `oneCollateral == 10 ** decimals`
  — this is what catches a **recycled pool generation**
- at least 0.01 STT for transaction and approval gas; tUSDC covers the max cost
- outcome balance re-checked for every sell, merge and redeem
- if fees moved enough that the budget no longer covers the quantity, the quote is
  rejected and a fresh one demanded
- quotes expire 60 seconds after they are shown
- testnet ceiling of 100 tUSDC or 100 shares per action

| Primitive | Implementation |
| --- | --- |
| Discovery and pagination | `listLiveBinaryMarkets`, `getMarket`, `getMarketOnchain` |
| Two-sided book, tick/lot grid | `getBinaryOrderBook`, `getBinaryBookParams` |
| Buy Up / Down | `trader.placeOrder`, live side ask, bounded stake, IOC |
| Sell held outcomes | `trader.placeOrder`, price floor, balance check, IOC |
| Rest a quote | `trader.placeOrder` post-only, capped at 5 min / market expiry |
| Manage orders | `getOrders`, `getOrderOnchain`, `trader.cancelOrder` |
| Mint / merge complete sets | `trader.mintSet`, `trader.burnSet` |
| Positions and P/L | `getOutcomeBalance`, `getBinaryPositionPnL`, `getOpenPositionsWithPnL` |
| Settlement and void payouts | `getClaimable`, on-chain outcome checks, `trader.redeem` |
| Actual fills | Decode the mined receipt; never assume the requested size |
| Recovery | Journal hashes before broadcast; decode receipts on `/activity` |

First use may trigger SDK contract approvals (ERC-20 allowance, outcome operator),
which are journaled separately from the action itself.

## Commands

| Command | Behaviour |
| --- | --- |
| `/start` | Wallet creation and guided onboarding |
| `/wallet` | Deposit address, live balances, faucet links |
| `/market` | Paginated open markets with live asks |
| `/positions` | Recent positions and generated P/L cards |
| `/activity` | Transaction journal; recover known mined submissions |
| `/orders` | List resting orders; review cancellation |
| `/redeem` | Claimable settled positions, including both void sides |
| `/advanced` | Complete sets and post-only limits |
| `/leaderboard` | Pseudonymous ranking by confirmed fill volume |
| `/daily` | UTC check-in streak and XP; no trade required |
| `/help` | Short command list |

## Run it

Requires **Node 24+** (built-in SQLite).

```bash
npm install
cp .env.example .env      # fresh setup only; keep an existing .env
# TELEGRAM_BOT_TOKEN from BotFather is the one required value.
# Free-text research is optional — see .env.example. Everything else
# (onboarding, browsing, button trading, positions) works without it.
npm run typecheck
npm test
npm run check:assistant   # read-only: RPC, token, live market and quote checks
npm run dev
```

First start creates `data/assistant/assistant.sqlite` and, unless
`WALLET_MASTER_KEY` is set, a random `data/assistant/wallet-master.key`.
**Back up the database and the master key together** — losing the key loses the
generated wallets. Run one polling instance, on a persistent private filesystem.

## Layout

- `src/bot.ts` — Telegram flow and deterministic confirmation routing
- `src/assistant/dreamdex.ts` — every SDK read, preflight, write and recovery path
- `src/assistant/math.ts` — integer budget sizing, grid snapping, fill accounting
- `src/assistant/wallets.ts` — per-user AES-256-GCM keys bound to the Telegram ID
- `src/assistant/ledger.ts` — SQLite users, sessions and the action journal
- `src/assistant/agent.ts` — optional research layer; it never holds a signer
- `src/assistant/cards.ts` — deterministic SVG → PNG position cards
- `tests/` — wallet, journal, money and bot-flow tests
- `scripts/assistant-check.ts` — read-only network checks; cannot reach a signer
- `site/` — the landing page
- `contracts/ChronomancerTrophies.sol` — attestation contract

`src/legacy-bot.ts`, `game.ts`, `copy.ts`, `store.ts`, `dream.ts` and
`src/server.ts` are the earlier paper-game prototype, kept for history. The
current `npm run dev` entry point shares none of their state.

## Known limits

- **Funding a fresh wallet is the rough edge.** The wallet `/start` generates is
  brand new, and the Somnia Telegram faucet does not always deliver tUSDC to it —
  a request can go unanswered or be refused for an address with no history. If
  nothing arrives, send tUSDC from another funded testnet address, or retry the
  faucet later. `/wallet` shows the address and re-reads both balances on chain,
  so you can tell funding apart from a bot problem. (Update: i think its bot/RPC issue)
- Live submission needs acceptance testing with a freshly funded testnet wallet.
  Automated tests mock execution; read-only checks never spend or prove a fill.
- Indexed P/L can lag the chain. When it disagrees with on-chain holdings the card
  shows shares and marks cost and P/L unavailable. The mark is an estimate, not a
  realizable exit quote, and realized P/L excludes gas and redemption accounting.
- The leaderboard is **volume, not profit**. Maker reads are bounded to 1,000
  recent fills per wallet; truncated history is labeled partial.
- Research output is an uncalibrated opinion, not a win probability. Book prices
  alone do not establish an edge, and abstention is a valid answer.
- A missing or unmined action hash, or an interrupted approval sequence, needs
  operator investigation. Never blindly clear the journal or resend. There is no
  automatic private-key export or withdrawal UI.
- tUSDC is test money. A testnet transaction is not a real-dollar settlement.

## References

- [DreamDEX Event Contracts](https://docs.dreamdex.io/developers/event-contracts)
- [Recipes](https://docs.dreamdex.io/developers/event-contracts/recipes)
- [Gotchas](https://docs.dreamdex.io/developers/event-contracts/gotchas)
- [Somnia Shannon testnet](https://testnet.somnia.network)
- `docs/SDK-FEEDBACK.md` — findings from building against 0.29.0
