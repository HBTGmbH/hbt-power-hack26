---
name: new-issue
description: Create a GitHub issue for HBT Power that meets the Definition of Ready of AGENTS.md, and set its type. Use when asked to create, write, draft, split or refine an issue or ticket, or before creating a branch for work that has no issue yet.
---

# New issue that meets the Definition of Ready

Read the [Definition of Ready](../../../AGENTS.md#definition-of-ready), the
[GitHub workflow](../../../AGENTS.md#github-workflow) and the [Knowledge base](../../../AGENTS.md#knowledge-base)
rules first; this skill only adds the steps. Never create an issue that fails an item of the Definition of Ready: close
the gap from the code, or ask the user when only they can decide (scope, cut, a criterion).

## Steps

1. Read the request, the code it touches and `decisions <topic>`.
2. Type: `Bug` (defect), `Feature` (new capability for users or admins), `Task` (technical work without one).
3. Title and body in [German](../../../docs/arc42/02-randbedingungen.md#23-konventionen), in the domain language. The title says the result, without issue number. Body:

   ~~~markdown
   ## Ist-Zustand
   ## Wunsch
   ## Mockup            <!-- "Keine sichtbare Änderung." or a sketch; images from the skill ui-screenshot -->
   ## Diagramm          <!-- optional -->
   ## Akzeptanzkriterien
   ## Abgrenzung / Abhängigkeiten   <!-- optional -->
   ~~~

4. Check the issue items of the Definition of Ready sentence by sentence, one line each, and cut until all hold
   (`wc -m` for the length). Run the MCP tool `check` on the body if available.
5. Create the issue from a body file and set its type with the mutation from the GitHub workflow:

   ```bash
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   URL=$(gh issue create --repo "$REPO" --title "<title>" --body-file <file>)
   NODE_ID=$(gh api "repos/$REPO/issues/${URL##*/}" --jq .node_id)
   ```

6. Check with `gh issue view <n> --repo "$REPO" --json title,issueType,body`; report URL, type and step 4.

## Splitting an issue

Each part meets the Definition of Ready on its own, its *Ist-Zustand* being the state after the earlier parts, and
names the order under *Abgrenzung / Abhängigkeiten* ("setzt #A voraus", "bereitet #B vor"). Together the parts cover
every criterion of the original. Comment on the original only if the user wants it; ask before commenting in another
repository.
