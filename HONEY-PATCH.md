# Honey patch — keep the payment reference on bank transactions

**Repo:** `phoenix238/honeypot0101` · **File:** `honey-proxy/src/index.js` · **~line 225**

## The problem

The `/starling/transactions` handler flattens each transaction to a single
`description` field:

```js
description: item.counterPartyName || item.reference || 'Bank transaction',
```

For **money coming in**, `counterPartyName` is the sender's name and is almost
always present — so it wins, and `item.reference` is discarded before any caller
sees it.

That reference is the only thing identifying *which client* paid. Honey's README
says references are "what the bank-CSV and Starling matching key off", but for
bank transfers arriving through this endpoint they never survive the mapping, so
matching has nothing to key on but the payer's name — which is exactly what a
reference exists to disambiguate. Two clients called Jono are indistinguishable.

## The fix

Keep both fields. `description` is unchanged, so nothing that already reads it
breaks; `reference` and `counterPartyName` are simply no longer thrown away.

```diff
         const transactions = (data.feedItems || [])
           .filter(item => item.status === 'SETTLED')
           .map(item => ({
             feedItemUid: item.feedItemUid,
             date: (item.transactionTime || '').slice(0, 10),
             description: item.counterPartyName || item.reference || 'Bank transaction',
+            // The payer's own reference, kept separate from the display name.
+            // Collapsing the two loses the only field that says WHICH client
+            // paid — the sender's name can't do that job, which is the whole
+            // reason references exist.
+            reference: item.reference || '',
+            counterPartyName: item.counterPartyName || '',
             amount: Math.round((item.amount?.minorUnits || 0)) / 100,
             direction: item.direction === 'IN' ? 'IN' : 'OUT',
           }))
           .filter(t => t.date && t.amount > 0);
```

## Applying it

```bash
git clone https://github.com/phoenix238/honeypot0101
cd honeypot0101
# edit honey-proxy/src/index.js as above
cd honey-proxy && npx wrangler deploy      # see honey-proxy/DEPLOY.md
```

The Worker deploy is what actually takes effect — committing alone changes
nothing, since the endpoint runs from the deployed Worker rather than from the
Pages site.

## What this does and doesn't affect

- **CSTL doesn't need this.** It reads the Starling API directly with its own
  token, so it already gets the reference intact. This is worth doing for
  Honey's own sake.
- **Nothing that reads `description` changes.** The field keeps its exact
  current value; the patch only adds two more.
- Once deployed, Honey's own income matching can key on `reference` — and the
  `JS4`-style references CSTL hands out will match there too, since both sides
  would then be looking at the same field.
