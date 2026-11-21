# Contributor accounts and frontier-model credits

The module coach offers guided lessons, an operator-supplied free model, and an optional metered frontier model. Contributors see the configured model rates and their own balance under **AI usage and credits**. Stripe Checkout offers $5 in test credit per completed test payment. A configured commercial model can bill the operator for actual inference even when the contributor uses test credit. Studio adds no service fee.

## Give a contributor access

Run the CLI in the same environment as the Studio service. Both use `STUDIO_AUTHORING_DB`, which defaults to `~/.local/share/iconic-tutor/authoring.sqlite3`. For a workshop, use its configured database path. Keep the database and its backups private. The database contains account and project records, payment references and provider replies.

```sh
python3 scripts/studio_credits.py create-account 'Parker'
```

The command prints an account UUID and a private access code. Give the code to that contributor privately. In the coach, the contributor signs in under **AI usage and credits**. Each browser receives a separate 30-day HttpOnly session. Display names can repeat. The server uses the account UUID for balances and ownership. **Sign out** ends the current browser session. An operator can replace a lost code and end all sessions for that account with `python3 scripts/studio_credits.py rotate-code ACCOUNT_UUID`.

For an integration exercise, an operator can add a labeled test grant. Supply a UUID once and reuse it if retrying the same grant. This example grants 500 cents.

```sh
python3 scripts/studio_credits.py grant-test ACCOUNT_UUID 500 GRANT_UUID
```

## Connect a model

Set the following environment variables on the Studio server and restart it.

| Variable | Value |
| --- | --- |
| `STUDIO_FRONTIER_BASE_URL` | Server-controlled OpenAI-compatible API base, including its version path, such as `https://api.openai.com/v1` |
| `STUDIO_FRONTIER_MODEL` | Provider deployment/model that supports text chat completions, JSON output, a completion token limit and token usage receipts |
| `STUDIO_FRONTIER_API_KEY` | Private provider credential when the endpoint requires one |
| `STUDIO_FRONTIER_INPUT_USD_PER_MTOK` | Standard USD price per **million** input tokens for this deployment |
| `STUDIO_FRONTIER_CACHED_INPUT_USD_PER_MTOK` | USD price per million cached input tokens if the deployment discounts them. Defaults to the standard input rate |
| `STUDIO_FRONTIER_OUTPUT_USD_PER_MTOK` | USD price per million completion tokens, including billed reasoning tokens returned in the completion total |

Use the provider's current rates for a single flat-rate text deployment. Tiered pricing, tool fees and batch discounts require a different pricing contract. Set `STUDIO_LLM_BASE_URL` and `STUDIO_LLM_MODEL` only for the separate free-model service. Guided lessons work without either service.

To verify, sign in, fund the test account, select the frontier mode and ask one question. Check the input/output counts and debit in the transaction history. Each request takes an atomic credit hold for the prompt and maximum output before the server calls the provider. An insufficient balance returns HTTP 402. The ledger snapshots the rates and settles in integer micro-USD using the returned input, cached input and completion counts, rounding up once per request. Credit above the actual charge becomes available again. A provider receipt exceeding the reservation records the excess as operator-covered cost. The account history shows the latest 100 transactions.

## Connect hosted Stripe test Checkout

In a Stripe sandbox, select the test secret key for the account. For local testing, run the Stripe CLI against that sandbox and forward the four checkout events to the Studio server.

```sh
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired \
  --forward-to http://127.0.0.1:8766/api/credits/webhook
```

Keep the listener running. Configure `STUDIO_STRIPE_TEST_SECRET_KEY` with the sandbox `sk_test_` key and `STUDIO_STRIPE_TEST_WEBHOOK_SECRET` with the listener's `whsec_` signing secret in the Studio process environment. When using a registered test webhook on an HTTPS deployment, use that endpoint's signing secret. Launch the workshop with its exact HTTPS `--origin` and preserve the original Host at the reverse proxy. Forward Stripe events to the same workshop that created the order. Its dedicated database is `<workshop-data>/workshop.sqlite3`. [Stripe webhook testing](https://docs.stripe.com/webhooks#test-webhook)

Restart Studio. Sign in, prepare a $5 test checkout and open the hosted Stripe page. Complete it with Stripe's test payment details, return to the coach and refresh the balance. The signed event must identify the original local order and include the matching amount, currency and paid test session. Visiting the success URL alone has no effect on the ledger. An expired or failed payment leaves the balance unchanged. Re-delivering a successful event leaves the credit at $5. [Stripe test payment methods](https://docs.stripe.com/testing) · [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)

## Resolve an interrupted provider call

An explicit pre-inference rejection releases the hold. A timeout, process interruption or missing usage receipt can leave the provider outcome unknown. In that case the ledger retains the reservation and the same request ID cannot start another inference. Check the provider records after the original request has finished.

```sh
python3 scripts/studio_credits.py list-held
python3 scripts/studio_credits.py reconcile ACCOUNT_UUID REQUEST_UUID --unused
python3 scripts/studio_credits.py reconcile ACCOUNT_UUID REQUEST_UUID --usage INPUT_TOKENS CACHED_INPUT_TOKENS OUTPUT_TOKENS PROVIDER_RECEIPT_ID
```

Choose `--unused` only when the provider confirms no billable inference. Use `--usage` with the verified receipt when it did run. The reconciliation uses the original request's rates and credit limit.
