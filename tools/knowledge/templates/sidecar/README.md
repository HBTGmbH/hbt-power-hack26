# Privater Wissens-Sidecar

Dieses Repository ist **privat**. Es ergänzt die öffentliche Doku eines Projekts um internes Wissen, das nicht veröffentlicht werden darf: fachliche Prozesse, interne Abläufe, Kunden- und Vertriebskontext, Betriebswissen.

Agenten und Menschen lesen beides zusammen über die Wissensbasis des Projekts (`tools/knowledge/kb.mjs`). Treffer von hier sind dort als **INTERN** markiert.

## Leserkreis

Dieser Sidecar gehört **einem Projekt**. Nur dessen Mitglieder bekommen Zugriff. Wissen, das für alle Projekte gilt, gehört in das **HBT-weite Wissen** (eigenes privates Repo, alle Mitarbeiter lesen). Die Wissensbasis zeigt beides zusammen, Treffer von hier mit **INTERN**, HBT-weite mit **INTERN:HBT**. Inhalte von hier dürfen nicht ins HBT-weite Wissen, ein Hook blockiert wörtliche Übernahmen.

## Obsidian

Dieses Repo ist ein Modul des HBT-Obsidian-Vaults und wird dort als Ordner mit dem Projektnamen geklont (`module` in [`knowledge.json`](knowledge.json)). Verknüpfungen sind Obsidian-Links: `[[Seite]]` im selben Modul, `[[hbt/Begriffe/Berater|Berater]]` ins HBT-weite Wissen. Die Anleitung steht in der README des Vaults (`kb vault`).

## Wo liegt der Sidecar?

Die Wissensbasis findet ihn ohne Einrichtung, wenn er neben dem Projekt ausgecheckt ist:

```
IdeaProjects/
  mein-projekt/              öffentliches Repo
  mein-projekt-knowledge/    dieses Repo
```

Anders geht es über `KB_PRIVATE_DIR=<pfad>`, über `.knowledge.local.json` im Projekt (`{"privateDir": "../woanders"}`, gitignored) oder als gitignorierter Ordner `.knowledge-intern/` im Projekt.

## Was gehört hierher?

| Hierher (intern) | In das öffentliche Repo |
|---|---|
| Fachliche Prozesse und interne Abläufe | Architektur, Code-Konzepte, Entscheidungen (arc42) |
| Kunden, Angebote, Preise, Verträge | Fachbegriffe, die in der Oberfläche stehen |
| Betrieb: Hosts, Zugänge, Ansprechpartner-Rollen | Setup und lokale Entwicklung |
| Gründe, die nur intern erklärbar sind | Regeln für die Entwicklung (AGENTS.md) |

Im Zweifel hierher. Verschieben ist später leicht, Zurückholen aus einem öffentlichen Repo nicht.

## Wie schreibe ich eine Seite?

Mit `node tools/knowledge/kb.mjs new intern prozesse/mein-prozess --title "Mein Prozess"` im Projekt entsteht eine Seite aus der Vorlage. Jede Seite hat:

- **Kopfdaten:** `title`, `summary` (ein Satz für alle), `audience` (`business`, `domain`, `tech`), `owner` (Rolle oder Team), `reviewed` (Datum der letzten Prüfung)
- **„Kurz gesagt“** zuerst, für Leser ohne Vorwissen
- Danach Details, „Für die Technik“ am Ende

Fachbegriffe sind eigene Notizen in `Begriffe/` (Eigenschaften `aliases`, `code`, `nicht-verwenden`), angelegt mit `kb term intern "Name"`. Interne Entscheidungen (`ADR-I01` …) liegen in `entscheidungen/`, eine Seite je Entscheidung, angelegt mit `node tools/knowledge/kb.mjs decide intern "Titel"`. Zusammen mit den öffentlichen ADRs bilden sie ein gemeinsames Register (`kb decisions`).

## Wöchentlicher Lauf

[`.github/workflows/consolidate.yml`](.github/workflows/consolidate.yml) gleicht jede Nacht auf Sonntag Code und Wissen ab. Der Lauf öffnet einen PR im Projekt und einen hier, mit Bericht, offenen Punkten und der Chronik der Woche unter `chronik/`. Wie das eingerichtet wird, steht in `tools/knowledge/README.md` im Projekt. Wenn die PRs regelmäßig gemergt werden, setzt der nächste Lauf dort an, wo dieser aufgehört hat (`consolidation/state.json`).

## Leak-Schutz

In [`knowledge.json`](knowledge.json) stehen unter `sensitiveTerms` Namen, die nie öffentlich auftauchen dürfen (Kunden, Systeme). Die Wissensbasis blockiert Commits, Issues, PRs und Dateien im öffentlichen Repo, die solche Begriffe oder ganze Sätze von hier enthalten, und `kb check` prüft das ganze Repo.
