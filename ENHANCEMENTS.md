# AWX UI Enhancements

Planned and in-progress UI/UX improvements for this AWX fork.

Legend: ⬜ Not started · 🔄 In progress · ✅ Done

---

## Already Completed

| # | Enhancement | Notes |
|---|-------------|-------|
| ✅ | Live system usage bar in navbar | Polls `/api/v2/instances/` every 30s; shows jobs count + progress bar + % with colour coding |
| ✅ | Usage bar moved to right side of navbar | Positioned after notifications, before help menu |
| ✅ | Overview page full-width on large screens | Removed `isWidthLimited` from `PageSection` in `PageDashboard.tsx` |
| ✅ | Dashboard card side padding removed | `PageSection` set to `padding: '16px 0'` so cards touch the content edges |
| ✅ | Counts card full-width | Changed `width="xxl"` → `width="full"` in `PageDashboardCountBar` |
| ✅ | Job Activity card full-width | Changed `width="xxl"` → `width="full"` in `AwxJobActivityCard` |
| ✅ | Jobs + Projects cards half-width each | `width="half"` — side-by-side on large screens |
| ✅ | Inventories card full-width | `width="full"` |
| ✅ | Resume workflow job support | `useResumeWorkflowJob` hook added |
| ✅ | Custom logo + login page branding | Logo upload via Settings, shown on login and masthead |
| ✅ | Custom settings navigation | Reorganised settings sidebar |

---

## Planned Enhancements

### Dashboard & Navigation

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 1 | **Collapsible sidebar** — icon-only mode to save horizontal space on smaller screens | Medium | ✅ |
| 2 | **Dashboard card drag-to-reorder** — persist custom card order per user | Low | ✅ |
| 3 | **Dark/light mode persistence** — store theme in user profile (server-side) so it survives browser changes | Medium | ✅ |
| 4 | **Job Activity card drill-down** — clicking a date point navigates to the jobs list filtered to that day | Medium | ✅ |
| 5 | **Global search (Cmd+K)** — command palette to search jobs, templates, inventories by name | High | ✅ |

### System Usage Bar (navbar)

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 6 | **Click to navigate** — clicking the usage bar opens `/infrastructure/instances` | High | ✅ |
| 7 | **Alert threshold** — bar pulses/blinks when capacity ≥ 90% | Medium | ✅ |
| 8 | **Per-node inline breakdown** — when multiple execution nodes exist, show a small bar per node (not just in tooltip) | Low | ✅ |

### Performance

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 9  | **Virtual scrolling for large lists** — use PatternFly `VirtualizedTable` for job/host lists with thousands of rows | High | ✅ |
| 10 | **WebSocket-driven dashboard refresh** — replace 30s polling with real-time AWX WebSocket event stream | Medium | ✅ |
| 11 | **Prefetch navigation data** — preload sidebar resource counts (hosts, inventories, etc.) on app load | Low | ✅ |

### Operations

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 12 | **Bulk job cancel** — "Cancel all running jobs" one-click action on the Jobs list | High | ✅ |
| 13 | **Job output full-screen mode** — expanded full-viewport view for the job output console | Medium | ✅ |

### Security & Administration

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 14 | **Session timeout warning** — notify the user 2 min before session expiry with an option to extend | High | ✅ |
| 15 | **Audit log viewer** — surface Activity Stream in a prominent, filterable UI rather than buried under Administration | Medium | ✅ |

### Developer Experience

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 16 | **OpenAPI → TypeScript types** — auto-generate TS interfaces from `make genschema` output to replace manually maintained `awx/ui/src/frontend/awx/interfaces/` files | Low | ⬜ |

---

## Notes

- **Build command**: `bash tools/scripts/deploy-ui.sh` from repo root
- **Container**: `tools_awx_1`, source bind-mounted at `/awx_devel/`
- **UI source**: `awx/ui/src/`
- **Framework**: React + PatternFly 5 + TypeScript
- **API**: DRF at `/api/v2/`
