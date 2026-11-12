# Debug Session: 3d-road-pick-color

Status: [BLOCKED: runtime evidence transport unavailable; static fix applied, interactive verification pending]

## Problem

3D route rendering uses a ground-clamped line and a raised PolylineVolume. User reports clicks do not show the selected solid entity information panel and selected/highlight color changes do not affect the solid volume. Expected: clicking the volume selects the associated road and both visual layers update color.

## Reproduction

Open the 3D metro view, click a visible volume route, observe selection/property panel and route/volume color. Repeat from an already selected route and from station detail context if applicable.

## Paths

- PROJECT_ROOT: C:\Users\33491\Desktop\成都智慧交通\smarttran
- DEBUG_EVIDENCE_DIR: C:\Users\33491\AppData\Local\Temp\trae-debug-3d-road-pick-color
- Log: C:\Users\33491\AppData\Local\Temp\trae-debug-3d-road-pick-color\trae-debug-log-3d-road-pick-color.ndjson
- Env: C:\Users\33491\AppData\Local\Temp\trae-debug-3d-road-pick-color\3d-road-pick-color.env

## Hypotheses

| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|---|---|---|---|---|
| A | Ground-clamped line wins the picked entity; drillPick ordering loses volume metadata | High | Low | raw hits show road: before road-volume; selected source remains ground line |
| B | Volume entity ID is not mapped to road business key | Medium | Low | rawId is road-volume:* and bizKey is null |
| C | Volume geometry lacks effective screen-space picking despite visible render | Medium | Medium | volume exists but absent in drillPick at clicked position |
| D | Highlight target filter or restore snapshot excludes volume IDs/material | High | Low | selection transition entity list lacks volume or volume material remains unchanged |

## Progress

- progress_status: blocked
- Runtime evidence transport: unavailable; the browser did not deliver any instrumentation events to the Debug Server, and no existing project-local structured sink can capture the same pick-event fields.

## Evidence Gate

| ID | Conclusion | Evidence |
|---|---|---|
| A | INCONCLUSIVE | No pre-fix runtime pick stack was captured. |
| B | INCONCLUSIVE | Static inspection identified that `bizKeyOf` rejected `road-volume:*`; this is not runtime evidence. |
| C | INCONCLUSIVE | No runtime pick result was captured. |
| D | INCONCLUSIVE | Existing highlight code includes `road-volume:` entities, but no runtime material transition was captured. |

The code change maps `road-volume:<id>:<index>` to `road:<id>` and gives a volume hit priority when choosing a selected business key. Browser verification of the property panel and visible color transition remains pending.
