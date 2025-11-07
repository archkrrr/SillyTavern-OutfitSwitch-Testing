# Outfit Switcher for SillyTavern

Outfit Switcher is the slim single-character wardrobe manager spun out of the **Outfit Lab** inside [Costume Switcher for SillyTavern](https://github.com/archkrrr/SillyTavern-CostumeSwitch). It watches streaming responses, fires the right costume the moment a keyword or regex hits, and keeps manual overrides one click away. The extension still works great for focused setups or legacy installs while the Outfit Lab continues forward with richer UI and multi-character support.

**Costume Switcher at a glance:** the flagship extension that handles full-cast wardrobe automation, integrates with Character Expressions, and ships the Outfit Lab that inspired this standalone drawer. Install it if you want the complete experience; reach for Outfit Switcher when you need a lighter, single-character tool or compatibility with older builds.

Think of Outfit Switcher as the little brother carved out of the Outfit Lab. Costume Switcher remains the flagship, dressing the whole cast, sharing telemetry with Character Expressions, and evolving the Outfit Lab that now covers single-character workflows too. If you are starting fresh, install **Costume Switcher** and enable **Outfit Lab**—you will get everything documented here plus ensemble automation. Keep Outfit Switcher around only if you prefer its pared-back drawer or need a lightweight alternative for older SillyTavern builds.

Under the hood both extensions listen to streaming output, score the mentions they care about, and update costumes instantly. Costume Switcher layers scene awareness, focus locks, and outfit variants on top, while Outfit Switcher keeps those smarts targeted at a single pipeline. The shared lineage means tips from the Outfit Lab directly improve your Outfit Switcher setup and vice versa.

> **New to the Switcher family?** Start with **Costume Switcher** → enable **Outfit Lab** for single-character wardrobe control → consult the Character Expressions README for emotion swaps. Return here only if you need the archival Outfit Switcher drawer or a minimal install.


## Contents

1. [Highlights at a Glance](#highlights-at-a-glance)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Architecture Overview](#architecture-overview)
5. [Trigger & Variant Model](#trigger--variant-model)
6. [Getting Started in Five Minutes](#getting-started-in-five-minutes)
7. [Tour of the Settings UI](#tour-of-the-settings-ui)
    1. [Character Card](#character-card)
    2. [Variant Gallery](#variant-gallery)
    3. [Trigger Table](#trigger-table)
    4. [Status & Tips](#status--tips)
8. [Understanding Automatic Switches](#understanding-automatic-switches)
9. [Slash Command Reference](#slash-command-reference)
10. [Troubleshooting Checklist](#troubleshooting-checklist)
11. [Support & Contributions](#support--contributions)

---

## Highlights at a Glance

- **Single-character focus** – Keep one avatar in the spotlight and let Outfit Switcher handle every outfit change for that performer.
- **Stream-aware triggers** – Keywords and regexes are evaluated as tokens arrive, ensuring the correct outfit lands before the message finishes rendering.
- **Variant shortcuts** – Pair friendly names with costume folders so dramatic looks, seasonal outfits, and casual wear are just a click away.
- **Manual safety net** – Fire any variant from the panel or via slash command without waiting for automation.
- **Non-destructive switching** – Every action resolves to `/costume` calls; speaker focus never changes, avoiding accidental role swaps.

---

## Requirements

- **SillyTavern** v1.10.9 or newer (release or staging).
- **Streaming enabled** for your model or connector. Without streaming tokens, automatic switching will not run.
- **Browser storage access** to persist settings under the Outfit Switcher namespace.

---

## Installation

1. Open **Settings → Extensions → Extension Manager** in SillyTavern.
2. Click **Install from URL** and paste the repository address:
   ```
   https://github.com/archkrrr/SillyTavern-OutfitSwitch
   ```
3. Press **Install**. SillyTavern downloads the extension and refreshes the page.
4. Enable **Outfit Switcher** from the Extensions list if it is not activated automatically.

To update, revisit the Extension Manager and choose **Update all** or reinstall from the same URL.

---

## Architecture Overview

Outfit Switcher leans on the same event hooks as Costume Switcher but simplifies every step around a single character profile:

1. **Stream listener** – The extension subscribes to rendered and streaming assistant tokens, cleaning and buffering text without blocking the UI.
2. **Profile loader** – Your configured focus folder, variants, and triggers are compiled into a lightweight runtime bundle.
3. **Trigger evaluation** – As new text arrives, keyword and regex triggers run against the rolling buffer. Matches resolve to a target folder (base or variant).
4. **Switch dispatcher** – Matched triggers invoke `/costume` for the configured folder while respecting cooldowns and duplicate suppression.
5. **Status reporting** – The UI surfaces success and error banners, making it clear when a trigger fired or was ignored.

With one character to manage, you always know which folder will be used while still benefiting from real-time automation.

---

## Trigger & Variant Model

Outfit Switcher stores a single profile object containing:

- **Character folder** – The default costume path used when no trigger is active.
- **Variants** – Named shortcuts that append to the base folder or override it entirely for special looks.
- **Triggers** – Entries with a friendly name, keyword/regex, and target folder. Each trigger can reference the base folder or any variant.

This structure mirrors the Outfit Lab’s per-character view: one hero with optional alternates and a clear trigger list.

---

## Getting Started in Five Minutes

1. Enable the extension in **Settings → Extensions** and open the Outfit Switcher panel.
2. Enter your focus character’s display name and default costume folder (e.g., `characters/Ember Hart`).
3. Add variants for special outfits such as `characters/Ember Hart/Winter Gala` or `.../Battle Gear`.
4. Create trigger rows with friendly names, match text (plain keywords or regex), and the variant to run.
5. Talk with your model—when the trigger phrase appears, Outfit Switcher fires the mapped outfit automatically.

You can always click a variant’s **Run** button or use the slash command to override automation instantly.

---

## Tour of the Settings UI

### Character Card
Set the reference name and default costume folder. The card includes quick actions to test the default outfit and confirm the extension is enabled.

### Variant Gallery
Add, rename, or remove outfit variants. Each entry shows the resolved folder path plus a one-click **Run** button for manual switches.

### Trigger Table
Create trigger rows with three fields: friendly name, match text (keyword or regex), and the variant to activate. Buttons appear inline to test detection or delete the trigger.

### Status & Tips
Inline banners surface validation errors, successful saves, or warnings when a folder path is missing. The footer links to quick-start tips drawn from the Costume Switcher documentation.

---

## Understanding Automatic Switches

- **Keyword vs. regex** – Plain text triggers match case-insensitively, while regex triggers obey JavaScript syntax (wrap in `/pattern/` to enable flags like `i`).
- **Buffer window** – Up to 2,000 of the most recent characters are scanned to balance responsiveness with context.
- **Cooldowns** – Rapid repeat matches are ignored briefly so the same line does not spam costume calls.
- **Reset events** – Clearing chat or regenerating a message resets the buffer, ensuring fresh context for the next response.

If a trigger does not fire, open the browser console for detailed logs that show the processed buffer and which triggers were evaluated.

---

## Slash Command Reference

| Command | Description |
| --- | --- |
| `/outfitswitch <trigger>` | Manually activates the Outfit Switcher trigger named `<trigger>`. Unknown triggers or disabled states are safely ignored. |

> **Note:** `/trigger` remains the built-in STScript command in SillyTavern. Outfit Switcher only registers `/outfitswitch` and does not claim any aliases.

---

## Troubleshooting Checklist

1. **No switches occur:** Verify streaming output is enabled and the extension toggle is on.
2. **Trigger never fires:** Confirm the match text appears exactly (or adjust the regex), and ensure the variant points to an existing folder.
3. **Wrong outfit runs:** Check the trigger’s target in the table and confirm no duplicate trigger names exist.
4. **Manual runs fail:** Make sure `/costume` works for the chosen folder outside the extension—missing directories prevent switches.

---

## Support & Contributions

Issues and pull requests are welcome. When reporting a problem, include:

- The trigger or variant that misbehaved and the text that was expected to match.
- Your SillyTavern build number and API provider.
- Whether the issue happened during streaming automation or a manual command.

These details make it easier to reproduce the behaviour and suggest accurate fixes.
