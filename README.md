# Discord Feedback Bot

A Discord bot for **structured player feedback** in forum channels. Users click **Give Feedback**, select **Kind → Topic → Impact**, enter **title & details**, optionally add media via a **temporary intake**, and the bot posts a **locked forum thread** with smart formatting and emoji tags.

## Features
- 🧭 Guided, button-based flow (no slash commands for users)
- 🧱 Clean embed panel with emoji taxonomy (Kind/Topic/Impact)
- 📎 Optional intake thread for screenshots/videos/links
- 🔒 Auto-formatted, locked forum threads + reaction emojis
- 🕓 Ephemeral prompts, retry/backoff for bad connections
- ✅ Emoji whitelist support (optional)

## Requirements
- Node.js 18+ (recommended 20+)
- A Discord application & bot (Developer Portal)
- Forum channel for feedback + a text channel for intake threads

## Setup (Quick)
1. **Clone** the repo and install:
   ```bash
   npm install
