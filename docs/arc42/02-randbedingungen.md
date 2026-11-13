# 2. Randbedingungen

## 2.1 Technische Randbedingungen

| Randbedingung | Erläuterung |
|---|---|
| **JDK 13** für alle Java-Services | festgelegt in `.java-version`, CI (Zulu 13) und den Images (`azul/zulu-openjdk-alpine:13-jre`); warum und bis wann: [ADR-17](09-architekturentscheidungen.md#adr-17-vorerst-jdk-13-und-spring-boot-22) |
| **Spring Boot 2.2** (Profile, Skill, Report und View-Profile Service), **2.7** (Edge, Statistics) | Syntax für Profile in YAML: [`AGENTS.md`](../../AGENTS.md#architecture). |
| **MariaDB 11** | Drei Datenbanken: `profile`, `skill` und `report`. Die Kollation `utf8mb4_uca1400_ai_ci` ignoriert Groß-/Kleinschreibung und Akzente (#207). |
| **Redis 7** | Profilauszüge, Vorlagen-Metadaten, Statistikkopie. In der Produktion eine Instanz mit getrennten logischen Datenbanken. |
| **BIRT 4.3.1** mit iText 2.1.7 | Rendert DOCX und PDF. Die Vorlagen werden nur mit dem Eclipse BIRT Designer bearbeitet (#64). |
| **Webclient:** React 18, Material-UI v4, Create React App (react-scripts 5), Redux 4, TypeScript 5.3 | Node 20, festgelegt in `pwr-webclient/.nvmrc` (warum: [`README.md` › Prerequisites](../../README.md#prerequisites)) |
| **Microsoft Entra ID** (Azure AD) | Anmeldung (OIDC mit `@azure/msal-browser`) und App-Rollen `Power.User` und `Power.Admin`. |
| **Container** | Jeder Ordner liefert ein Image nach `ghcr.io/hbtgmbh/hbt-power/<ordner>`. Die Produktion läuft mit Docker Compose auf einem Host ([Kapitel 7](07-verteilungssicht.md)). |
| **Plattformen für die Entwicklung** | macOS (Apple Silicon und Intel), Linux und Windows mit Podman oder Docker (#1). |

## 2.2 Organisatorische Randbedingungen

| Randbedingung | Erläuterung |
|---|---|
| **Öffentliches Repository** | `HBTGmbH/hbt-power` ist öffentlich; was deshalb nirgends hingehört, regelt [`AGENTS.md` › GitHub workflow](../../AGENTS.md#github-workflow). |
| **Monorepo ohne Parent-POM** | Seit 2026-10-15 liegen die früheren Einzel-Repositories als Ordner nebeneinander. Jeder Ordner wird für sich gebaut, getestet und ausgeliefert ([ADR-01](09-architekturentscheidungen.md#adr-01-monorepo-mit-eigenständigen-projekten-je-ordner)). |
| **Arbeitsweise** | Kein Code ohne Issue; Issue, Branch, PR und Commit regeln der [GitHub-Workflow](../../AGENTS.md#github-workflow) und die [Definition of Ready](../../AGENTS.md#definition-of-ready) in `AGENTS.md`. |
| **Merge ist Deployment** | Jeder Merge nach `main` geht ohne Handgriff in die Produktion ([7.2](07-verteilungssicht.md#72-vom-merge-in-die-produktion)). |
| **Commit statt Version** | Ein Stand ist ein Commit (#77, [ADR-06](09-architekturentscheidungen.md#adr-06-commit-statt-version)). |
| **Abhängigkeiten** | Dependabot aktualisiert nur GitHub Actions. Maven und npm werden von Hand aktualisiert (#8). |
| **Entwicklung mit Agenten** | `AGENTS.md` (und `CLAUDE.md`) halten die Regeln so fest, dass Menschen und Agenten nach denselben arbeiten. |

## 2.3 Konventionen

- **Sprache:** Bedienoberfläche, Issues und PRs auf Deutsch; Code, Kommentare und `AGENTS.md` auf Englisch.
- **Zeilenenden:** festgelegt in `.gitattributes` (#46, [`AGENTS.md` › GitHub workflow](../../AGENTS.md#github-workflow)).
- **UI:** [`AGENTS.md` › Webclient](../../AGENTS.md#webclient).

## 2.4 Rechtliche Randbedingungen

- **Personenbezogene Daten:** Profile enthalten Namen, Geburtsdatum, Profilbild und den beruflichen Werdegang. Zugriff gibt es nur nach Anmeldung. Wer gelöscht wird, wird vollständig gelöscht, in allen Services (#240). An alle angemeldeten Benutzer geht nur das Nötigste (`GET /consultants/names`: Kürzel, Kurz- und voller Name, #216).
- **Lizenzierte Schrift:** Die [Hausschrift](../glossar/Hausschrift.md) ist lizenziert (#81, #82); was daraus folgt: [ADR-12](09-architekturentscheidungen.md#adr-12-lizenzierte-schrift-nie-im-repository-oder-image).
- **Keine Übertragung an Dritte im Browser:** Der Icon-Font wird selbst ausgeliefert, nicht von Google geladen (#109).
