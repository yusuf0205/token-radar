// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol on the snapshot's watchlist plus the strongest pre-token protocols
// below the watchlist floor. A protocol is pre-token when its snapshot record carries no token: no
// market cap, no CoinGecko id, no symbol. The board says a protocol "records no token", never that
// it has none: DefiLlama's record is not proof, and a protocol on the list may still have a token
// its record does not carry. Protocols whose token already trades are kept apart in the live view
// and shown at the market's own value, never mixed into the ranked board.
//
// Implied value is anchored in the market, not in a flat multiple of TVL. For each category, the
// model takes the median market-cap-to-TVL ratio of the snapshot's own live-token protocols in that
// category (at least three of them, else the median across all live-token protocols), capped at 2.
// A pre-token protocol's base value is its TVL times its category's ratio: what the market already
// pays, per dollar of TVL, for a token in that line of business. Two adjustments follow, both from
// the snapshot's own figures:
//
//   growth   = clamp(change_7d, -50, 100) per cent; growth factor = 1 + (growth / 100) x 0.6
//   tenure   = min(age in days, 1460) / 1460; tenure factor = 1 + tenure x 0.5
//   implied  = TVL x category ratio x growth factor x tenure factor, at least $1, at most $50bn
//
// Growth rewards a protocol whose TVL is rising and trims one whose TVL is falling. Tenure rewards
// a protocol that has run a long time with no token: the longer the record, the more value has
// accrued before any launch. A protocol with no listing date is scored at 365 days. No protocol
// name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Live-token protocols a category needs before its own ratio is used. */
  category_min_observations: number;
  /** The highest category ratio the model applies. */
  ratio_cap: number;
  /** How much of the 7-day change feeds the growth factor. */
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  /** The tenure factor's weight, over this many days. */
  tenure_weight: number;
  tenure_days: number;
  /** The age in days a protocol with no listing date is scored at. */
  unknown_age_days: number;
  /** The highest implied value the model writes. */
  implied_cap: number;
}

export const MODEL: ModelConstants = {
  category_min_observations: 3,
  ratio_cap: 2.0,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  tenure_weight: 0.5,
  tenure_days: 1460,
  unknown_age_days: 365,
  implied_cap: 50_000_000_000,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's "already trading" view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_ratio: number;
    ratio_source: 'category' | 'global';
    growth_pct: number;
    growth_factor: number;
    tenure_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_ratio: number;
  ratio_source: 'category' | 'global';
  growth_factor: number;
  tenure_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_ratio: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category ratios the model anchors on: for every category with enough live-token protocols,
 * the median of their market-cap-to-TVL ratios; the global median across all live-token protocols
 * is the fallback for thin categories and the anchor the dashboard states.
 */
export interface CategoryRatios {
  byCategory: Map<string, number>;
  global: number;
}

export function categoryRatios(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryRatios {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.2;
  const byCategory = new Map<string, number>();
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? '';
    const list = perCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(key, list);
  }
  for (const [key, ratios] of perCategory) {
    if (ratios.length >= model.category_min_observations) {
      byCategory.set(key, Math.min(median(ratios), model.ratio_cap));
    }
  }
  return { byCategory, global: Math.min(global, model.ratio_cap) };
}

/** The ratio a protocol's category anchors on, and where the ratio came from. */
export function ratioFor(
  protocol: SnapshotProtocol,
  ratios: CategoryRatios,
): { ratio: number; source: 'category' | 'global' } {
  const own = protocol.category === null ? undefined : ratios.byCategory.get(protocol.category);
  if (own !== undefined) return { ratio: own, source: 'category' };
  return { ratio: ratios.global, source: 'global' };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  ratios: CategoryRatios,
  model: ModelConstants = MODEL,
): {
  implied: number;
  ratio: number;
  ratioSource: 'category' | 'global';
  growthPct: number;
  growthFactor: number;
  tenureFactor: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio, source } = ratioFor(protocol, ratios);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const tenure = Math.min(Math.max(ageForModel, 0), model.tenure_days) / model.tenure_days;
  const tenureFactor = 1 + tenure * model.tenure_weight;
  const implied = Math.max(1, Math.min(model.implied_cap, Math.round(protocol.tvl_usd * ratio * growthFactor * tenureFactor)));
  return { implied, ratio, ratioSource: source, growthPct, growthFactor, tenureFactor, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not a centralised exchange, and not a
 * versioned pool of another protocol. Bridges, staking and restaking products stay in: they record
 * no token in this snapshot, and a bridge or a staking protocol can issue a token of its own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const ratios = categoryRatios(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, strongest TVL
  // first. A chosen protocol stays chosen; the floor is where the reading starts, not where it stops.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, ratios, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_ratio: round4(s.v.ratio),
      ratio_source: s.v.ratioSource,
      growth_pct: round4(s.v.growthPct),
      growth_factor: round4(s.v.growthFactor),
      tenure_factor: round4(s.v.tenureFactor),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A category's two moves: the core position to open, and the second action that deepens it. */
interface CategoryMoves {
  core: (name: string, chain: string, capital: number) => string;
  second: (name: string, chain: string, capital: number) => string;
}

const MOVES: { match: string; moves: CategoryMoves }[] = [
  {
    match: 'lending',
    moves: {
      core: (n, c, k) => `Supply $${k} of USDC to ${n} on ${c} as a lender and leave the deposit earning.`,
      second: (n, c, k) => `Borrow $${Math.round(k / 2)} of a stablecoin against the deposit, then repay it the same week so the borrow is on record.`,
    },
  },
  {
    match: 'dex',
    moves: {
      core: (n, c, k) => `Add $${k} of liquidity to ${n}'s deepest pool on ${c} and keep the position in range.`,
      second: (n, c, k) => `Swap $${Math.round(k / 5)} between the pool's two assets on ${n} once a week to show trading activity.`,
    },
  },
  {
    match: 'liquid staking',
    moves: {
      core: (n, c, k) => `Stake $${k} of the chain's native asset through ${n} on ${c} and hold the receipt token.`,
      second: (n, c, k) => `Deposit the receipt token into a lending market on ${c} so the stake is used, not idle.`,
    },
  },
  {
    match: 'liquid restaking',
    moves: {
      core: (n, c, k) => `Restake $${k} of liquid staking tokens through ${n} on ${c} and hold the restaked receipt.`,
      second: (n, c, k) => `Delegate the restaked position to one of ${n}'s listed operators and leave the delegation in place.`,
    },
  },
  {
    match: 'restaking',
    moves: {
      core: (n, c, k) => `Restake $${k} of staked assets through ${n} on ${c} and keep the position delegated.`,
      second: (n, c, k) => `Opt into one of ${n}'s actively validated services and hold the position for the full term.`,
    },
  },
  {
    match: 'staking pool',
    moves: {
      core: (n, c, k) => `Stake $${k} of the chain's asset in ${n}'s pool on ${c} and keep the stake locked.`,
      second: (n, c, k) => `Claim the staking rewards each month and restake them through the same pool.`,
    },
  },
  {
    match: 'bridge',
    moves: {
      core: (n, c, k) => `Bridge $${k} of USDC onto ${c} through ${n} and use the bridged funds inside the app.`,
      second: (n, c, k) => `Bridge a smaller amount back the other way the following week so the route is used in both directions.`,
    },
  },
  {
    match: 'yield aggregator',
    moves: {
      core: (n, c, k) => `Deposit $${k} into ${n}'s highest-TVL vault on ${c} and hold the vault shares.`,
      second: (n, c, k) => `Move the shares into a second ${n} vault once a month to show the vaults are actively managed.`,
    },
  },
  {
    match: 'yield',
    moves: {
      core: (n, c, k) => `Deposit $${k} into ${n}'s main yield strategy on ${c} and leave the position compounding.`,
      second: (n, c, k) => `Claim the strategy's rewards once a month and redeposit them into the same strategy.`,
    },
  },
  {
    match: 'risk curator',
    moves: {
      core: (n, c, k) => `Deposit $${k} into a ${n} curated vault on ${c} and hold the vault shares.`,
      second: (n, c, k) => `Allocate a second deposit to a different ${n} vault with a different risk profile.`,
    },
  },
  {
    match: 'onchain capital allocator',
    moves: {
      core: (n, c, k) => `Allocate $${k} to an ${n} managed vault on ${c} and hold the allocation for the full term.`,
      second: (n, c, k) => `Rebalance the allocation between two ${n} vaults once a month to show active management.`,
    },
  },
  {
    match: 'rwa',
    moves: {
      core: (n, c, k) => `Mint $${k} of the yield-bearing asset through ${n} on ${c} and hold it in your wallet.`,
      second: (n, c, k) => `Use the minted asset as collateral in a lending market on ${c} so it is deployed, not idle.`,
    },
  },
  {
    match: 'cdp',
    moves: {
      core: (n, c, k) => `Lock $${k} of collateral in ${n} on ${c} and mint half its value in the protocol's stable asset.`,
      second: (n, c, k) => `Repay a quarter of the minted amount, then mint it again, to show the vault is actively managed.`,
    },
  },
  {
    match: 'derivative',
    moves: {
      core: (n, c, k) => `Deposit $${k} of USDC as margin on ${n} and open one small position with low leverage.`,
      second: (n, c, k) => `Close the position after a week and open a new one on the opposite side to show continued use.`,
    },
  },
  {
    match: 'perpetual',
    moves: {
      core: (n, c, k) => `Deposit $${k} of USDC as margin on ${n} and open one small perpetual position with low leverage.`,
      second: (n, c, k) => `Set a stop loss on the position and close it after a week, then open a fresh one.`,
    },
  },
  {
    match: 'basis trading',
    moves: {
      core: (n, c, k) => `Deposit $${k} into ${n}'s basis strategy on ${c} and hold the position for the full term.`,
      second: (n, c, k) => `Add a second deposit after a month to show the strategy is used more than once.`,
    },
  },
  {
    match: 'leveraged farm',
    moves: {
      core: (n, c, k) => `Open a leveraged farming position of $${k} on ${n}'s main pool on ${c} at low leverage.`,
      second: (n, c, k) => `Harvest the farming rewards once a week and redeposit them into the same pool.`,
    },
  },
  {
    match: 'liquidity manager',
    moves: {
      core: (n, c, k) => `Deposit $${k} into a ${n} managed liquidity position on ${c} and leave it rebalancing.`,
      second: (n, c, k) => `Withdraw a tenth of the position and redeposit it the next week to show the manager is used.`,
    },
  },
  {
    match: 'stablecoin wrapper',
    moves: {
      core: (n, c, k) => `Wrap $${k} of the underlying asset into the stable asset through ${n} on ${c}.`,
      second: (n, c, k) => `Use the wrapped asset in a lending market on ${c} so it is deployed, not idle.`,
    },
  },
  {
    match: 'dual-token stablecoin',
    moves: {
      core: (n, c, k) => `Mint $${k} of the stable asset through ${n} on ${c} against the protocol's collateral.`,
      second: (n, c, k) => `Hold the protocol's second token for a month alongside the minted stable asset.`,
    },
  },
  {
    match: 'insurance',
    moves: {
      core: (n, c, k) => `Buy $${k} of cover from ${n} on ${c} for a position you already hold.`,
      second: (n, c, k) => `Renew the cover when it lapses so the policy is held without a gap.`,
    },
  },
  {
    match: 'prediction',
    moves: {
      core: (n, c, k) => `Fund $${k} and take one market position on ${n} on ${c}.`,
      second: (n, c, k) => `Take a second position in a different market the following week to show continued use.`,
    },
  },
  {
    match: 'governance',
    moves: {
      core: (n, c, k) => `Deposit $${k} into ${n}'s governance vault on ${c} and delegate the voting power.`,
      second: (n, c, k) => `Vote on one live proposal through ${n} and keep the delegation in place.`,
    },
  },
  {
    match: 'indexes',
    moves: {
      core: (n, c, k) => `Buy $${k} of ${n}'s index token on ${c} and hold it for the full term.`,
      second: (n, c, k) => `Add a second purchase after a month to show the index is accumulated, not bought once.`,
    },
  },
  {
    match: 'collateral',
    moves: {
      core: (n, c, k) => `Supply $${k} of collateral to ${n}'s market on ${c} and keep the position open.`,
      second: (n, c, k) => `Borrow a small amount against the collateral, then repay it the same week.`,
    },
  },
  {
    match: 'payments',
    moves: {
      core: (n, c, k) => `Route $${k} of payments through ${n} on ${c} and keep the account funded.`,
      second: (n, c, k) => `Make one payment a week through ${n} so the account shows regular activity.`,
    },
  },
  {
    match: 'crypto card',
    moves: {
      core: (n, c, k) => `Load $${k} onto the card through ${n} on ${c} and spend from the loaded balance.`,
      second: (n, c, k) => `Top the card up once a month so the account stays active.`,
    },
  },
  {
    match: 'chain',
    moves: {
      core: (n, c, k) => `Bridge $${k} onto the ${n} chain and use its native apps for a week.`,
      second: (n, c, k) => `Stake a small amount of the chain's native asset to secure the network while you use it.`,
    },
  },
  {
    match: 'anchor btc',
    moves: {
      core: (n, c, k) => `Deposit $${k} of BTC into ${n}'s vault on ${c} and hold the receipt token.`,
      second: (n, c, k) => `Use the receipt token as collateral in a lending market on ${c}.`,
    },
  },
  {
    match: 'decentralized btc',
    moves: {
      core: (n, c, k) => `Mint $${k} of the BTC-backed asset through ${n} on ${c} and hold it.`,
      second: (n, c, k) => `Provide the minted asset to a lending market on ${c} so it is deployed.`,
    },
  },
  {
    match: 'cedefi',
    moves: {
      core: (n, c, k) => `Deposit $${k} into ${n}'s managed vault on ${c} and hold the shares.`,
      second: (n, c, k) => `Add a second deposit after a month to show the vault is used more than once.`,
    },
  },
  {
    match: 'farm',
    moves: {
      core: (n, c, k) => `Deposit $${k} into ${n}'s main farm on ${c} and keep the position staked.`,
      second: (n, c, k) => `Harvest the farm rewards once a week and restake them into the same farm.`,
    },
  },
  {
    match: 'uncollateralized',
    moves: {
      core: (n, c, k) => `Lend $${k} through ${n}'s credit market on ${c} and keep the loan open.`,
      second: (n, c, k) => `Check the borrower's repayment schedule each month and roll the loan when it matures.`,
    },
  },
  {
    match: 'interest rate',
    moves: {
      core: (n, c, k) => `Take a $${k} fixed-rate position on ${n} on ${c} and hold it to maturity.`,
      second: (n, c, k) => `Take a second position at a different maturity to show the market is used more than once.`,
    },
  },
];

/** The default moves for a category the table does not name. */
const DEFAULT_MOVES: CategoryMoves = {
  core: (n, c, k) => `Deposit $${k} of USDC into ${n} on ${c} and keep the position open.`,
  second: (n, c, k) => `Use the position once a week, such as a deposit, a swap or a claim, so the activity is regular.`,
};

/** The moves for a protocol's category, by the first matching keyword. */
function movesFor(p: SnapshotProtocol): CategoryMoves {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of MOVES) {
    if (c.includes(entry.match)) return entry.moves;
  }
  return DEFAULT_MOVES;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. It promises no token and no airdrop: it says what to do in the app, what it costs, and
 * how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const moves = movesFor(p);
  const steps: { text: string; cost: string; time: string }[] = [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`,
      cost: 'nothing to create, under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC onto ${chain} from an exchange or a bridge you already trust, and check the balance arrived.`,
      cost: `about $${capital >= 150 ? 8 : 4} of gas and bridge fees`,
      time: '15 minutes',
    },
    {
      text: moves.core(p.name, chain, capital),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: moves.second(p.name, chain, capital),
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Do one on-chain action each week, such as a deposit, a swap, a vote or a claim, so the wallet shows steady use.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
  return steps.map((s) => stepText(s.text, s.cost, s.time));
}

/** The live-token protocols, by market cap, for the dashboard's "already trading" view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_ratio: row.model.category_ratio,
    ratio_source: row.model.ratio_source,
    growth_factor: row.model.growth_factor,
    tenure_factor: row.model.tenure_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const ratios = categoryRatios(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_ratio: round4(ratios.global),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
