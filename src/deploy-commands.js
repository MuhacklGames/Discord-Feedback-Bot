import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token   = process.env.DISCORD_TOKEN;
const appId   = process.env.APPLICATION_ID || process.env.CLIENT_ID; // either key is fine
const guildId = process.env.GUILD_ID;

if (!token || !appId || !guildId) {
  console.error('Missing DISCORD_TOKEN, APPLICATION_ID/CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const commands = [
  {
    name: 'post_feedback_panel',
    description: 'Admin: posts a guide thread with a “Give Feedback” button in the feedback forum',
    default_member_permissions: '8',
    options: [
      {
        name: 'text',
        description: 'Starter text for the panel (optional – embed is used by default)',
        type: 3,
        required: false
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Deploying application (guild) commands…');
    await rest.put(
      Routes.applicationGuildCommands(appId, guildId),
      { body: commands }
    );
    console.log('✅ Commands deployed.');
  } catch (error) {
    console.error('❌ Deploy failed:', error);
    process.exit(1);
  }
})();
