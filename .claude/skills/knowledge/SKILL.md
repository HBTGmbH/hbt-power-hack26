---
name: knowledge
description: Projektwissen nachschlagen und pflegen. Nutzen bei Fragen zu Fachlichkeit, internen Prozessen, Begriffen, Architektur oder Entscheidungen, bevor Code mit unklarer fachlicher Bedeutung geändert wird, und wenn neues Wissen festgehalten werden soll.
---

# Wissensbasis des Projekts

Die Wissensbasis vereint drei Quellen mit verschiedenen Leserkreisen:

| Quelle | Leser | Kennzeichen |
|---|---|---|
| öffentliche Doku im Repository (arc42, README, AGENTS.md, `docs/`) | alle | – |
| Projekt-Sidecar | nur Projektmitglieder | **[INTERN]** |
| HBT-weites Wissen | alle Mitarbeiter | **[INTERN:HBT]** |

## Nachschlagen

1. `search` mit der Frage in eigenen Worten (MCP-Server `knowledge`; ohne MCP: `node tools/knowledge/kb.mjs search "<frage>"`). Optional `audience`: `business`, `domain` oder `tech`.
2. Fachbegriffe mit `define` klären, auch Code-Namen wie `ViewProfile`.
3. Die besten Treffer mit `read <id>` vollständig lesen, nicht nur den Ausschnitt.
4. In der Antwort die Quelle als id nennen. Wenn die Wissensbasis nichts hergibt, das sagen und im Code nachsehen.

Antworte passend zum Hintergrund des Fragenden: für Wirtschaft und Fachlichkeit ohne Code-Details und Abkürzungen, für Technik mit Verweisen auf Dateien.

## Entscheidungen

Öffentliche ADRs (arc42 Kapitel 9) und interne Entscheidungen (`ADR-Inn` im Sidecar) bilden ein gemeinsames Register. Der Session-Kontext listet alle mit Status.

- Bevor du Architektur, Abläufe oder Regeln änderst, prüfst du mit `decisions <thema>`, welche Entscheidung gilt, und liest sie mit `read ADR-nn`. Widerspricht deine Änderung einer geltenden Entscheidung, sag das dem Nutzer, statt sie still zu umgehen.
- Eine neue Entscheidung legst du mit `node tools/knowledge/kb.mjs decide public|intern|hbt "Titel" --issues "#nn"` an und füllst Kontext, Entscheidung und Konsequenzen aus. Öffentlich gilt: Wahl zwischen Alternativen mit Folgen für Architektur oder Entwicklung. Intern gilt: fachliche oder geschäftliche Gründe.
- Eine abgelöste Entscheidung bleibt stehen, mit Status „abgelöst durch ADR-nn“. Öffentliche Seiten nennen nie interne Entscheidungen (`ADR-I…`, `ADR-HBT-…`).

## Domänensprache

Das Glossar ist die verbindliche Domänensprache: ein Begriff je Sache. Der Session-Kontext enthält sie kompakt, Details liefert `define`.

- Benenne Dinge in Antworten, Doku, UI-Texten, Kommentaren und neuem Code mit dem Begriff aus dem Glossar bzw. seinem Namen im Code (in Klammern). Wörter aus „Nicht verwenden“ ersetzt du.
- Gibt es für eine neue Sache noch keinen Begriff, schlage einen vor und trage ihn ins Glossar ein, bevor du ihn benutzt: öffentlich in das Glossar des Projekts, interne Begriffe in `glossar.md` des Sidecars.
- Jeder Begriff ist eine eigene Notiz: öffentlich `docs/glossar/<Begriff>.md`, privat `Begriffe/<Begriff>.md` mit `aliases`, `code` und `nicht-verwenden`. Neu anlegen mit `node tools/knowledge/kb.mjs term public|intern|hbt "Name" --definition "…"`.
- **Verknüpfen:** Im Code-Repo nur normale Markdown-Links, relativ zur Seite: `[Berater](../glossar/Berater.md)`. In den privaten Quellen (Obsidian-Vault) Obsidian-Links: `[[Berater]]`, `[[Seite#Abschnitt]]`, und in ein anderes Modul mit dessen Ordner: `[[hbt/Begriffe/Berater|Berater]]`. Nie vom HBT-weiten Wissen auf ein Projektmodul verlinken. Erste Erwähnung eines Begriffs je Abschnitt verlinken, Schlagworte (`#vertrieb`) sparsam und einheitlich.
- `read` zeigt Rückverweise; nutze sie, um verwandte Seiten zu finden, bevor du etwas neu schreibst.
- Öffentliche Seiten verlinken nie auf interne Begriffe.

## INTERN-Inhalte

Nur zum Verstehen. Nie wörtlich oder sinngemäß übernehmen in: Code, Kommentare, Testdaten, Commit-Nachrichten, Issues, PRs, öffentliche Doku. Inhalte aus dem Projekt-Sidecar auch nicht ins HBT-weite Wissen, denn dort lesen alle Mitarbeiter mit. Ein Hook blockiert wörtliche Übernahmen; sinngemäße erkennt er nicht, die liegen bei dir. Wenn eine öffentliche Formulierung nötig ist, neutral und ohne interne Namen, Kunden oder Abläufe schreiben.

## Pflegen

Wenn in der Arbeit Wissen entsteht, das andere brauchen (ein Prozess wurde erklärt, ein Begriff geklärt, eine Entscheidung begründet), schlage dem Nutzer vor, es festzuhalten:

- **Öffentlich ins Repo**, wenn es Architektur, Code, Entwicklungsregeln oder Begriffe der Oberfläche betrifft. Bestehende Orte zuerst: arc42-Kapitel, Glossar, AGENTS.md.
- **In den Projekt-Sidecar** (`intern`), wenn es interne Prozesse, Kunden, Vertrieb, Betrieb oder Gründe dieses Projekts betrifft. Im Zweifel hierher.
- **Ins HBT-weite Wissen** (z. B. `hbt`) nur, was für alle Projekte gilt und nichts über ein bestimmtes Projekt verrät.

Neue Seite: `node tools/knowledge/kb.mjs new <public|intern|hbt> <pfad> --title "…" --audience business,domain`. Aufbau: Kopfdaten (`title`, `summary` als ein Satz für alle, `audience`, `owner` als Rolle, `reviewed`), dann „Kurz gesagt“, Details, „Für die Technik“ zuletzt. Keine Personennamen.

`node tools/knowledge/kb.mjs status` zeigt, welche Quellen gefunden wurden und welche Seiten Pflege brauchen.

Wird das Werkzeug als Plugin aus der zentralen Werkzeugverteilung genutzt statt als Kopie im Projekt, stehen dieselben Befehle über die MCP-Tools `knowledge` bereit.

## Jira

Projekte mit Jira tragen ihre Projektschlüssel in die `knowledge.json` des Projekt-Sidecars ein (`"jira": {"keys": ["PWR"]}`). Dann sind Schlüssel wie `PWR-123` in Commits, ADRs und Seiten Issue-Verweise, genau wie `#123` bei GitHub. Mit Zugang (`JIRA_URL`, `JIRA_TOKEN`, bei Cloud auch `JIRA_USER`) liest `kb jira PWR-123` einen Vorgang und `kb jira --since -14d` die Änderungen eines Zeitraums. Alternativ, mit Atlassian-Connector, über dessen Jira-Werkzeuge. Jira-Inhalte sind INTERN: Kontext für den Projekt-Sidecar und für ADR-Begründungen, nie Text für das öffentliche Repo. Personennamen nicht übernehmen.

## Aus Confluence übernehmen

Viele Projekte haben einen Confluence-Bereich. Ist der Atlassian-Connector verbunden, übernimm Seiten so:

1. **Leserkreis zuerst:** Ein Projektbereich wird zum Projekt-Sidecar (`intern`), ein HBT-weiter Bereich wird zu `hbt`. Ins Code-Repo kommt nur, was auch öffentlich sein darf, und dann neu formuliert, nicht kopiert.
2. **Eine Seite wird eine Notiz,** im passenden Ordner (`prozesse/`, `entscheidungen/`, …), mit Kopfdaten. Dazu kommen `quelle: confluence`, `confluence-id: <seiten-id>` und `reviewed`. Vorne steht „Kurz gesagt“, Veraltetes nicht übernehmen, sondern im Bericht nennen.
3. **Begriffe herauslösen:** Fachbegriffe werden Begriffs-Notizen (`kb term`), im Text verlinkt.
4. **Entscheidungen herauslösen:** Entscheidungen werden mit `kb decide` angelegt.
5. **Links umbauen:** Confluence-Links auf übernommene Seiten werden `[[…]]`. Links auf nicht übernommene Seiten bleiben als Link mit Hinweis.
6. Zum Schluss `kb audit`. Was sich nicht klären ließ, kommt als offener Punkt zum Nutzer.
