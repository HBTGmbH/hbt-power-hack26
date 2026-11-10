# HBT-Wissen in Obsidian

Dieser Ordner ist ein **modularer Obsidian-Vault**. Er enthält selbst kein Wissen. Das Wissen liegt in Modulen, also privaten Git-Repositories, die als Unterordner hierher geklont werden. Jeder klont nur die Module, die er lesen darf:

```
HBT-Wissen/                  dieser Vault (Einstellungen, Vorlagen, diese Anleitung)
  .obsidian/
  _vorlagen/                 Seite, Begriff, Entscheidung
  hbt/                       HBT-weites Wissen: alle Mitarbeiter
  hbt-power/                 Projekt-Sidecar HBT Power: nur Projektmitglieder
  <weiteres-projekt>/        nur dessen Projektmitglieder
```

```bash
git clone <url-des-firmenwissens>       hbt
git clone <url-des-projekt-sidecars>    hbt-power
```

Die Ordnernamen sind fest. Sie stehen in der `knowledge.json` jedes Moduls (`module`), und Verknüpfungen über Modulgrenzen benutzen sie.

## Verknüpfen

- **Im selben Modul:** `[[Begriff]]`, `[[Seite#Abschnitt]]`, `[[Seite|anderer Text]]`, eingebettet `![[Bild.png]]`.
- **In ein anderes Modul:** mit Modulordner, z. B. `[[hbt/Begriffe/Berater|Berater]]`. Wem das Modul fehlt, der sieht einen offenen Link. Das Audit der Wissensbasis meldet das als „Modul fehlt“, nicht als Fehler.
- **Nur in Richtung gleicher oder größerer Leserkreis:** Ein Projektmodul darf auf `hbt/` verlinken, `hbt/` nie auf ein Projektmodul, weil sonst Projektnamen und -inhalte HBT-weit sichtbar würden.
- **Schlagworte:** `#vertrieb`, `#prozess/angebot` im Text oder unter `tags:` in den Eigenschaften.
- **Öffentliche Doku** (arc42 im Code-Repo) ist kein Modul. Verweise darauf als Wissens-id, z. B. `public:docs/arc42/09-architekturentscheidungen.md`. Im Code-Repo selbst gibt es keine `[[…]]`-Verknüpfungen, nur normale Markdown-Links.

## Begriffe

Jeder Begriff ist eine eigene Notiz in `Begriffe/`, angelegt mit der Vorlage „Begriff“ oder mit `kb term hbt|intern "Name"`. In den Eigenschaften stehen:

- `aliases`: andere Namen, unter denen der Begriff verlinkt werden darf
- `code`: Namen im Code
- `nicht-verwenden`: Wörter, die der Begriff ersetzt

## Einrichtung

1. Obsidian → „Ordner als Vault öffnen“ → diesen Ordner wählen.
2. Unter Einstellungen → Kernplugins „Vorlagen“ einschalten. Der Vorlagenordner ist schon eingetragen.
3. Damit Agenten den Vault finden, einmal `node <werkzeug>/kb.mjs vault <dieser-ordner> --register` ausführen. Der Befehl trägt ihn in `~/.config/knowledge/sources.json` ein. Jedes Projekt lädt dann das HBT-weite Modul und das eigene Projektmodul, andere Projektmodule nicht.
