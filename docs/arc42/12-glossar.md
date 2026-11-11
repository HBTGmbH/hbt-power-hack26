# 12. Glossar

Das Glossar ist die verbindliche Domänensprache von HBT Power: ein Begriff je Sache, in Doku, Oberfläche, Code und Gesprächen mit Agenten ([ADR-27](09-architekturentscheidungen.md#adr-27-deutsche-domänensprache-mit-verbindlichem-glossar)). Jeder Begriff ist eine eigene Notiz in [`docs/glossar/`](../glossar/) mit den Namen im Code (`code`) und den Wörtern, die er ersetzt (`nicht-verwenden`). Verlinkt wird auf die Notiz, z. B. [Berater](../glossar/Berater.md). Neue Begriffe kommen dorthin, bevor sie benutzt werden: MCP-Tool `term` mit `scope: public` (siehe [Wissensbasis](https://github.com/HBTGmbH/hbt-leviathan-hack26#domänensprache)). Die Tabelle unten wird daraus erzeugt.

<!-- kb:begriffe -->
<!-- Erzeugt von `kb terms --index` aus den Begriffs-Notizen; dort ändern, nicht hier. -->

| Begriff | Bedeutung | Im Code | Nicht verwenden |
|---|---|---|---|
| [Admin](../glossar/Admin.md) | Benutzer mit der App-Rolle `Power.Admin`. Sieht alle Berater und pflegt Stammdaten. |  |  |
| [Admin-Bereich](../glossar/Admin-Bereich.md) | Der Teil des Webclients unter `/admin/home/…`, und die Pfade `/admin/**` der Services, die nur Admins erreichen |  |  |
| [Aktualisieren](../glossar/Aktualisieren.md) | Übernimmt die Änderungen des Profils in einen bestehenden Profilauszug, an Ort und Stelle, und behält dessen Einstellungen (`ViewProfileMergeService`, #332) |  |  |
| [Alias](../glossar/Alias.md) | Weiterer Name eines Skills im Skill-Baum (z. B. `JS` für `JavaScript`), global eindeutig ohne Groß-/Kleinschreibung, oder eines Profil-Elements, dort innerhalb des Typs eindeutig. Wer ihn tippt, bekommt den Skill bzw. das Element. Bei Profil-Elementen ist ein Alias ein [Früherer Name](<../glossar/Früherer Name.md>), auch wenn ein Admin ihn von Hand angelegt hat (#270). |  |  |
| [Anzeigekategorie](../glossar/Anzeigekategorie.md) | Kategorie des Skill-Baums, unter der ein Profilauszug Skills gruppiert (`display` in `SkillCategory`) | `SkillCategory.display` |  |
| [Berater](../glossar/Berater.md) | Mitarbeiterin oder Mitarbeiter der HBT mit Profil, identifiziert durch das Kürzel. Spezifischer als *Mitarbeiter*: Wo es um Profile geht, heißt es Berater. | `Consultant` |  |
| [Bereinigen](../glossar/Bereinigen.md) | Löscht im Housekeeping, was eine Prüfung gerade findet |  |  |
| [BIRT](../glossar/BIRT.md) | Eclipse Business Intelligence and Reporting Tools; rendert die Dokumente aus Vorlagen (`.rptdesign`) |  |  |
| [Datenleiche](../glossar/Datenleiche.md) | Datensatz, auf den nichts mehr zeigt oder der auf etwas Gelöschtes zeigt (z. B. ein Dokument zu einem gelöschten Berater). Unbenutzte Profil-Elemente oder eigene Skills sind keine Datenleichen, sondern gültige Einträge; das Housekeeping führt sie in der eigenen Rubrik *Unbenutzt* (#288). |  |  |
| [DBFile](../glossar/DBFile.md) | Gespeicherte Vorlagen-Datei im Report Service (Tabelle `designfiles`) |  |  |
| [Dokument](../glossar/Dokument.md) | Exportiertes Word-Dokument in der Historie des Report Service, mit Status `RUNNING`, `DONE` oder `ERROR` | `ReportData` |  |
| [Edge](../glossar/Edge.md) | `pwr-edge-service`, der einzige Eingang zu den Services: Tokenprüfung, Rollen, Identitäts-Header, Routing |  |  |
| [Eintragstyp](../glossar/Eintragstyp.md) | Art eines Profileintrags: Sprache, Qualifikation, Weiterbildung, Ausbildung, Branche, Werdegang, Schwerpunkt |  |  |
| [Entra ID](<../glossar/Entra ID.md>) | Microsoft Entra ID (früher Azure AD), der Identitätsanbieter für die Anmeldung und die App-Rollen |  |  |
| [Export](../glossar/Export.md) | Erzeugen eines Word-Dokuments aus einem Profilauszug mit einer Vorlage |  |  |
| [Früherer Name](<../glossar/Früherer Name.md>) | Alter Name eines umbenannten oder zusammengeführten Profil-Elements, oder ein Alias, den ein Admin angelegt hat (#270). Wer ihn tippt, bekommt das Element. Innerhalb des Typs eindeutig. Die Oberfläche nennt ihn [Alias](../glossar/Alias.md). | `NameEntityFormerName` |  |
| [Hausschrift](../glossar/Hausschrift.md) | Simplon Norm, lizenziert; in der Produktion als Volume eingebunden |  |  |
| [Housekeeping](../glossar/Housekeeping.md) | Admin-Seite und Endpunkte `/admin/housekeeping` je Service, die das System sauber halten: Rubrik *Datenleichen* melden und bereinigen (#242), Rubrik *Unbenutzt* für gültige Einträge, die niemand mehr nutzt (#288), Rubrik *Alt* für alte Exportdokumente und Profilauszüge (#289) |  |  |
| [Identitäts-Header](../glossar/Identitäts-Header.md) | `X-Pwr-User-Login`, `X-Pwr-User-Initials` und `X-Pwr-User-Admin`; die Edge setzt sie aus dem geprüften Token |  |  |
| [Ingress](../glossar/Ingress.md) | Der nginx vor allen Containern in der Produktion: TLS, `/` zum Webclient, `/api/` zur Edge |  |  |
| [Kürzel](../glossar/Kürzel.md) | Eindeutige Kennung eines Beraters, gleich dem Claim `mailnickname` seines Kontos, klein geschrieben | `initials` |  |
| [Kurzname](../glossar/Kurzname.md) | Name eines Kollegen in der App, z. B. `Kai B.` (`ConsultantShortNames`, #216) | `ConsultantShortNames` |  |
| [Lokalisierung](../glossar/Lokalisierung.md) | Übersetzung eines Skills, einer Kategorie (#174) oder eines Profil-Elements (#291) in eine Sprache (ISO 639-2); erscheint in Profilauszügen dieser Sprache und ihren Dokumenten | `LocalizedQualifier`, `NameEntityLocalization` |  |
| [Massenänderung](../glossar/Massenänderung.md) | Änderung vieler Profile auf einmal: Skills zusammenführen, umbenennen oder löschen, ebenso Profil-Elemente, oder einen Berater löschen. Danach wird die Statistik neu geladen. |  |  |
| [Mitarbeiter](../glossar/Mitarbeiter.md) | Alle Angestellten der HBT, mit oder ohne Profil. In HBT Power hat nur ein [Berater](../glossar/Berater.md) ein Profil; wo es um Profile geht, heißt es Berater. |  |  |
| [Other](../glossar/Other.md) | Kategorie des Skill-Baums, in die unbekannte Skills kommen, bis ein Admin sie einsortiert |  |  |
| [Power.User / Power.Admin](<../glossar/Power.User - Power.Admin.md>) | App-Rollen in Entra ID für Berater bzw. Admins |  |  |
| [Profil](../glossar/Profil.md) | Alle Angaben eines Beraters: Einträge, Projekte, Skills, Beschreibung |  |  |
| [Profil-Element](../glossar/Profil-Element.md) | Gemeinsamer Eintrag, den mehrere Profile benutzen: Firma, Projektrolle, Sprache, Qualifikation, Branche, Ausbildung, Weiterbildung, Werdegang, Schwerpunkt | `NameEntity` |  |
| [Profilauszug](../glossar/Profilauszug.md) | Bearbeitbare Momentaufnahme eines Profils für einen Export: Auswahl, Reihenfolge, Gruppierung, Sprache | `ViewProfile` | View-Profil, Viewprofil |
| [Profilprüfung](../glossar/Profilprüfung.md) | Was am Profil fehlt oder veraltet ist, mit Sprung zur Stelle, an der man es behebt (#139) |  |  |
| [Projekt](../glossar/Projekt.md) | Station eines Beraters mit Kunde, Vermittler, Rollen, Skills und Zeitraum |  |  |
| [Report Manager](<../glossar/Report Manager.md>) | Admin-Seite zum Hochladen und Pflegen der Vorlagen |  |  |
| [Skill](../glossar/Skill.md) | Fähigkeit mit Bewertung (1–5) und Versionen im Profil; im Skill-Baum ein Knoten mit Aliasen und Übersetzungen |  |  |
| [Skill-Baum](../glossar/Skill-Baum.md) | Die Hierarchie aus Kategorien und Skills im Skill Service. Seine Namen sind die Referenz für alle Skill-Namen. |  |  |
| [Stand](../glossar/Stand.md) | Ein Commit; Versionsnummern gibt es nicht (#77) |  |  |
| [Statistikkopie](../glossar/Statistikkopie.md) | Die Kopie aller Berater und Profile im Statistics Service (Redis) |  |  |
| [Vorlage](../glossar/Vorlage.md) | BIRT-Design mit Name und Beschreibung. Die Metadaten liegen im View-Profile Service, die Datei im Report Service. | `ReportTemplate` | Template |
| [Vorschau](../glossar/Vorschau.md) | PDF eines Profilauszugs mit einer Vorlage, live gerendert, nicht gespeichert |  |  |
| [Watchtower](../glossar/Watchtower.md) | Werkzeug in der Produktion, das neue Images zieht und die Container neu erzeugt |  |  |

<!-- /kb:begriffe -->

## Offene Begriffe

Die Domänensprache ist deutsch ([ADR-27](09-architekturentscheidungen.md#adr-27-deutsche-domänensprache-mit-verbindlichem-glossar)). Für die folgenden Fachbegriffe gibt es Vorschläge, aber noch keine Entscheidung. Bis dahin gilt der heutige Begriff. Technische Eigennamen bleiben, z. B. Edge, Ingress, BIRT, Watchtower, Entra ID und die Namen der Services.

- „Skill“ → Vorschlag „Kompetenz“, dazu „Kompetenzbaum“ und „Kompetenzsuche“. Im Code bleibt `Skill`.
- „Housekeeping“ → Vorschlag „Bereinigung“. Das passt zu *Bereinigen* und *Datenleiche*.
- „Report Manager“ → Vorschlag „Vorlagenverwaltung“
- „Report“ (in der Oberfläche für das erzeugte Word-Dokument) → Vorschlag „Dokument“, wie im Glossar
- „Other“ (Kategorie für unbekannte Skills) → Vorschlag „Sonstige“
- „Admin“, „Admin-Bereich“ → Vorschlag: bleiben, im Deutschen üblich

