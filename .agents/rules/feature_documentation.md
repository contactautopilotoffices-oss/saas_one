# 📚 FEATURE DOCUMENTATION & PERSISTENT KNOWLEDGE RULE

To prevent knowledge loss across sessions and ensure flawless "vibe coding", EVERY AI agent operating in this repository MUST follow these rules:

## 1. MANDATORY FEATURE DOCUMENTATION
- Whenever creating a new feature, modifying an existing feature's logic, or updating database schemas:
  - Create or update a detailed documentation file in `docs/features/<feature_name>.md`.
  - Document:
    1. **Business Purpose**: What the feature does.
    2. **Database Schemas & Triggers**: Exact table names, column lists, and outbox triggers attached to the feature.
    3. **API Routes**: Endpoint paths, methods, and expected payload structures.
    4. **Frontend Integration**: Main UI components and real-time subscription events.

## 2. KNOWLEDGE BASE ACCURACY
- If any existing workflow logic changes, immediately update the corresponding `.md` file in `docs/features/` or `knowledge/`.
- Future agent sessions will read these documentation files to maintain 100% accuracy without losing context over time.
