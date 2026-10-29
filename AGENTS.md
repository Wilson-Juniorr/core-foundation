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
