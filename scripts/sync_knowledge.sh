#!/bin/bash
# ==============================================================================
# AI Auto-Dev Knowledge Sync Script
# Automatically extracts DB schema, file tree, and architecture docs for the AI.
# Runs via cron on the AI Orchestrator Droplet.
# ==============================================================================

set -e # Exit on error

echo "🔄 Starting AI Knowledge Base Sync..."

# --- Configuration ---
REPO_DIR="/app/repo"             # Path to your cloned repo on the Droplet
KNOWLEDGE_DIR="/app/knowledge"   # Path to the AI's knowledge base
# SUPABASE_DB_URL must be set in the environment, e.g.:
# export SUPABASE_DB_URL="postgresql://postgres.[YOUR-PROJECT-REF]:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

# Ensure directories exist
mkdir -p "$KNOWLEDGE_DIR/db_schema"
mkdir -p "$KNOWLEDGE_DIR/architecture"
mkdir -p "$KNOWLEDGE_DIR/conventions"
mkdir -p "$KNOWLEDGE_DIR/history"

# --- Step 1: Pull latest code ---
echo "📦 Pulling latest codebase..."
if [ -d "$REPO_DIR/.git" ]; then
    cd "$REPO_DIR"
    git pull origin main
else
    echo "⚠️ Repo not found at $REPO_DIR. Skipping git pull."
fi

# --- Step 2: Dump Database Schema ---
echo "🗄️ Extracting Supabase Schema..."
if [ -z "$SUPABASE_DB_URL" ]; then
    echo "⚠️ SUPABASE_DB_URL is not set. Skipping schema dump."
    echo "Please set export SUPABASE_DB_URL='postgresql://...'"
else
    # Extract schema without data, exclude standard Postgres internal schemas to keep it clean for the AI
    pg_dump --schema-only "$SUPABASE_DB_URL" \
        --exclude-schema='pg_catalog' \
        --exclude-schema='information_schema' \
        --exclude-schema='auth' \
        --exclude-schema='storage' \
        --exclude-schema='graphql' \
        --exclude-schema='graphql_public' \
        --exclude-schema='realtime' \
        --exclude-schema='vault' \
        > "$KNOWLEDGE_DIR/db_schema/schema.sql"
    echo "✅ Schema saved to db_schema/schema.sql"
fi

# --- Step 3: Generate File Tree ---
echo "📂 Generating Project File Tree..."
# Use 'tree' if installed, otherwise use 'find'
if command -v tree &> /dev/null; then
    tree "$REPO_DIR" -I 'node_modules|.git|.next|dist|build|public' > "$KNOWLEDGE_DIR/architecture/file_tree.txt"
else
    find "$REPO_DIR" -type d \( -name node_modules -o -name .git -o -name .next \) -prune -o -print > "$KNOWLEDGE_DIR/architecture/file_tree.txt"
fi
echo "✅ File tree saved to architecture/file_tree.txt"

# --- Step 4: Map API Routes ---
echo "🔌 Mapping API Routes..."
echo "API Routes found in the repository:" > "$KNOWLEDGE_DIR/architecture/api_routes.txt"
find "$REPO_DIR/app/api" -name "route.ts" -o -name "route.js" 2>/dev/null >> "$KNOWLEDGE_DIR/architecture/api_routes.txt" || echo "No API directory found."
echo "✅ API routes saved to architecture/api_routes.txt"

# --- Step 5: Map Frontend Components ---
echo "🧩 Mapping Frontend Components..."
echo "React Components found in the repository:" > "$KNOWLEDGE_DIR/architecture/components.txt"
find "$REPO_DIR/frontend/components" -name "*.tsx" -o -name "*.jsx" 2>/dev/null >> "$KNOWLEDGE_DIR/architecture/components.txt" || echo "No components directory found."
echo "✅ Components mapped to architecture/components.txt"

# --- Wrap up ---
echo "✨ Knowledge Base Sync Complete! The AI Orchestrator is now up to date."
