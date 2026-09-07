# SDK & docs feedback (from building Chronomancer)

Tested against `@somnia-chain/markets-sdk@0.29.0` on Somnia Shannon (50312).

1. **Deep dist imports are blocked in 0.29.** `import … from
   "@somnia-chain/markets-sdk/dist/eventsAbi.js"` throws
   `ERR_PACKAGE_PATH_NOT_EXPORTED` (exports map only covers `.`, `./react`,
   `./chains`, `./reactivity`, `./native`). The 0.28-era starter relies on it
   for `marketCreatorEventsAbi`. Workaround: inline the `MarketCreated` event
   ABI (13-field creator variant) and scan logs with viem directly. Suggest
   re-exporting the events ABIs from the package root.

2. **`loadMarkets()` needs `wsRpcUrl` or it throws.** Easy to miss; worth one
   bold line in the install snippet, since every minimal loop needs it.

3. **Unified `createOrder` symbol path needs the indexer.** When the indexer
   lags, symbols vanish while the chain is fine. Our fix: discover and gate
   fully on-chain (`getMarketOnchain` status), resolve symbols only for the
   live-fill call, and say so in the UI when the book is empty.

4. **PostOnly-crossing reverts are correct but surprising.** A maker priced
   through the touch throws `PostOnlyWouldCross` instead of resting. Pricing
   makers off `getAllOpenOrdersOnchain` best bid + buffer works; a one-line
   note in Recipes ("price SELLs above best bid") would save an afternoon.

5. **Pools recycle across windows.** Keying anything by pool address breaks;
   `(marketId)` is the identity and `expiry` must be re-resolved per round.
   The Market Structure page says this — it deserves repeating in Recipes.

6. **Settled markets leave the live list.** Redeem-by-scan must query
   `status: Finalized` explicitly; filtering the live list finds nothing.
   Our settler does this and claims voided windows on both sides at 0.5.

7. **Price scale is raw 1e6 per whole token.** `BookLevel.price` is bigint
   collateral units; dividing by 1e6 gives probability. Worked as documented.

8. **No rate limits held up.** Snapshot-once + event-driven reads behaved;
   the 40×1000-block log walk for discovery was the only slow step (~seconds).

9. **Somnia gas: estimate, don't pin.** State-creation pricing punishes
   hardcoded Ethereum limits; viem defaults + estimation were fine for reads,
   fills, and (planned) trophy deploys.

10. **Expiry units bite.** `expireTimestampNs` is nanoseconds and must sit
    under `marketExpiryNs()`; the unified tier hides this, the trader tier
    does not. Defaulting to pool expiry (as the SDK does) is the right call.

11. **Live markets come from the module, not the creator wrapper.**
    Scanning `MarketCreated` on `marketCreator` (the starter template path)
    returned zero events over 10k blocks, while the `BinaryMarketsModule`
    variant (19 fields, carries venueId/operatorId, no `intervalSec`)
    returned 42 with 4 live. Discovery should watch both; window minutes
    can be derived from `expiry - tradingStart` when `intervalSec` is absent.
