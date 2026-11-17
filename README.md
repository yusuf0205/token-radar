# Token Radar

A token launch radar for the make.fun `token-radar-01` bounty. It reads a frozen DefiLlama
snapshot of 758 protocols, ranks the ones that record no token by an implied value, and shows
a reader how to farm each one.

## The model (radar-2)

Implied value is anchored in the market, not in a flat multiple of TVL. For each category, the
model takes the median market-cap-to-TVL ratio of the snapshot's own live-token protocols in
that category (three or more of them, else the median across all live-token protocols, 0.214).
A protocol's base value is its TVL times its category's ratio. Two adjustments follow:

- **Growth:** the 7-day TVL change, clamped to -50% ... +100%, feeds a factor of
  1 + change x 0.6.
- **Tenure:** the longer a protocol has run with no token, the more value has accrued before any
  launch: a factor of 1 + (days with no token, capped at 4 years) / 4 years x 0.5. A protocol
  with no listing date is scored at 365 days.

Implied value = TVL x category ratio x growth factor x tenure factor, at least $1 and at most
$50bn. It is this entry's claim, not a prediction: it does not say a token will be issued, or
when. A protocol that records no token may still have one its DefiLlama record does not carry.

The board covers all 40 protocols on the snapshot's watchlist plus every rankable pre-token
protocol below the $50m floor (226 rows in all). Rankable means the protocol records no token,
is not a centralised exchange, and its name does not end in a version marker. Protocols whose
token already trades are kept apart in the dashboard's "Already trading" view, shown at the
market's own value.

## Run it

Node 22, standard library only, no install:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

This writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data),
`out/dashboard/` (the static page), `out/screenshots/` (three screenshots of the page) and
`out/dossier.json` (the summary the judge reads, built with the vendored make.fun library).

## Files

- `main.ts` — the runner: reads the snapshot, writes the board, data, dashboard, screenshots
  and dossier.
- `lib/model.ts` — the scoring model, the farm plans, and the snapshot parsing.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored as issued.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No framework, no network.
- `screenshots/` — three PNGs of the dashboard: the board, a protocol detail view, a filtered view.

## Farm plans

Each protocol gets seven steps, each naming the action, what it costs and how long it takes.
The steps are derived from the protocol's own record (category, chains, TVL, age): the core
position differs by category (supply for lending, liquidity for a DEX, stake for liquid
staking, bridge for a bridge, and so on), the capital is sized by TVL, and the hold period by
age. No plan promises a token or an airdrop.
