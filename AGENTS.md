<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Follow-up rules

- Policy daily caps and the between-automation cooldown count "touches" (`src/lib/automation/touches.ts`): sends of the same run within 10 min, up to 3, are one touch — so a message and its 1-minute continuation are never split by the cooldown.
- WhatsApp connection status is parsed only in `src/lib/whatsapp/connection-state.ts` (tested): "disconnected" contains "connected", so disconnect must be checked first. A provider "disconnected" reply holds the follow-up action (`last_error = whatsapp_disconnected`, no attempt consumed) instead of failing the run.
- Follow-up dates go through `src/lib/smart/business-calendar.ts` (tested): commitment due dates are pushed to the next business day (weekends + national holidays), so the agent never schedules on non-working days.
- The smart agent may only offer discounts from active `commercial_conditions` rows (injected into the decision prompt); with none, it defends value and never invents a discount.
- When the smart agent leaves and returns to a conversation is decided only by `decideReturn` in `src/lib/smart/handoff.ts` (tested): the consultant's instruction wins, then hard locks (customer awaiting reply / human promise → hold; sensitive topics never return without approval), then the AI proposal; `return.server.ts` applies it from the minute tick. The engine never prepares actions while `owner = human`.
- Webhook outbound messages matching a recent automation send (same type/text, ≤3 min) are echoes, not human intervention (`isAutomationEcho`), so the agent doesn't silence itself.
- Owner alerts go to the consultant's personal WhatsApp through the durable `owner_alerts` queue (business days 08–20h, otherwise digested next morning); a disconnected WhatsApp keeps them pending without spending attempts.
- The post-quote deal sheet (stage, decider, quoted plan, temperature) lives as columns on `customer_memory`, merged only through `src/lib/ai/deal-sheet.ts` (tested): human-confirmed fields are never overwritten and empty AI readings never erase known facts.
