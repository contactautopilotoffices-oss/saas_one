#!/bin/bash

# Git Sync Pipeline Script
# Automates pulling and pushing with SSL/PAT handling

echo "🔄 Starting Git Sync Pipeline..."

# 1. Pull latest changes
echo "📥 Pulling latest changes from GitHub..."
git -c http.sslVerify=false pull origin main

if [ $? -eq 0 ]; then
    echo "✅ Pull successful."
else
    echo "❌ Pull failed. Please check for conflicts."
    exit 1
fi

# 2. Add and Commit local changes (if any)
if [[ -n $(git status -s) ]]; then
    echo "💾 Staging and committing local changes..."
    git add .
    git commit -m "sync: automated update via git-sync pipeline"
else
    echo "⚪ No local changes to commit."
fi

# 3. Push updates
echo "📤 Pushing updates to GitHub..."
git -c http.sslVerify=false push origin main

if [ $? -eq 0 ]; then
    echo "✅ Push successful. Pipeline complete! 🚀"
else
    echo "❌ Push failed. Check permissions or network."
    exit 1
fi
