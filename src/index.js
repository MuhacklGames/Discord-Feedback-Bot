import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, EmbedBuilder, PermissionFlagsBits
} from 'discord.js';

/* ====== ENV ====== */
const TOKEN = process.env.DISCORD_TOKEN;
const FEEDBACK_FORUM_ID = process.env.FEEDBACK_FORUM_CHANNEL_ID;
const INTAKE_PARENT_ID = process.env.INTAKE_PARENT_CHANNEL_ID;
const PANEL_MESSAGE_URL = process.env.PANEL_MESSAGE_URL || null;
const PANEL_TARGET_ID = process.env.PANEL_TARGET_ID || null;
const USE_MC = String(process.env.USE_MESSAGE_CONTENT ?? 'true').toLowerCase() === 'true';

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
];
if (USE_MC) intents.push(GatewayIntentBits.MessageContent);

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const EMOJI_WHITELIST = new Set((process.env.EMOJI_WHITELIST ?? '')
  .split(',').map(s => s.trim()).filter(Boolean));

/* ====== CONSTS ====== */
const IDS = {
  BTN_OPEN: 'fb_open',
  BTN_CONTINUE_MAIN: 'fb_continue_main',
  BTN_ENTER_VERSION: 'fb_enter_version',
  BTN_RESUME: 'fb_resume',
  SEL_KIND: 'fb_sel_kind',
  SEL_TOPIC: 'fb_sel_topic',
  SEL_IMPACT: 'fb_sel_impact',
  SEL_MEDIA: 'fb_sel_media',
  MOD_MAIN: 'fb_mod_main',
  MOD_VERSION: 'fb_mod_version'
};

const FEEDBACK_KIND = [
  { label: 'Praise',     value: 'praise',     emoji: '❤️' },
  { label: 'Suggestion', value: 'suggestion', emoji: '💡' },
  { label: 'Concern',    value: 'concern',    emoji: '⚠️' },
  { label: 'Balance',    value: 'balance',    emoji: '⚖️' },
  { label: 'QoL',        value: 'qol',        emoji: '🧰' },
  { label: 'Performance',value: 'perf',       emoji: '🚀' },
  { label: 'Localization', value: 'loc',      emoji: '🌍' },
  { label: 'Other',      value: 'other',      emoji: '🧭' }
];

const TOPIC_AREAS = [
  { label: 'UI/UX',        value: 'UI/UX',        emoji: '🖱️' },
  { label: 'Gameplay',     value: 'Gameplay',     emoji: '🎮' },
  { label: 'Progression',  value: 'Progression',  emoji: '📈' },
  { label: 'Economy',      value: 'Economy',      emoji: '💰' },
  { label: 'Accessibility',value: 'Accessibility',emoji: '♿' },
  { label: 'Multiplayer',  value: 'Multiplayer',  emoji: '👥' },
  { label: 'Other',        value: 'Other',        emoji: '🧭' }
];

const IMPACT = [
  { label: 'Nice-to-have', value: 'nice', emojis: ['✨'] },
  { label: 'Useful',       value: 'useful', emojis: ['👍'] },
  { label: 'Important',    value: 'important', emojis: ['📌'] },
  { label: 'Critical',     value: 'critical', emojis: ['🚨'] }
];

const MEDIA_YN = [
  { label: 'Yes, I have screenshots/videos/links', value: 'yes' },
  { label: 'No, continue without',                  value: 'no' }
];

const NET = { LONG_STEP_HINT_MS: 6000, MAX_RETRIES: 4, BASE_DELAY_MS: 600, JITTER_MS: 300 };

/* ====== STATE ====== */
const sessions = new Map();
const processed = new Set();

/* ====== HELPERS ====== */
function makeFeedbackPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x4CC9F0)
    .setTitle('Give Feedback')
    .setDescription(
      'Follow these quick steps. We’ll create a locked thread and follow up there.\n' +
      'You can dismiss the bot pop-ups (bottom-right).'
    )
    .addFields(
      {
        name: 'How it works',
        value:
          '1️⃣ Click **Give Feedback**\n' +
          '2️⃣ Pick **Kind → Topic → Impact**\n' +
          '3️⃣ Enter a **short title** + **clear details**\n' +
          '4️⃣ *(Optional)* Post media in a temporary intake (one message)\n' +
          '5️⃣ *(Optional)* Add version',
      },
      {
        name: 'Emoji legend — Kind',
        value: '❤️ Praise • 💡 Suggestion • ⚠️ Concern • ⚖️ Balance • 🧰 QoL • 🚀 Performance • 🌍 Localization • 🧭 Other',
      },
      {
        name: 'Emoji legend — Topics',
        value: '🖱️ UI/UX • 🎮 Gameplay • 📈 Progression • 💰 Economy • ♿ Accessibility • 👥 Multiplayer',
      },
      {
        name: 'Emoji legend — Impact',
        value: '✨ Nice-to-have • 👍 Useful • 📌 Important • 🚨 Critical',
      },
      {
        name: 'Notes',
        value:
          '• Threads are **read-only** for reporters\n' +
          '• One idea per feedback helps us track & act faster',
      }
    )
    .setFooter({ text: 'Thank you for helping us improve the game!' });
}

function alreadyProcessed(i) {
  if (processed.has(i.id)) return true;
  processed.add(i.id);
  setTimeout(() => processed.delete(i.id), 60_000);
  return false;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const backoff = (a) => NET.BASE_DELAY_MS * Math.pow(2, a) + Math.floor(Math.random()*NET.JITTER_MS);

async function withRetries(label, fn) {
  let lastErr;
  for (let a = 0; a < NET.MAX_RETRIES; a++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.code;
      if (status && status !== 429 && String(status).startsWith('4')) break;
      await sleep(backoff(a));
    }
  }
  console.error(`[withRetries:${label}]`, lastErr);
  throw lastErr;
}

function startWaitTicker(i) {
  let active = true;
  const timer = setTimeout(async () => {
    if (!active) return;
    try {
      const dots = ['.', '..', '...'];
      let t = 0;
      while (active) {
        t = (t + 1) % dots.length;
        await i.editReply({ content: `⏳ Please wait${dots[t]} – slow connection or server load.` }).catch(()=>{});
        await sleep(2000);
      }
    } catch {}
  }, NET.LONG_STEP_HINT_MS);
  return () => { active = false; clearTimeout(timer); };
}

async function tryDeferEphemeral(i) {
  try {
    if (!i.deferred && !i.replied) {
      await i.deferReply({ flags: 64 });
      return true;
    }
  } catch {}
  return i.deferred || i.replied;
}

function panelJumpText(label = 'back to the panel') {
  if (PANEL_MESSAGE_URL) return `[${label}](${PANEL_MESSAGE_URL})`;
  if (PANEL_TARGET_ID)   return `<#${PANEL_TARGET_ID}>`;
  return label;
}

const severityLabel = (v) => ({
  nice: 'nice-to-have',
  useful: 'useful',
  important: 'important',
  critical: 'critical'
}[v] || 'unspecified');

function buildThreadTitle(s) {
  const kindEmoji = FEEDBACK_KIND.find(k => k.value === s.kind)?.emoji ?? '🗨️';
  const topicEmoji = TOPIC_AREAS.find(t => t.value === s.topic)?.emoji ?? '';
  const impact = (IMPACT.find(i => i.value === s.impact)?.label || 'Feedback').toUpperCase();
  return `${kindEmoji}${topicEmoji ? ' ' + topicEmoji : ''} | Feedback | ${s.topic || 'General'} – ${s.title} [${impact}]`.slice(0, 90);
}

function buildThreadContent(uid, s) {
  const linksBlock = (s.links?.length) ? `\n🔗 **Additional links**\n${s.links.map(u => `• ${u}`).join('\n')}\n` : '';
  const impactTxt = severityLabel(s.impact);
  return (
`### 💬 ${s.title}

**From:** <@${uid}>  
**Kind:** ${s.kind ?? '-'}  
**Topic area:** ${s.topic ?? '-'}  
**Impact:** ${impactTxt}

📝 **Feedback details:**  
${s.desc}

**Version (optional):** ${s.version || '-'}

${linksBlock}—`
  );
}

function stepComponents(s) {
  switch (s.step) {
    case 1: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_KIND)
        .setPlaceholder('What kind of feedback is this?')
        .addOptions(FEEDBACK_KIND.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setEmoji(o.emoji);
          if (s.kind === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'Select the **kind** of your feedback.', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 2: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_TOPIC)
        .setPlaceholder('Which topic area fits best?')
        .addOptions(TOPIC_AREAS.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setEmoji(o.emoji);
          if (s.topic === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'Pick the **topic area** this feedback refers to.', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 3: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_IMPACT)
        .setPlaceholder('How impactful would this be?')
        .addOptions(IMPACT.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setEmoji(o.emojis[0]);
          if (s.impact === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'Estimate the **impact** if implemented.', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 4: {
      const btn = new ButtonBuilder().setCustomId(IDS.BTN_CONTINUE_MAIN).setLabel('Enter title & details').setStyle(ButtonStyle.Primary);
      return { text: 'Now add a **short title** and a **clear, actionable description**.', components: [new ActionRowBuilder().addComponents(btn)] };
    }
    case 5: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_MEDIA)
        .setPlaceholder('Do you want to share screenshots/videos/links?')
        .addOptions(MEDIA_YN.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value);
          if (s.mediaYN === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'Would media help illustrate your feedback?', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 6: {
      const btn = new ButtonBuilder().setCustomId(IDS.BTN_ENTER_VERSION).setLabel('Enter version (optional)').setStyle(ButtonStyle.Secondary);
      const note = s.mediaYN === 'yes'
        ? (s.intakeCaptured
            ? `✅ Intake captured. Click **Enter version**.`
            : `✉️ A **temporary intake** was opened. Post **ONE** message there (text + media/links). It will **auto-close**. Then click **Enter version**.`)
        : `No intake opened. Continue with **Enter version** or just submit.`;
      const link = s.intakeThreadId ? `\n🔗 Intake: <#${s.intakeThreadId}>` : '';
      return { text: `${note}${link}`, components: [new ActionRowBuilder().addComponents(btn)] };
    }
    default:
      return { text: 'Done.', components: [] };
  }
}

/* ====== READY ====== */
const onClientReady = () => console.log(`✅ Feedback Bot online as ${client.user.tag}`);
client.once('ready', onClientReady);
client.once('clientReady', onClientReady);

/* ====== ADMIN SLASH: /post_feedback_panel ====== */
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'post_feedback_panel') return;

  try {
    await i.deferReply({ flags: 64 });

    if (!FEEDBACK_FORUM_ID) {
      return await i.editReply('❌ FEEDBACK_FORUM_CHANNEL_ID missing in `.env`.');
    }

    const forum = await client.channels.fetch(FEEDBACK_FORUM_ID).catch(() => null);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      return await i.editReply('❌ Feedback forum not found or wrong channel type.');
    }

    const me = i.guild.members.me;
    const perms = forum.permissionsFor(me);
    const need = [
      'ViewChannel',
      'SendMessages',
      ('CreatePosts' in PermissionFlagsBits ? 'CreatePosts' : 'CreatePublicThreads'),
      'SendMessagesInThreads',
      'ManageThreads',
      'ReadMessageHistory'
    ];
    const missing = need.filter(p => !perms?.has(PermissionFlagsBits[p]));
    if (missing.length) {
      return i.editReply('❌ Missing forum permissions:\n• ' + missing.join('\n• '));
    }

    const openBtn = new ButtonBuilder().setCustomId(IDS.BTN_OPEN).setLabel('Give Feedback').setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(openBtn);
    const embed = makeFeedbackPanelEmbed();

    const thread = await forum.threads.create({
      name: '📌 Feedback Panel – Start here',
      message: { embeds: [embed], components: [row] },
      reason: 'Feedback panel'
    });

    const starterMsg = await thread.fetchStarterMessage().catch(() => null);
    if (starterMsg?.url) console.log('Panel message URL:', starterMsg.url);

    await i.editReply({ content: `✅ Panel created: <#${thread.id}>` });
  } catch (err) {
    console.error('post_feedback_panel error', err);
    const msg = '❌ Failed to post panel. Check forum type, permissions, and logs.';
    if (i.deferred || i.replied) await i.editReply(msg);
    else await i.reply({ content: msg, flags: 64 });
  }
});

/* ====== OPEN FLOW ====== */
client.on('interactionCreate', async (i) => {
  try {
    if (!i.isButton() || i.customId !== IDS.BTN_OPEN) return;
    if (alreadyProcessed(i)) return;

    const deferred = await tryDeferEphemeral(i);
    const stopTicker = startWaitTicker(i);

    const s = { step: 1, files: [], links: [], intakeCaptured: false, posting: false, threadId: null, finalized: false };
    sessions.set(i.user.id, s);

    const first = stepComponents(s);
    if (deferred) await i.editReply({ content: first.text, components: first.components });
    else await i.reply({ content: first.text, components: first.components, flags: 64 });

    stopTicker();
  } catch (err) {
    console.error('BTN_OPEN error', err);
    try {
      if (i.deferred || i.replied) await i.editReply({ content: '❌ Unexpected error. Please try again.' });
      else await i.reply({ content: '❌ Unexpected error. Please try again.', flags: 64 });
    } catch {}
  }
});

/* ====== SELECTS ====== */
client.on('interactionCreate', async (i) => {
  if (!i.isStringSelectMenu()) return;
  const s = sessions.get(i.user.id); if (!s || s.finalized) return;

  try {
    if (!i.deferred && !i.replied) await i.deferUpdate();

    if (i.customId === IDS.SEL_KIND && s.step === 1) {
      s.kind = i.values[0]; s.step = 2;
      const nxt = stepComponents(s);
      return i.editReply({ content: nxt.text, components: nxt.components });
    }
    if (i.customId === IDS.SEL_TOPIC && s.step === 2) {
      s.topic = i.values[0]; s.step = 3;
      const nxt = stepComponents(s);
      return i.editReply({ content: nxt.text, components: nxt.components });
    }
    if (i.customId === IDS.SEL_IMPACT && s.step === 3) {
      s.impact = i.values[0]; s.step = 4;
      const nxt = stepComponents(s);
      return i.editReply({ content: nxt.text, components: nxt.components });
    }
    if (i.customId === IDS.SEL_MEDIA && s.step === 5) {
      s.mediaYN = i.values[0];
      if (s.mediaYN === 'yes') {
        const parent = await client.channels.fetch(INTAKE_PARENT_ID).catch(() => null);
        if (parent) {
          let t;
          try {
            t = await parent.threads.create({
              name: `Intake – ${s.title || 'Feedback'}`.slice(0, 80),
              type: ChannelType.PrivateThread,
              autoArchiveDuration: 1440,
              invitable: false,
              reason: `Feedback intake for ${i.user.tag}`
            });
          } catch {
            t = await parent.threads.create({
              name: `Intake – ${s.title || 'Feedback'}`.slice(0, 80),
              type: ChannelType.PublicThread,
              autoArchiveDuration: 1440,
              reason: `Feedback intake (fallback) for ${i.user.tag}`
            });
          }
          await t.members.add(i.user.id).catch(()=>{});
          s.intakeThreadId = t.id;
          const info = new EmbedBuilder()
            .setTitle('Temporary Intake')
            .setDescription(
              'Please post **ONE** message with your description **and** screenshots/videos/links.\n' +
              'The intake will **auto-close** after the first message.\n\n' +
              `Then go ${panelJumpText()} and click **Enter version**.`
            );
          await t.send({ content: `<@${i.user.id}>`, embeds: [info] });
        }
      }
      s.step = 6;
      const nxt = stepComponents(s);
      return i.editReply({ content: nxt.text, components: nxt.components });
    }
  } catch (err) {
    console.error('select error', err);
    try { await i.followUp({ content: '❌ Selection failed.', flags: 64 }); } catch {}
  }
});

/* ====== BUTTONS (modals) ====== */
client.on('interactionCreate', async (i) => {
  const s = sessions.get(i.user.id); if (!s || s.finalized) return;
  try {
    if (i.isButton() && i.customId === IDS.BTN_CONTINUE_MAIN && s.step === 4) {
      const modal = new ModalBuilder().setCustomId(IDS.MOD_MAIN).setTitle('Feedback Details');
      const title = new TextInputBuilder().setCustomId('title').setLabel('Short feedback title').setStyle(TextInputStyle.Short).setMaxLength(60).setRequired(true);
      const desc  = new TextInputBuilder().setCustomId('desc').setLabel('Describe your feedback clearly').setStyle(TextInputStyle.Paragraph).setRequired(true);
      return await i.showModal(modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(desc)
      ));
    }
    if (i.isButton() && i.customId === IDS.BTN_ENTER_VERSION && s.step === 6) {
      const modal = new ModalBuilder().setCustomId(IDS.MOD_VERSION).setTitle('Version (optional)');
      const ver = new TextInputBuilder().setCustomId('ver').setLabel('Game version (e.g., v 0.0.16)').setStyle(TextInputStyle.Short).setMaxLength(20).setPlaceholder('v 0.0.16').setRequired(false);
      return await i.showModal(modal.addComponents(new ActionRowBuilder().addComponents(ver)));
    }
    if (i.isButton() && i.customId === IDS.BTN_RESUME) {
      const deferred = await tryDeferEphemeral(i);
      const stopTicker = startWaitTicker(i);
      const nxt = stepComponents(s);
      if (deferred) await i.editReply({ content: nxt.text, components: nxt.components });
      else await i.reply({ content: nxt.text, components: nxt.components, flags: 64 });
      stopTicker();
    }
  } catch {}
});

/* ====== MODALS ====== */
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit()) return;
  if (alreadyProcessed(i)) return;

  const s = sessions.get(i.user.id);
  if (!s) return;

  try {
    if (!(i.deferred || i.replied)) await i.deferReply({ flags: 64 });

    if (i.customId === IDS.MOD_MAIN && s.step === 4) {
      s.title = i.fields.getTextInputValue('title');
      s.desc  = i.fields.getTextInputValue('desc');
      s.step  = 5;
      const nxt = stepComponents(s);
      return await i.editReply({ content: nxt.text, components: nxt.components });
    }

    if (i.customId === IDS.MOD_VERSION && s.step === 6) {
      if (s.posting || s.finalized) {
        await i.editReply({
          content: s.threadId
            ? `✔ Feedback thread already exists: <#${s.threadId}>`
            : '⏳ Your feedback is being posted …'
        });
        await i.followUp({ content: '✔ You can now **dismiss** these bot messages (bottom-right).', flags: 64 });
        return;
      }

      s.posting = true;
      const stopTicker = startWaitTicker(i);
      s.version = i.fields.getTextInputValue('ver') || '';

      const forum = await client.channels.fetch(FEEDBACK_FORUM_ID).catch(() => null);
      if (!forum || forum.type !== ChannelType.GuildForum) {
        await i.editReply('❌ Feedback forum not available. Check FEEDBACK_FORUM_CHANNEL_ID.');
        s.posting = false;
        return;
      }

      const title = buildThreadTitle(s);
      const filesToAttach = (s.files || []).slice(0, 10);
      const thread = await forum.threads.create({
        name: title,
        message: { content: buildThreadContent(i.user.id, s), files: filesToAttach },
        reason: `Feedback by ${i.user.tag}`
      });
      s.threadId = thread.id;

      try { await thread.setLocked(true); } catch {}
      try { await thread.setArchived(false); } catch {}

      const starter = await thread.fetchStarterMessage().catch(()=>null);
      const eKind = FEEDBACK_KIND.find(k => k.value === s.kind)?.emoji;
      const eImpact = IMPACT.find(k => k.value === s.impact)?.emojis ?? [];
      const reacts = [eKind, ...eImpact].filter(Boolean);
      if (starter) {
        for (const e of reacts) { try { await starter.react(e); } catch {} }
        try { await starter.pin(); } catch {}
      }

      s.posting = false; s.finalized = true;

      await i.editReply({
        content: `✔ Feedback posted: <#${s.threadId}>`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open thread').setURL(`https://discord.com/channels/${i.guildId}/${s.threadId}`)
        )]
      });
      await i.followUp({ content: '✔ You can now **dismiss** these bot messages (bottom-right).', flags: 64 });
      stopTicker();
    }
  } catch (err) {
    console.error('modal error', err);
    try { await i.editReply({ content: '❌ Unexpected error on modal submit. Please try again.' }); } catch {}
  }
});

/* ====== INTAKE CAPTURE ====== */
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.channel.isThread()) return;
    const entry = [...sessions].find(([, v]) => v.intakeThreadId === msg.channel.id && !v.finalized);
    if (!entry) return;
    const s = entry[1];
    if (s.intakeCaptured) { try { await msg.delete().catch(()=>{}); } catch {} return; }

    s.files = [];
    s.links = [];
    if (msg.attachments?.size) msg.attachments.forEach(a => s.files.push({ attachment: a.url, name: a.name }));
    if (USE_MC) {
      const found = msg.content?.match(/\bhttps?:\/\/\S+/gi) || [];
      s.links.push(...found);
    }
    s.intakeCaptured = true;

    try {
      await msg.channel.send({ content: `✅ Thanks! Intake captured.\n↩️ Go ${panelJumpText()} and click **Enter version**.` });
      await msg.channel.setLocked(true).catch(()=>{});
      await msg.channel.setArchived(true).catch(()=>{});
    } catch {}
  } catch {}
});

/* ====== EMOJI WHITELIST ====== */
client.on('messageReactionAdd', async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    const key = reaction.emoji.id ? reaction.emoji.id : reaction.emoji.name;
    if (!EMOJI_WHITELIST.has(key)) await reaction.users.remove(user.id).catch(()=>{});
  } catch {}
});

/* ====== ERRORS ====== */
process.on('unhandledRejection', (reason) => {
  if (reason?.code === 10062) return;
  console.error('unhandledRejection:', reason);
});
client.on('error', (e) => console.error('client error:', e));

client.login(TOKEN);
