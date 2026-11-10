# HBT-weites Wissen

Dieses Repository ist **privat** und für **alle Mitarbeiter der HBT** lesbar. Es enthält Wissen, das für alle Projekte gilt:

- HBT-weite Prozesse
- die gemeinsame Domänensprache (Glossar)
- HBT-weite Entscheidungen (`ADR-HBT-01` …)

Die Wissensbasis bindet es in jedem Projekt zusätzlich zum Projekt-Sidecar ein. Treffer sind mit **INTERN:HBT** gekennzeichnet.

## Was gehört hierher, was nicht?

| Hierher (HBT-weit) | In den Projekt-Sidecar | In das öffentliche Projekt-Repo |
|---|---|---|
| Prozesse, die in allen Projekten gleich sind | Fachliche Prozesse und Kontext eines Projekts | Architektur, Code, Entwicklungsregeln |
| Begriffe, die HBT-weit gelten | Begriffe eines Projekts | Begriffe der Oberfläche des Projekts |
| Entscheidungen für alle Projekte | Entscheidungen eines Projekts (`ADR-I…`) | Architekturentscheidungen (`ADR-nn`) |

**Projektwissen gehört nie hierher.** Hier liest jeder Mitarbeiter mit, im Projekt-Sidecar nur die Projektmitglieder. Ein Hook der Wissensbasis blockiert Dateien hier, die Sätze oder sensible Begriffe aus dem Projekt-Sidecar enthalten. Umschreibungen erkennt er nicht.

## Obsidian

Dieses Repo ist das Modul `hbt/` des HBT-Obsidian-Vaults. Verknüpfungen sind Obsidian-Links (`[[Berater]]`). Von hier aus wird **nie** auf Projektmodule verlinkt. Die Anleitung steht in der README des Vaults (`kb vault`).

## Wie findet die Wissensbasis dieses Repo?

Ohne Einrichtung, wenn es neben den Projekten ausgecheckt ist. Die Wissensbasis erkennt es an `"level": "company"` in [`knowledge.json`](knowledge.json):

```
IdeaProjects/
  <firmenwissen>/         dieses Repo
  hbt-power/              öffentliches Projekt
  <projekt>-knowledge/    Projekt-Sidecar
```

Anders geht es über die Umgebungsvariable `KB_SOURCES=<pfad>`, über `.knowledge.local.json` im Projekt oder einmal je Rechner über `~/.config/knowledge/sources.json`:

```json
{ "sources": [{ "dir": "~/IdeaProjects/<firmenwissen>" }] }
```

## Pflege

- **Seiten:** `node tools/knowledge/kb.mjs new hbt prozesse/… --title "…"` in einem Projekt legt eine Seite aus der Vorlage an.
- **Entscheidungen:** `… decide hbt "Titel"` legt eine Entscheidung an.
- **Glossar:** Jeder Begriff ist eine Notiz in `Begriffe/` (`kb term hbt "Name"`). Ein Projekt darf einen Begriff für sich enger fassen; dann gilt seine Definition dort, und das Audit weist darauf hin.
- **Nachtlauf:** Der wöchentliche Lauf der Projekte liest dieses Repo nur. Was er hier ändern würde, steht als Vorschlag im Bericht des Projekts.
