# 🧩 Muhackl Games — Discord Feedback Bot

A lightweight, structured **Feedback Bot** for the Muhackl Games community. Players click **Give Feedback**, pick **Kind → Topic → Impact**, add a **title + details**, optionally attach media in a **temporary intake**, and the bot posts a **locked, beautifully formatted** forum thread.  
_Designed with our Alpine clarity, 🐮 “Muh” spirit, and clean UI._

---

## 🎯 Why this bot

- 🧭 **Guided flow** that keeps feedback focused and consistent
- 🏔️ **Clarity-first formatting** (concise titles, readable sections, emoji taxonomy)
- 📎 **Optional media intake** threads (auto-closes after 1 message)
- 🔒 **Locked feedback threads** (reporters can’t clutter posts; team replies in-thread)
- 🧱 **Resilient UX** with retry/backoff for shaky connections
- 🧀 **Emoji language** that’s friendly, readable, and on-brand

> _Tip:_ Use our Zugspitze silhouette and green/earthy tones in your Discord theme for a cohesive vibe.

---

## 🧰 Requirements

- **Node.js 18+** (recommend: Node 20)
- A Discord **bot** (Developer Portal)
- One **Forum channel** (for feedback posts)
- One **Text channel** (for temporary intake threads)

---

## ⚙️ Setup 

```bash
1) Clone & install
git clone https://github.com/MuhacklGames/Discord-Feedback-Bot.git
cd Discord-Feedback-Bot
npm install
2) Configure .env
Create .env (or copy from .env.example) and fill:

env
Copy Code
DISCORD_TOKEN=your_bot_token
GUILD_ID=your_guild_id
FEEDBACK_FORUM_CHANNEL_ID=forum_channel_id
INTAKE_PARENT_CHANNEL_ID=text_channel_id
PANEL_MESSAGE_URL=        # optional (exact jump link to the panel message)
EMOJI_WHITELIST=✨,👍,📌,🚨,❤️,💡,⚠️,⚖️,🧰,🚀,🌍,🧭,🖱️,🎮,📈,💰,♿,👥
USE_MESSAGE_CONTENT=true   # needed to parse links from intake text
3) Discord portal checklist
Scopes: bot, applications.commands

Bot permissions: View Channels, Send Messages, Read History,
Create Public/Private Threads, Send in Threads, Manage Threads

Invite the bot with the generated URL.

4) Channel permissions
Feedback Forum: allow bot to create posts/threads, send in threads, manage threads.

Intake Text Channel: allow bot to create private threads (public as fallback), manage threads.

5) Register command & run
bash
Code kopieren
npm run deploy      # adds /post_feedback_panel
npm run dev         # start the bot
In Discord (admin):
/post_feedback_panel → creates the panel thread with Give Feedback button.

🧱 Flow (what players see)
Click Give Feedback

Select Kind → Topic → Impact

Enter short title + clear details

(Optional) Post media in the temporary intake (auto-closes)

(Optional) Enter version

Bot creates a locked forum thread with emoji tags and clean sections

Example output

yaml
Copy Code
💬 [Title]
From: @User
Kind: Suggestion
Topic: UI/UX
Impact: Useful
Version: v0.0.16

Feedback details:
...
🪄 Muhackl styling notes
Emoji taxonomy (consistent across all comms):

Kind: ❤️ Praise • 💡 Suggestion • ⚠️ Concern • ⚖️ Balance • 🧰 QoL • 🚀 Performance • 🌍 Localization • 🧭 Other

Topics: 🖱️ UI/UX • 🎮 Gameplay • 📈 Progression • 💰 Economy • ♿ Accessibility • 👥 Multiplayer

Impact: ✨ Nice-to-have • 👍 Useful • 📌 Important • 🚨 Critical

Tone: helpful, playful, never noisy.

Branding: Alpine calm—clear headings, short sentences, minimal markup.

🧩 Customizing (for Lukas & team)
Open src/index.js and edit:

FEEDBACK_KIND, TOPIC_AREAS, IMPACT arrays to tweak labels/emojis

Panel embed text in makeFeedbackPanelEmbed()

Thread title/content builders for formatting tweaks

Want a direct “back to panel” jump? In Discord, Copy Message Link on the panel message and set it as PANEL_MESSAGE_URL in .env.

📦 Scripts
Command	What it does
npm run deploy	Registers /post_feedback_panel
npm run dev	Starts the bot

🗂️ Structure
pgsql
Code kopieren
discord-feedback-bot/
├─ .gitignore
├─ .env.example
├─ package.json
├─ README.md
└─ src/
   ├─ deploy-commands.js
   └─ index.js
   
📜 License
MIT License © 2025 Muhackl Games — crafted with Alpine focus and a little 🐮 “Muh”.
