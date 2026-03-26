# /project:daily-review
# Usage: /project:daily-review
# Runs the complete daily analytics review, identifies winners/losers, plans tomorrow.

Run the Agent OS v7 daily review cycle. Today is $CURRENT_DATE.

## Steps to execute:

1. **Fetch revenue data** — Call `POST /api/analytics { action: 'getDashboard' }`. Extract:
   - Total MRR (USD)
   - New customers today
   - Per-product MRR breakdown
   - Compare to yesterday (if available in Supabase)

2. **Fetch PostHog funnel** — Call `POST /api/posthog { action: 'getFunnel' }`. Extract per product:
   - `activation_rate` (tool_used / tool_opened)
   - `paywall_ctr` (payment_clicked / paywall_shown)
   - `email_capture_rate`
   - `daily_visitors`

3. **Identify winners** — Apply winner criteria (all must be true for 7 days):
   ```
   daily_visitors ≥ 200 AND activation_rate ≥ 40%
   AND paywall_ctr ≥ 15% AND mrr_usd ≥ $200
   ```
   For each winner: announce it, recommend building TYPE B version.

4. **Identify losers** — Apply loser criteria (all must be true for 30+ days):
   ```
   daily_visitors < 30 AND mrr_usd = 0
   AND conversion_rate < 0.5% AND !is_winner
   ```
   For each loser: recommend retirement, show the 301 redirect target.

5. **Optimization recommendations** — For each active product:
   - If conversion < 1.5% → "Test price reduction (current: $X → recommended: $Y)"
   - If paywall_ctr < 20% → "Rewrite paywall headline"
   - If activation < 35% → "Simplify UI — remove steps from main flow"

6. **Extract lessons** — List 3-5 insights from today's data, formatted as:
   ```
   💡 [Category]: [Specific lesson with numbers]
   ```

7. **Plan tomorrow's queue** — Recommend 5 keywords for tomorrow's build queue:
   - Same ICP as today's winner (if any)
   - Adjacent pain points to high-activation products
   - Score ≥ 7.0

8. **Output summary report**:
```
📊 Daily Review — [DATE]

Revenue
  MRR:          $XXX (+$X today)
  New customers: N
  Top earner:   [product] — $XX/mo

Product Health (top 5)
  [product] — $XX MRR | 47% activation | 18% paywall CTR ← 🏆 WINNER
  [product] — $0 MRR  | 12% activation | 3% paywall CTR  ← needs headline fix
  ...

Actions Required
  ✅ [product]: declare winner, queue TYPE B planning
  🔧 [product]: reduce price $15 → $10 (conversion 0.8%)
  🗑️ [product]: retire (day 34, $0, 8 visitors/day)

Tomorrow's Build Queue
  1. [keyword] — score 8.7 — [reason]
  2. [keyword] — score 8.2 — [reason]
  ...

Today's Lessons
  💡 Pricing: Products at $9/mo convert 3x better than $19/mo for Type A tools
  💡 ICP: Freelancer-targeted tools activate at 2x rate of general audience
  ...
```
