# Gray Area Probes — Domain-Specific Discovery Templates

Use these probes during Phase 3 (Gray Area Identification) of Scout exploration.
After classifying the domain, scan the relevant probe list to identify gray areas the
user hasn't addressed. Rank by impact (high = expensive rework if wrong).

These are NOT questions to ask verbatim. They are patterns to check for unresolved ambiguity.
If the user's request already addresses a probe, skip it.

---

## SEE — UI / Visual Changes / Dashboards

- **Layout density**: packed with information or spacious with breathing room?
- **Empty states**: what shows when data hasn't loaded or doesn't exist yet?
- **Loading states**: skeleton, spinner, progressive, or nothing?
- **Error states**: inline message, toast, modal, redirect?
- **Interaction model**: click/hover/drag? Touch targets? Keyboard nav?
- **Responsive behavior**: mobile-first, desktop-first, or specific breakpoints?
- **Content overflow**: truncate, scroll, wrap, or paginate?
- **Theme/styling**: existing design system, custom, or component library?
- **Accessibility**: ARIA labels, focus management, contrast requirements?

## CALL — APIs / Integrations / CLI Commands

- **Auth mechanism**: API key, JWT, OAuth, session, none?
- **Error contract**: HTTP status codes? Error response shape? Retry policy?
- **Rate limiting**: any throttling? Back-off strategy?
- **Versioning**: URL path, header, query param?
- **Request format**: JSON body, form-data, query params, path params?
- **Response pagination**: offset, cursor, or no pagination?
- **Idempotency**: can the same request be safely retried?
- **Timeout behavior**: what happens on timeout? Client retry or fail?
- **Breaking changes**: who consumes this? What's the migration path?

## RUN — Background Jobs / Processes / Services

- **Trigger mechanism**: cron, event, manual, on-demand?
- **Failure handling**: retry (how many times? backoff?), dead letter, alert?
- **Concurrency**: can multiple instances run simultaneously? Locking?
- **Output**: where do results go? Log, database, file, message queue?
- **Observability**: metrics, logs, health checks? What gets monitored?
- **Timeout**: max duration? What happens when exceeded?
- **Dependencies**: what must be running/available for this to work?

## READ — Data Models / Storage / Documents

- **Data shape**: what fields? Types? Required vs optional?
- **Relationships**: one-to-many, many-to-many? Cascade behavior?
- **Indexing**: what queries will be frequent? What needs to be fast?
- **Migration strategy**: additive only, or breaking schema changes?
- **Retention**: how long is data kept? Soft delete or hard delete?
- **Access patterns**: read-heavy, write-heavy, or balanced?
- **Naming conventions**: snake_case, camelCase? Pluralization?

## ORGANIZE — Refactoring / Restructuring / Architecture

- **Scope boundary**: what moves and what stays?
- **Backward compatibility**: can old callers still work? Migration period?
- **File structure**: where do new files go? Naming conventions?
- **Dependency direction**: who depends on what? Circular risk?
- **Testing strategy**: how to verify the refactor didn't break anything?
- **Rollback plan**: can this be partially reverted?

## Cross-Cutting Probes (all domains)

- **Scope creep**: is the boundary between this feature and adjacent features clear?
- **Prior decisions**: are there existing patterns or conventions this must follow?
- **Downstream consumers**: who will use this output? What do they need?
- **Performance budget**: any latency, memory, or bundle size constraints?
- **Security surface**: does this introduce new attack vectors? (input validation, auth, secrets)
