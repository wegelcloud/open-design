---
name: flowai-live-dashboard-template
description: |
  Team-management dashboard template with live-artifact behavior.
  Use when users ask for admin dashboards with interactive charts, zoomable modules,
  dark mode, CSV export, and refreshable data cards.
triggers:
  - "flowai dashboard"
  - "team dashboard template"
  - "live dashboard template"
  - "interactive admin dashboard"
  - "可交互看板模板"
  - "实时模板"
od:
  mode: template
  platform: desktop
  scenario: live-artifacts
  preview:
    type: html
    entry: index.html
    reload: debounce-100
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  outputs:
    primary: index.html
    secondary:
      - template.html
      - data.json
  capabilities_required:
    - file_write
---

# FlowAI Live Dashboard Template

Deliver a polished team dashboard template with built-in interactions and a default sample.

## Resource map

```
flowai-live-dashboard-template/
├── SKILL.md
├── assets/
│   └── template.html
├── references/
│   └── checklist.md
└── example.html
```

## Workflow

1. Read active `DESIGN.md` and map it to root CSS variables.
2. Start from `assets/template.html`; never generate from blank.
3. Keep three tabs: `Team Members`, `Team Details`, `Activity Log`.
4. Ensure the output supports:
   - tab switching
   - chart rendering (line + bar)
   - hover tooltips for charts
   - module zoom in/out on click
   - dark mode toggle
   - export CSV buttons
5. Provide default sample data with plausible names and values.
6. Run `references/checklist.md` before final output.

## Output contract

One sentence before artifact, then:

```xml
<artifact identifier="flowai-live-dashboard" type="text/html" title="FlowAI Live Dashboard">
<!doctype html>
<html>...</html>
</artifact>
```
