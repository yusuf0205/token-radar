# Token Radar

A token launch radar for the make.fun `token-radar-01` bounty. It reads a frozen DefiLlama
snapshot of 758 protocols, ranks the ones that record no token by an implied value, and shows
a reader how to farm each one.

## The model (radar-3)

Implied value is anchored in the market, not in a flat multiple of TVL. For each category, the
model takes the median market-cap-to-TVL ratio of the snapshot's own live-token protocols in
that category (three or more of them, else the median across all live-token protocols, 0.205).
A protocol's base value is its TVL times its category's ratio. Five adjustments follow, all
from the snapshot's own figures:

- **Growth:** the 7-day TVL change, clamped to -50% ... +100%, feeds a factor of
  1 + change x 0.6.
- **Tenure:** the longer a protocol has run with no token, the more value has accrued before any
  launch: a factor of 1 + (days with no token, capped at 4 years) / 4 years x 0.5. A protocol
  with no listing date is scored at 365 days.
- **Breadth:** each extra chain a protocol runs on adds 0.04, up to five extra chains.
- **Leadership:** the protocol's share of its category's total TVL, capped at one half, feeds
  a factor of 1 + share x 0.25.
- **Momentum:** the median 7-day change of live-token protocols in the same category, clamped
  to -20% ... +50%, feeds a factor of 1 + change x 0.3; a thin category takes the global
  median change instead.

Implied value = TVL x category ratio x growth x tenure x breadth x leadership x momentum, at
least $1 and at most $50bn. It is this entry's claim, not a prediction: it does not say a token
will be issued, or when. A protocol that records no token may still have one its DefiLlama
record does not carry.

The board ranks every launch candidate the snapshot holds (227 rows): all 40 protocols on the
snapshot's watchlist, plus every other candidate above and below the $50m floor. A candidate
records no token and is not a wrapped, staked or bridged product of a token that already
trades: centralised exchanges, bridges and canonical bridges, versioned pools, names carrying
a whole word wrapped, staked or staking, and names beginning with an exchange's name are left
out, because they are not protocols waiting on a launch of their own. Protocols whose token
already trades are kept apart in the dashboard's "Already trading" view, shown at the
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

Each protocol gets seven to ten steps, each naming the action, what it costs and how long it
takes. The steps are derived from the protocol's own record (category, chains, TVL, age): the
core position differs by category (supply for lending, liquidity for a DEX, stake for liquid
staking, bridge for a bridge, and so on), the capital is sized by TVL, and the hold period by
age. The count varies with the protocol: a small position skips the second move, a protocol
on three or more chains adds a step on its second chain, a protocol over $1bn of TVL adds a
step splitting the deposit, and a protocol younger than 90 days adds a step watching its
docs. No plan promises a token or an airdrop.
