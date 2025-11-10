import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, EmbedBuilder, PermissionFlagsBits
} from 'discord.js';

/* ===== ENV ===== */
const TOKEN = process.env.DISCORD_TOKEN;
const FORUM_CHANNEL_ID = process.env.FORUM_CHANNEL_ID;                 // REQUIRED: Feedback forum (parent) channel ID
const INTAKE_PARENT_CHANNEL_ID = process.env.INTAKE_PARENT_CHANNEL_ID; // REQUIRED: Text channel for temporary intake threads
const PANEL_MESSAGE_URL = process.env.PANEL_MESSAGE_URL || null;       // OPTIONAL: deep link to your panel message
const PANEL_TARGET_ID = process.env.PANEL_TARGET_ID || null;           // OPTIONAL: fallback channel mention
const USE_MC = String(process.env.USE_MESSAGE_CONTENT ?? 'true').toLowerCase() === 'true';

(function envGuard() {
  const errors = [];
  if (!TOKEN) errors.push('DISCORD_TOKEN is missing.');
  if (!FORUM_CHANNEL_ID) errors.push('FORUM_CHANNEL_ID is missing.');
  if (!INTAKE_PARENT_CHANNEL_ID) errors.push('INTAKE_PARENT_CHANNEL_ID is missing.');
  if (errors.length) console.error('❌ Env problems:\n- ' + errors.join('\n- '));
  else console.log('✅ Env loaded.');
})();

/* ===== CLIENT ===== */
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions
];
if (USE_MC) intents.push(GatewayIntentBits.MessageContent);

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

/* ===== IDS & STATIC OPTIONS ===== */
const IDS = {
  CMD_PANEL: 'post_feedback_panel',
  BTN_OPEN: 'fb_open',
  BTN_CONTINUE: 'fb_continue',
  BTN_VERSION: 'fb_version',
  BTN_RESUME: 'fb_resume',
  SEL_KIND: 'sel_kind',
  SEL_TOPIC: 'sel_topic',
  SEL_IMPACT: 'sel_impact',
  SEL_MEDIA: 'sel_media',
  MOD_MAIN: 'mod_main',
  MOD_VERSION: 'mod_version'
};

/* CUSTOMIZE: the list of “Kinds” shown in step 1 */
const FEEDBACK_KINDS = [
  { label: 'Praise',     value: 'Praise',     emoji: '❤️' },
  { label: 'Suggestion', value: 'Suggestion', emoji: '💡' },
  { label: 'Concern',    value: 'Concern',    emoji: '⚠️' },
  { label: 'QoL',        value: 'QoL',        emoji: '🧰' },
  { label: 'Balance',    value: 'Balance',    emoji: '⚖️' },
  { label: 'Performance',value: 'Performance',emoji: '🚀' },
  { label: 'Localization',value:'Localization',emoji:'🌐' },
  { label: 'Other',      value: 'Other',      emoji: '🧩' },
];

/* CUSTOMIZE: the list of “Topics” shown in step 2 */
const FEEDBACK_TOPICS = [
  { label: 'UI/UX',         value: 'UI/UX',         emoji: '🖱️' },
  { label: 'Gameplay',      value: 'Gameplay',      emoji: '🎮' },
  { label: 'Progression',   value: 'Progression',   emoji: '📈' },
  { label: 'Economy',       value: 'Economy',       emoji: '💰' },
  { label: 'Accessibility', value: 'Accessibility', emoji: '♿' },
  { label: 'Multiplayer',   value: 'Multiplayer',   emoji: '🧑‍🤝‍🧑' },
  { label: 'Other topics',  value: 'Other topics',  emoji: '🗂️' },
];

/* CUSTOMIZE: the impact buckets (labels, emoji, descriptions) */
const IMPACTS = [
  { value: 'Nice-to-have', label: 'Nice-to-have', emoji: '✨', desc: 'Small improvement' },
  { value: 'Useful',       label: 'Useful',       emoji: '👍', desc: 'Helps many players' },
  { value: 'Important',    label: 'Important',    emoji: '❗', desc: 'High impact feedback' },
  { value: 'Critical',     label: 'Critical',     emoji: '🛑', desc: 'Blocks fun/flow' },
];

const MEDIA_YN = [
  { label: 'Yes, I have media', value: 'yes' },
  { label: 'No, continue without', value: 'no' }
];

const NET = { LONG_STEP_HINT_MS: 6000, MAX_RETRIES: 4, BASE_DELAY_MS: 600, JITTER_MS: 300 };

const sessions = new Map();
const processed = new Set();

/* ===== UTILS ===== */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const backoff = (a) => NET.BASE_DELAY_MS * Math.pow(2, a) + Math.floor(Math.random() * NET.JITTER_MS);

function alreadyProcessed(i) {
  if (processed.has(i.id)) return true;
  processed.add(i.id);
  setTimeout(() => processed.delete(i.id), 60000);
  return false;
}

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
        await i.editReply({ content: `⏳ Please wait${dots[t]}… – slow connection or server load.` }).catch(() => {});
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

/* ===== PANEL EMBED ===== */
/* CUSTOMIZE: colors, title, copy, emoji legend, notes */
function makePanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x8fd3ff)
    .setTitle('🗳️ Feedback — Guide & Start')
    .setDescription('Share clear, actionable feedback. We’ll create a locked thread and follow up there.')
    .addFields(
      {
        name: 'How it works',
        value:
          '1️⃣ Click **Give Feedback**\n' +
          '2️⃣ Pick **Kind → Topic → Impact**\n' +
          '3️⃣ Enter **Title & Description**\n' +
          '4️⃣ *(Optional)* Add media via a short **intake**\n' +
          '5️⃣ Enter **Version** (to help QA)\n',
      },
      {
        name: 'Kinds',
        value: '❤️ Praise • 💡 Suggestion • ⚠️ Concern • 🧰 QoL • ⚖️ Balance • 🚀 Performance • 🌐 Localization • 🧩 Other',
      },
      {
        name: 'Topics',
        value: '🖱️ UI/UX • 🎮 Gameplay • 📈 Progression • 💰 Economy • ♿ Accessibility • 🧑‍🤝‍🧑 Multiplayer • 🗂️ Other',
      },
      {
        name: 'Impact',
        value: '✨ Nice-to-have • 👍 Useful • ❗ Important • 🛑 Critical',
      },
      {
        name: 'Notes',
        value: '• One idea per thread • Threads are read-only for reporter • You can dismiss bot pop-ups (bottom-right)',
      }
    )
    .setFooter({ text: 'Thanks for helping us improve!' });
}

/* ===== FINAL THREAD CONTENT ===== */
/* CUSTOMIZE: structure of the posted thread content */
function buildFinalContent(uid, s) {
  const linksBlock = (s.links?.length) ? `\n🔗 **Additional links**\n${s.links.map(u => `• ${u}`).join('\n')}\n` : '';
  return (
`### 💬 ${s.title}

**Reporter:** <@${uid}>  
**Kind:** ${s.kind ?? '-'}  
**Topic:** ${s.topic ?? '-'}  
**Impact:** ${s.impact ?? '-'}

📝 **Description:**  
${s.desc}

**Version:** ${s.version ?? '-'}

${linksBlock}—`
  );
}

/* ===== STEP RENDERING ===== */
function stepComponents(s) {
  switch (s.step) {
    case 1: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_KIND)
        .setPlaceholder('Select the kind of feedback')
        .addOptions(FEEDBACK_KINDS.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setEmoji(o.emoji);
          if (s.kind === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'Choose the **kind** of your feedback.', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 2: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_TOPIC)
        .setPlaceholder('Select the topic')
        .addOptions(FEEDBACK_TOPICS.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setEmoji(o.emoji);
          if (s.topic === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'Which **topic** does it relate to?', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 3: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_IMPACT)
        .setPlaceholder('How impactful is it?')
        .addOptions(IMPACTS.map(o => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(o.label).setDescription(o.desc).setValue(o.value).setEmoji(o.emoji);
          if (s.impact === o.value) opt.setDefault(true);
          return opt;
        }));
      return { text: 'How **impactful** is the feedback?', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 4: {
      const btn = new ButtonBuilder().setCustomId(IDS.BTN_CONTINUE).setLabel('Enter title & description').setStyle(ButtonStyle.Primary);
      return { text: 'Add a **concise title** and a **clear description**.', components: [new ActionRowBuilder().addComponents(btn)] };
    }
    case 5: {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(IDS.SEL_MEDIA)
        .setPlaceholder('Share screenshots/videos/video links?')
        .addOptions(
          MEDIA_YN.map(o => new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value))
        );
      return { text: 'Do you want to share **media** to illustrate your feedback?', components: [new ActionRowBuilder().addComponents(menu)] };
    }
    case 6: {
      const btn = new ButtonBuilder().setCustomId(IDS.BTN_VERSION).setLabel('Enter version').setStyle(ButtonStyle.Success);
      const note = s.mediaYN === 'yes'
        ? (s.intakeCaptured
            ? `✅ Intake captured. Click **Enter version**.`
            : `✉️ A **temporary intake** was opened. Post **ONE** message there (text + media/links). It will **auto-close**. Then click **Enter version**.`)
        : `No intake opened. Continue with **Enter version**.`;
      const link = s.intakeThreadId ? `\n🔗 Intake: <#${s.intakeThreadId}>` : '';
      return { text: `${note}${link}`, components: [new ActionRowBuilder().addComponents(btn)] };
    }
    default:
      return { text: 'Done.', components: [] };
  }
}

/* ===== READY ===== */
client.once('ready', () => console.log(`✅ FeedbackBot online as ${client.user.tag}`));

/* ===== /post_feedback_panel ===== */
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== IDS.CMD_PANEL) return;
  try {
    await i.deferReply({ flags: 64 });

    if (!FORUM_CHANNEL_ID) return await i.editReply('❌ FORUM_CHANNEL_ID is not set in the bot environment.');

    const forum = await client.channels.fetch(FORUM_CHANNEL_ID).catch((e) => {
      console.error('forum fetch error', e);
      return null;
    });
    if (!forum) return await i.editReply('❌ Feedback forum not found. Check FORUM_CHANNEL_ID and bot access.');
    if (forum.type !== ChannelType.GuildForum) {
      return await i.editReply('❌ The given FORUM_CHANNEL_ID is not a Forum channel. Please use the parent forum ID.');
    }

    const me = i.guild.members.me;
    const perms = forum.permissionsFor(me);
    const need = [
      'ViewChannel', 'SendMessages',
      ('CreatePosts' in PermissionFlagsBits ? 'CreatePosts' : 'CreatePublicThreads'),
      'SendMessagesInThreads', 'ManageThreads', 'ReadMessageHistory'
    ];
    const missing = need.filter(p => !perms?.has(PermissionFlagsBits[p]));
    if (missing.length) {
      return await i.editReply('❌ Missing forum permissions:\n• ' + missing.join('\n• '));
    }

    /* CUSTOMIZE: panel thread name */
    const thread = await withRetries('panel_create', async () => forum.threads.create({
      name: '📌 Feedback Guide and Start',
      message: {
        embeds: [makePanelEmbed()],                            // CUSTOMIZE: embed content in makePanelEmbed()
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(IDS.BTN_OPEN).setLabel('Give Feedback').setStyle(ButtonStyle.Success) // CUSTOMIZE: button label
        )]
      },
      reason: 'Feedback panel'
    }));

    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter?.url) console.log('Panel URL:', starter.url);

    await i.editReply({ content: `✅ Panel created: <#${thread.id}>` });
  } catch (err) {
    console.error('post_feedback_panel error', err);
    if (i.deferred || i.replied) await i.editReply('❌ Failed to post feedback panel. Check permissions and logs.');
    else await i.reply({ content: '❌ Failed to post feedback panel.', flags: 64 });
  }
});

/* ===== START FLOW (BUTTON) ===== */
client.on('interactionCreate', async (i) => {
  if (!i.isButton() || i.customId !== IDS.BTN_OPEN) return;
  if (alreadyProcessed(i)) return;
  try {
    const deferred = await tryDeferEphemeral(i);
    const stop = startWaitTicker(i);

    const s = { step: 1, files: [], links: [], intakeCaptured: false, posting: false, threadId: null, finalized: false };
    sessions.set(i.user.id, s);

    const first = stepComponents(s);
    if (deferred) await i.editReply({ content: first.text, components: first.components });
    else await i.reply({ content: first.text, components: first.components, flags: 64 });

    stop();
  } catch (err) {
    console.error('BTN_OPEN error', err);
    try {
      if (i.deferred || i.replied) await i.editReply({ content: '❌ Unexpected error. Please try again.' });
      else await i.reply({ content: '❌ Unexpected error. Please try again.', flags: 64 });
    } catch {}
  }
});

/* ===== SELECT MENUS ===== */
client.on('interactionCreate', async (i) => {
  if (!i.isStringSelectMenu()) return;
  if (alreadyProcessed(i)) return;

  const s = sessions.get(i.user.id);
  if (!s || s.finalized) return;

  try {
    if (i.customId === IDS.SEL_KIND && s.step === 1) {
      await i.deferUpdate().catch(()=>{});
      s.kind = i.values[0]; s.step = 2;
      const { text, components } = stepComponents(s);
      return i.editReply({ content: text, components });
    }
    if (i.customId === IDS.SEL_TOPIC && s.step === 2) {
      await i.deferUpdate().catch(()=>{});
      s.topic = i.values[0]; s.step = 3;
      const { text, components } = stepComponents(s);
      return i.editReply({ content: text, components });
    }
    if (i.customId === IDS.SEL_IMPACT && s.step === 3) {
      await i.deferUpdate().catch(()=>{});
      s.impact = i.values[0]; s.step = 4;
      const { text, components } = stepComponents(s);
      return i.editReply({ content: text, components });
    }
    if (i.customId === IDS.SEL_MEDIA && s.step === 5) {
      await i.deferUpdate().catch(()=>{});
      s.mediaYN = i.values[0];

      if (s.mediaYN === 'yes' && s.intakeThreadId) {
        s.step = 6;
        const btn = new ButtonBuilder().setCustomId(IDS.BTN_VERSION).setLabel('Enter version').setStyle(ButtonStyle.Success); // CUSTOMIZE: button label
        return i.editReply({
          content: `✉️ A **temporary intake** is already open.\n🔗 Intake: <#${s.intakeThreadId}>\nThen click **Enter version**.`,
          components: [new ActionRowBuilder().addComponents(btn)]
        });
      }

      let noteText = 'No intake opened. Continue with **Enter version**.';
      let reason = '';

      if (s.mediaYN === 'yes') {
        if (!INTAKE_PARENT_CHANNEL_ID) {
          reason = ' (INTAKE_PARENT_CHANNEL_ID not set)';
        } else {
          const parent = await client.channels.fetch(INTAKE_PARENT_CHANNEL_ID).catch(() => null);
          if (!parent) {
            reason = ' (intake parent channel not found)';
          } else {
            const me = parent.guild.members.me;
            const perms = parent.permissionsFor(me);
            const canPrivate = perms?.has(PermissionFlagsBits.CreatePrivateThreads);
            const canPublic  = perms?.has(PermissionFlagsBits.CreatePublicThreads);

            try {
              if (canPrivate) {
                const t = await parent.threads.create({
                  name: `Intake – ${s.title || 'Feedback'}`.slice(0, 80), // CUSTOMIZE: intake thread naming
                  type: ChannelType.PrivateThread,
                  autoArchiveDuration: 1440,
                  invitable: false,
                  reason: `Feedback intake for ${i.user.tag}`
                });
                await t.members.add(i.user.id).catch(() => {});
                s.intakeThreadId = t.id;
              } else if (canPublic) {
                const t = await parent.threads.create({
                  name: `Intake – ${s.title || 'Feedback'}`.slice(0, 80), // CUSTOMIZE
                  type: ChannelType.PublicThread,
                  autoArchiveDuration: 1440,
                  reason: `Feedback intake (fallback) for ${i.user.tag}`
                });
                await t.members.add(i.user.id).catch(() => {});
                s.intakeThreadId = t.id;
              } else {
                reason = ' (missing CreatePrivateThreads/CreatePublicThreads in intake channel)';
              }
            } catch (e) {
              console.error('intake create error', e);
              reason = ` (${e?.code || e?.message || 'create error'})`;
            }
          }
        }

        if (s.intakeThreadId) {
          const info = new EmbedBuilder()
            .setTitle('Temporary Intake') // CUSTOMIZE: intake helper message (title/body)
            .setDescription(
              'Please post **ONE** message with your description **and** screenshots/videos/links.\n' +
              'The intake will **auto-close** after the first message.\n\n' +
              `Then go ${panelJumpText()} and click **Enter version**.`
            );
          try {
            const ch = await client.channels.fetch(s.intakeThreadId).catch(() => null);
            if (ch) await ch.send({ content: `<@${i.user.id}>`, embeds: [info] });
          } catch {}
          noteText = '✉️ A **temporary intake** was opened. Post **ONE** message there (text + media/links). It will **auto-close**. Then click **Enter version**.';
        }
      }

      s.step = 6;
      const btn = new ButtonBuilder().setCustomId(IDS.BTN_VERSION).setLabel('Enter version').setStyle(ButtonStyle.Success); // CUSTOMIZE
      const link = s.intakeThreadId ? `\n🔗 Intake: <#${s.intakeThreadId}>` : '';
      const extra = (!s.intakeThreadId && reason) ? `\n⚠️ Reason: ${reason}` : '';
      return i.editReply({ content: `${noteText}${link}${extra}`, components: [new ActionRowBuilder().addComponents(btn)] });
    }
  } catch (err) {
    console.error('select error', err);
    try { await i.followUp({ content: '❌ Selection failed.', flags: 64 }); } catch {}
  }
});

/* ===== BUTTONS (open modals / resume) ===== */
client.on('interactionCreate', async (i) => {
  const s = sessions.get(i.user.id); if (!s || s.finalized) return;

  try {
    if (i.isButton() && i.customId === IDS.BTN_CONTINUE && s.step === 4) {
      const modal = new ModalBuilder().setCustomId(IDS.MOD_MAIN).setTitle('Feedback Details'); // CUSTOMIZE: modal title
      const title = new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Short title') // CUSTOMIZE: field labels & max length
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(true);
      const desc  = new TextInputBuilder()
        .setCustomId('desc')
        .setLabel('Detailed description') // CUSTOMIZE
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);
      return await i.showModal(modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(desc)
      ));
    }

    if (i.isButton() && i.customId === IDS.BTN_VERSION && s.step === 6) {
      const modal = new ModalBuilder().setCustomId(IDS.MOD_VERSION).setTitle('Version'); // CUSTOMIZE
      const ver = new TextInputBuilder()
        .setCustomId('ver')
        .setLabel('Game version (e.g., v 0.0.16)') // CUSTOMIZE: placeholder/label
        .setStyle(TextInputStyle.Short)
        .setMaxLength(20)
        .setPlaceholder('v 0.0.16')
        .setRequired(true);
      return await i.showModal(modal.addComponents(new ActionRowBuilder().addComponents(ver)));
    }

    if (i.isButton() && i.customId === IDS.BTN_RESUME) {
      const deferred = await tryDeferEphemeral(i);
      const stop = startWaitTicker(i);
      const { text, components } = stepComponents(s);
      if (deferred) await i.editReply({ content: text, components });
      else await i.reply({ content: text, components, flags: 64 });
      stop();
    }
  } catch {}
});

/* ===== MODALS (submit) ===== */
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
            ? `✔ Feedback already exists: <#${s.threadId}>`
            : '⏳ Your feedback is being posted …'
        });
        await i.followUp({ content: '✔ You can now **dismiss** these bot messages (bottom-right).', flags: 64 });
        return;
      }

      s.posting = true;
      const stop = startWaitTicker(i);
      s.version = i.fields.getTextInputValue('ver');

      if (!FORUM_CHANNEL_ID) {
        stop(); s.posting = false;
        return await i.editReply('❌ FORUM_CHANNEL_ID is not set in the bot environment.');
      }

      let forum = null;
      try { forum = await client.channels.fetch(FORUM_CHANNEL_ID); }
      catch (e) { console.error('forum fetch error', e); }
      if (!forum) { stop(); s.posting = false; return await i.editReply('❌ Feedback forum not found. Check FORUM_CHANNEL_ID and bot access.'); }
      if (forum.type !== ChannelType.GuildForum) {
        stop(); s.posting = false;
        return await i.editReply('❌ The given FORUM_CHANNEL_ID is not a Forum channel. Please use the parent forum ID.');
      }

      const me = forum.guild.members.me;
      const perms = forum.permissionsFor(me);
      const needed = [
        ('CreatePosts' in PermissionFlagsBits ? 'CreatePosts' : 'CreatePublicThreads'),
        'SendMessagesInThreads', 'ReadMessageHistory', 'ViewChannel'
      ];
      const missing = needed.filter(p => !perms?.has(PermissionFlagsBits[p]));
      if (missing.length) {
        stop(); s.posting = false;
        return await i.editReply('❌ Missing forum permissions:\n• ' + missing.join('\n• '));
      }

      const kindObj  = FEEDBACK_KINDS.find(k => k.value === s.kind);
      const topicObj = FEEDBACK_TOPICS.find(t => t.value === s.topic);
      const impactObj= IMPACTS.find(x => x.value === s.impact);

      const kindEmoji  = kindObj?.emoji ?? '💬';
      const topicEmoji = topicObj?.emoji ?? '';
      const impactTag  = (impactObj?.label || 'Feedback').toUpperCase();

      /* CUSTOMIZE: thread title template */
      const threadName = `${kindEmoji}${topicEmoji ? ' ' + topicEmoji : ''} | Feedback | ${s.topic ?? 'General'} – ${s.title} [${impactTag}]`.slice(0, 90);
      const filesToAttach = (s.files || []).slice(0, 10);

      const thread = await forum.threads.create({
        name: threadName,
        message: { content: buildFinalContent(i.user.id, s), files: filesToAttach }, // CUSTOMIZE: content function above
        reason: `Feedback by ${i.user.tag}`
      });
      s.threadId = thread.id;

      try { await thread.setLocked(true); } catch {}
      try { await thread.setArchived(false); } catch {}

      const starter = await thread.fetchStarterMessage().catch(() => null);
      const reacts = [kindObj?.emoji, impactObj?.emoji].filter(Boolean);
      if (starter) {
        for (const e of reacts) { try { await starter.react(e); } catch {} }
        try { await starter.pin(); } catch {}
      }

      s.posting = false; s.finalized = true;

      await i.editReply({
        content: `✔ Feedback created: <#${s.threadId}>`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open thread').setURL(`https://discord.com/channels/${i.guildId}/${s.threadId}`) // CUSTOMIZE: link label
        )]
      });
      await i.followUp({ content: '✔ You can now **dismiss** these bot messages (bottom-right).', flags: 64 });

      stop();
    }
  } catch (err) {
    console.error('modal error', err);
    try { await i.editReply({ content: '❌ Unexpected error. Please try again.' }); } catch {}
  }
});

/* ===== INTAKE CAPTURE ===== */
client.on('messageCreate', async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!msg.channel.isThread()) return;

    const entry = [...sessions].find(([, v]) => v.intakeThreadId === msg.channel.id && !v.finalized);
    if (!entry) return;

    const s = entry[1];
    if (s.intakeCaptured) { try { await msg.delete().catch(() => {}); } catch {} return; }

    s.files = [];
    s.links = [];
    if (msg.attachments?.size) msg.attachments.forEach(a => s.files.push({ attachment: a.url, name: a.name }));
    if (USE_MC) {
      const found = msg.content?.match(/\bhttps?:\/\/\S+/gi) || [];
      s.links.push(...found);
    }
    s.intakeCaptured = true;

    /* CUSTOMIZE: intake confirmation text */
    try {
      await msg.channel.send({ content: `✅ Thanks! Intake captured.\n↩️ Go ${panelJumpText()} and click **Enter version**.` });
      await msg.channel.setLocked(true).catch(() => {});
      await msg.channel.setArchived(true).catch(() => {});
    } catch {}
  } catch {}
});

/* ===== ERROR LOGGING ===== */
process.on('unhandledRejection', (reason) => {
  if (reason?.code === 10062) return;
  console.error('unhandledRejection:', reason);
});
client.on('error', (e) => console.error('client error:', e));

/* ===== START ===== */
client.login(TOKEN);
