# How one alert is made, start to finish

**The example.** Kalshi has a market on *"Will the Fed cut interest rates in December?"* A YES share pays
$1 if the Fed cuts and $0 if it doesn't, so its price is the crowd's odds: 28¢ means a 28% chance.
Late on December 10 that price went from **28% to 51% in about 15 minutes**. This page follows that
move through the system until it appears as an alert card on screen.

> **Real or illustrative?** The prices, volumes, scores and times below come from actually running the
> detector on the project's built-in demo data. The headlines, the Claude explanation and the company
> list are made-up examples, because those services haven't been connected yet.

---

## The big picture

```mermaid
flowchart LR
    A["1. DOWNLOAD<br/>Get the market's price<br/>for every minute,<br/>plus how much traded"]
    B["2. SAVE<br/>Store those rows<br/>in a file on<br/>this laptop"]
    C["3. SPOT<br/>Check every minute:<br/>did something<br/>unusual happen?"]
    D["4. EXPLAIN<br/>Search the news<br/>from that time and<br/>ask Claude why"]
    E["5. WHO'S AFFECTED<br/>Look up the funds<br/>and companies tied<br/>to this topic"]
    F["6. SHOW<br/>Draw the chart and<br/>an alert card on<br/>the dashboard"]
    A --> B --> C --> D --> E --> F
```

| Step | Goes in | Comes out | When it runs | Code |
|---|---|---|---|---|
| 1. Download | Which market, which dates | Price and volume per minute | Only when someone runs a script by hand | `scripts/pull_data.py`, `dislocation_desk/ingest/` |
| 2. Save | Those rows | A file, `data/cache.duckdb` | Same time as step 1 | `ingest/cache.py` |
| 3. Spot | The saved rows for one market | A list of alerts | Every time the dashboard redraws | `detect.py` |
| 4. Explain | One alert's times and prices | A one- or two-sentence reason | When an alert card is drawn | `explain.py` |
| 5. Who's affected | The market's topic, e.g. "Fed rates" | Fund tickers and company names | When an alert card is drawn | `expose.py`, `config/exposure.yaml` |
| 6. Show | Everything above | The web page | Continuously | `app/streamlit_app.py` |

**Only step 2 saves anything.** Alerts, reasons and company lists are worked out again every time
the page loads.

---

## Steps 1–2: What gets downloaded and saved

The list of markets to watch lives in `config/markets.yaml`. For each one we download **one row per
minute** and keep exactly these columns:

| Time (UTC) | Price of YES | Contracts traded that minute |
|---|---|---|
| 23:30 | 27.5% | 154 |
| 23:40 | 27.9% | 285 |
| 23:45 | 36.7% | 504 |
| 23:50 | 46.8% | 813 |
| 23:55 | 50.9% | 830 |
| 00:00 | 50.4% | 15 |
| 00:10 | 50.1% | 107 |

A normal minute in this market sees about **80 contracts** traded.

- If no one traded in a minute, the last price is copied forward and the volume is set to 0.
- Kalshi provides volume. Polymarket doesn't, so for Polymarket markets that column is blank.

---

## Step 3: How the move is spotted

Every minute, the detector looks back over the **last 15 minutes** and asks three questions. An alert
fires only if **all three** pass.

```mermaid
flowchart TD
    START["Minute being checked: 23:54<br/>Over the last 15 min the price<br/>went from 28% to 51%"]

    Q1{"Question 1: Was the move BIG?<br/>Compare it with how much this market<br/>normally moves in 15 minutes,<br/>judged from the past 4 hours"}
    A1["Normal 15-min move: about 1 point<br/>This move: 23 points<br/>About 20 times bigger than normal"]

    Q2{"Question 2: Was REAL MONEY behind it?<br/>Compare trading in these 15 minutes<br/>with normal trading"}
    A2["Normal: about 80 contracts a minute<br/>During the move: 7.6 times that<br/>Many traders, not one stray order"]

    Q3{"Question 3: Did it STICK?<br/>Wait 30 minutes, then check<br/>whether the price stayed up"}
    A3["At 00:24 the price is still about 50%<br/>94% of the move is still there"]

    SCORE["Score = bigness x money x stickiness<br/>= 20.2 x 1.0 x 0.94 = 19.1<br/>Needs 4 or more to alert"]
    ALERT["ALERT<br/>28% to 51% in 15 min<br/>Can be shown from 00:24 onward"]

    NO["No alert<br/>Failing any one question<br/>makes the score zero"]

    START --> Q1
    Q1 -- "yes" --> A1 --> Q2
    Q2 -- "yes" --> A2 --> Q3
    Q3 -- "yes" --> A3 --> SCORE --> ALERT
    Q1 -- "no" --> NO
    Q2 -- "no" --> NO
    Q3 -- "no: price snapped back" --> NO
```

**Why each question exists:**

| Question | What it filters out |
|---|---|
| Big? | Ordinary day-to-day jitter. "Big" is relative to *this* market: a 3-point move is routine in a jumpy market and huge in a calm one. |
| Real money? | One small trade in a quiet market pushing the price around without many people agreeing. |
| Stuck? | Mistaken or one-off trades that reverse within minutes. These aren't news. |

**Two extra rules:**
- **Blips are ignored up front.** Before the three questions, each price is replaced by the middle
  value of the last 5 minutes. A price that flashes for a minute or two never registers as a move.
  The demo data has one: at 19:00 the price jumps from 33% to 62% for 2 minutes and comes straight
  back, and the detector never sees it.
- **Slow slides get their own check.** A price that creeps the same way for hours never has one big
  15-minute move, so a second check keeps a running total of small moves in one direction. In the
  demo it catches 49% to 36% over almost 3 hours.

---

## Steps 4–5: Explaining the move and finding who is affected

```mermaid
flowchart TD
    ALERT["The alert<br/>Fed cut odds 28% to 51%<br/>move from 23:39 to 23:54"]

    subgraph WHY ["Step 4: Why did it move?"]
        NEWS["Search the news index GDELT<br/>for 'Federal Reserve OR Powell'<br/>in articles published 22:39 to 00:24<br/>(1 hour before to 30 min after)"]
        HEADS["Headlines found<br/>illustrative: 'Fed official signals<br/>openness to December cut'"]
        CLAUDE["Send Claude the move, the headlines<br/>and a note on what this topic means,<br/>and ask for the most likely reason"]
        REASON["Reason, in 1-2 sentences<br/>illustrative: 'Odds jumped after a<br/>Fed official backed a December cut'"]
        NEWS --> HEADS --> CLAUDE --> REASON
    end

    subgraph WHO ["Step 5: Who is affected?"]
        TOPIC["This market is tagged<br/>topic: Fed rates"]
        FUNDS["Funds to watch, from a hand-written list<br/>TLT long-term US bonds, IEF mid-term bonds,<br/>HYG junk bonds, LQD corporate bonds,<br/>KRE regional banks, XLF banks"]
        SEC["Search company annual reports at the SEC<br/>for 'interest rate risk' + 'Federal Reserve'<br/>Companies that mention it most are listed"]
        TOPIC --> FUNDS
        TOPIC --> SEC
    end

    ALERT --> NEWS
    ALERT --> TOPIC
```

If there's no internet or no Claude key, step 4 shows the top headline or "Cause unclear", and step 5
shows only the fund list. The page never breaks.

---

## Step 6: When the alert appears on screen

The dashboard **replays** a past day as if it were happening live. Question 3 needs 30 minutes of
waiting, so the card can't honestly appear until 30 minutes after the move. The replay respects that.

```mermaid
flowchart LR
    T1["23:39<br/>Price starts climbing<br/>from 28%"]
    T2["23:54<br/>Price reaches 51%<br/>Chart shows the jump,<br/>but no card yet"]
    T3["23:54 to 00:23<br/>Waiting to see<br/>if the move sticks"]
    T4["00:24<br/>Move confirmed<br/>Alert card appears"]
    T1 --> T2 --> T3 --> T4
```

The card that appears at 00:24:

> 🔴 **JUMP · Fed rate decision, December** — 28% → 51% in 15 min (20.2σ, 7.6× volume)
> **Why:** *reason from step 4*
> **Exposed (Fed policy / rates):** TLT, IEF, HYG, LQD, KRE, XLF · *companies from step 5*
> Move 23:39–23:54, confirmed 00:24 UTC · score 19.1 · held 94%

"20.2σ" means "about 20 times a normal move", and "7.6× volume" means trading was 7.6 times normal.

---

## Nothing here is live yet

- Prices reach the saved file only when someone runs `scripts/pull_data.py` for chosen dates. The
  dashboard never contacts Polymarket or Kalshi, so it can't notice a move that's happening right now.
- The only internet calls the dashboard makes are steps 4 and 5, when an alert card is drawn.
