require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, PermissionFlagsBits,
  EmbedBuilder, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, Partials
} = require('discord.js');

const required = ['DISCORD_TOKEN'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} fehlt in .env`);
}

const streamers = [
  { login: 'misskowalski', displayName: 'MissKowalski' },
  { login: 'opphorx', displayName: 'Opphil' },
  { login: 'wuchitv', displayName: 'WuchiTV' },
  { login: 'ronjawolf2007', displayName: 'RonjaWolf2007' },
  { login: 'moorrisss', displayName: 'Moorrisss' },
  { login: 'chronoyaksha', displayName: 'Chronoyaksha' },
  { login: 'flammengott', displayName: 'Flammengott' },
  { login: 'bagontr01', displayName: 'BagonTr01' },
  { login: 'codewizardtv', displayName: 'CodeWizardTV' },
  { login: 'derliber', displayName: 'Derliber' },
  { login: 'fynnow', displayName: 'Fynnow' },
  { login: 'kaledoss', displayName: 'Kaledoss' },
  { login: 'muecke0702', displayName: 'Muecke0702' },
  { login: 'roggberd', displayName: 'Roggberd' },
  { login: 'scusytv', displayName: 'ScusyTV' },
  { login: 'xxlukaas_', displayName: 'XxLukas' },
  { login: 'ccatched', displayName: 'ccatched' },
  { login: 'simontheking799', displayName: 'Simontheking799' },
  { login: 'tsheyn', displayName: 'Tsheyn' },
  { login: 'champion336666', displayName: 'Champion336666' }
].map(streamer => ({ ...streamer, roleName: `Stream-Ping: ${streamer.displayName}` }));

const config = {
  guildId: process.env.GUILD_ID,
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
  modLogChannelId: process.env.MOD_LOG_CHANNEL_ID,
  applicationChannelId: process.env.APPLICATION_CHANNEL_ID || process.env.MOD_LOG_CHANNEL_ID,
  applicationNotificationChannelId: process.env.APPLICATION_NOTIFICATION_CHANNEL_ID || '1554508707138764800',
  bannedTerms: (process.env.BANNED_TERMS || '')
    .split(',').map(term => term.trim().toLowerCase()).filter(Boolean),
  filterAction: process.env.FILTER_ACTION || 'delete',
  timeoutMinutes: Math.max(1, Math.min(Number(process.env.FILTER_TIMEOUT_MINUTES) || 60, 40320)),
  streamAlertChannelId: process.env.STREAM_ALERT_CHANNEL_ID,
  twitchClientId: process.env.TWITCH_CLIENT_ID,
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET,
  twitchStreamers: streamers.map(streamer => streamer.login),
  streamPollMinutes: Math.max(1, Math.min(Number(process.env.STREAM_POLL_MINUTES) || 5, 60)),
  tempVoiceLobbyId: process.env.TEMP_VOICE_LOBBY_ID,
  tempVoiceCategoryId: process.env.TEMP_VOICE_CATEGORY_ID,
  rulesChannelId: process.env.RULES_CHANNEL_ID || '1554115823759785984',
  legacyMemberRoleName: process.env.LEGACY_MEMBER_ROLE_NAME || 'Mitglied',
  ticketNotificationChannelId: process.env.TICKET_NOTIFICATION_CHANNEL_ID || '1554508707138764800',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  teamRoleName: process.env.TEAM_ROLE_NAME || 'Team',
  // Kann bei einem neuen Mod-Release bei Railway als MOD_SUPPORTED_VERSIONS
  // angepasst werden, ohne den Bot-Code erneut ändern zu müssen.
  supportedModVersions: process.env.MOD_SUPPORTED_VERSIONS || '1.21.11, 26.1, 26.1.1, 26.2, 26.3'
};

if (!['delete', 'timeout', 'ban'].includes(config.filterAction)) {
  throw new Error('FILTER_ACTION muss delete, timeout oder ban sein.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt ein Mitglied')
    .addUserOption(option => option.setName('mitglied').setDescription('Mitglied zum Bannen').setRequired(true))
    .addStringOption(option => option.setName('grund').setDescription('Grund für den Bann')),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Gibt einem Mitglied einen Timeout')
    .addUserOption(option => option.setName('mitglied').setDescription('Mitglied für den Timeout').setRequired(true))
    .addIntegerOption(option => option.setName('minuten').setDescription('Dauer in Minuten').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(option => option.setName('grund').setDescription('Grund für den Timeout')),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnt ein Mitglied')
    .addUserOption(option => option.setName('mitglied').setDescription('Mitglied zum Verwarnen').setRequired(true))
    .addStringOption(option => option.setName('grund').setDescription('Grund für die Verwarnung')),
  new SlashCommandBuilder()
    .setName('stream-rollen')
    .setDescription('Erstellt die auswählbaren Streamer-Ping-Rollen'),
  new SlashCommandBuilder()
    .setName('bewerber')
    .setDescription('Zeigt das Bewerbungsmenü für Content, Tester und Supporter'),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Verwaltet Support-Tickets als private Threads')
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Erstellt das Ticket-Auswahlmenü in diesem Kanal')
      .addChannelOption(option => option
        .setName('benachrichtigungskanal')
        .setDescription('Kanal, in dem das Team neue Tickets sieht und beitritt')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText))
      .addRoleOption(option => option.setName('supportrolle').setDescription('Rolle, die Tickets bearbeiten darf')))
    .addSubcommand(subcommand => subcommand
      .setName('close')
      .setDescription('Schließt das Ticket in diesem Thread sofort')
      .addStringOption(option => option.setName('grund').setDescription('Optionaler Grund für die Schließung').setMaxLength(500)))
    .addSubcommand(subcommand => subcommand
      .setName('close-anfrage')
      .setDescription('Fragt die Ticket-Erstellerin bzw. den Ticket-Ersteller nach einer Schließung')
      .addIntegerOption(option => option
        .setName('minuten')
        .setDescription('Nach wie vielen Minuten das Ticket automatisch geschlossen wird')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10080))
      .addStringOption(option => option.setName('grund').setDescription('Optionaler Grund für die Schließungsanfrage').setMaxLength(500)))
    .addSubcommand(subcommand => subcommand
      .setName('add')
      .setDescription('Fügt ein Mitglied zu diesem Ticket hinzu')
      .addUserOption(option => option.setName('mitglied').setDescription('Mitglied, das Zugriff erhalten soll').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('rename')
      .setDescription('Benennt dieses Ticket um')
      .addStringOption(option => option.setName('name').setDescription('Kurzer neuer Name für das Ticket').setRequired(true).setMaxLength(50))),
  new SlashCommandBuilder()
    .setName('voice-kick')
    .setDescription('Entfernt ein Mitglied aus deinem eigenen temporären Voice-Chat')
    .addUserOption(option => option.setName('mitglied').setDescription('Mitglied, das entfernt werden soll').setRequired(true))
  ,
  new SlashCommandBuilder()
    .setName('regeln')
    .setDescription('Richtet die Server-Verifizierung per grünem Haken ein')
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Sendet die Regeln mit einem grünen Bestätigungs-Haken in diesen Kanal'))
    .addSubcommand(subcommand => subcommand
      .setName('kategorie')
      .setDescription('Schaltet eine Mitglieder-Kategorie für die Rolle Verifiziert frei')
      .addChannelOption(option => option
        .setName('kategorie')
        .setDescription('Nur eine Kategorie für normale Mitglieder – keine Team-Kategorie')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand(subcommand => subcommand
      .setName('alle')
      .setDescription('Schützt alle normalen Kanäle auf einmal')
      .addChannelOption(option => option
        .setName('team-kategorie')
        .setDescription('Diese Team-Kategorie und ihre Kanäle bleiben unverändert')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory)))
];

const streamerStatus = new Map();
const temporaryVoiceOwners = new Map();
const ticketAiBusyThreads = new Set();
const ticketSummaryConfirmations = new Map();
const ticketFollowupPendingClosures = new Set();
const ticketNumbersByChannel = new Map();
const scheduledTicketClosures = new Map();
let twitchAccessToken;
let twitchAccessTokenExpiresAt = 0;

async function getTwitchAccessToken() {
  if (twitchAccessToken && Date.now() < twitchAccessTokenExpiresAt) return twitchAccessToken;
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.twitchClientId,
      client_secret: config.twitchClientSecret,
      grant_type: 'client_credentials'
    })
  });
  if (!response.ok) throw new Error(`Twitch-Anmeldung fehlgeschlagen (${response.status})`);
  const token = await response.json();
  twitchAccessToken = token.access_token;
  twitchAccessTokenExpiresAt = Date.now() + Math.max(60, token.expires_in - 60) * 1000;
  return twitchAccessToken;
}

async function checkTwitchStreams() {
  if (!config.streamAlertChannelId || !config.twitchClientId || !config.twitchClientSecret || !config.twitchStreamers.length) return;
  const channel = await client.channels.fetch(config.streamAlertChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  try {
    const token = await getTwitchAccessToken();
    for (const streamer of config.twitchStreamers) {
      const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(streamer)}`, {
        headers: { 'Client-ID': config.twitchClientId, Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Twitch-Abfrage fehlgeschlagen (${response.status})`);
      const [live] = (await response.json()).data;
      const key = streamer.toLowerCase();
      const previous = streamerStatus.get(key);
      const isLive = Boolean(live);
      streamerStatus.set(key, isLive);

      // Beim ersten Check nur den Zustand merken, damit keine alten Streams nachgemeldet werden.
      if (!isLive || previous === undefined || previous) continue;
      const streamerDetails = streamers.find(item => item.login === key);
      const role = streamerDetails && channel.guild.roles.cache.find(item => item.name === streamerDetails.roleName);
      const thumbnail = live.thumbnail_url.replace('{width}', '1280').replace('{height}', '720');
      const embed = new EmbedBuilder()
        .setColor(0x9146FF)
        .setTitle(`${live.user_name} ist jetzt live!`)
        .setDescription(live.title || 'Schau im Stream vorbei!')
        .setURL(`https://www.twitch.tv/${live.user_login}`)
        .setImage(`${thumbnail}?t=${Date.now()}`)
        .addFields({ name: 'Kategorie', value: live.game_name || 'Ohne Kategorie', inline: true })
        .setTimestamp();
      await channel.send({
        content: role ? `<@&${role.id}>` : undefined,
        embeds: [embed],
        allowedMentions: role ? { roles: [role.id] } : { parse: [] }
      });
    }
  } catch (error) {
    console.error('Streamer-Benachrichtigung:', error.message);
  }
}

async function logModeration(guild, title, fields) {
  const channel = await guild.channels.fetch(config.modLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const embed = new EmbedBuilder().setColor(0xED4245).setTitle(title)
    .addFields(fields).setTimestamp();
  await channel.send({ embeds: [embed] }).catch(console.error);
}

function canModerate(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);
}

async function getOrCreateStreamRole(guild, streamer) {
  const existing = guild.roles.cache.find(role => role.name === streamer.roleName);
  if (existing) return existing;
  return guild.roles.create({
    name: streamer.roleName,
    mentionable: false,
    reason: 'Opt-in-Rolle für Twitch-Streamer-Benachrichtigungen'
  });
}

async function getOrCreateMemberRole(guild) {
  const existing = guild.roles.cache.find(role => role.name === 'Verifiziert');
  if (existing) return existing;
  return guild.roles.create({
    name: 'Verifiziert',
    mentionable: false,
    reason: 'Rolle für bestätigte Serverregeln'
  });
}

function getLegacyMemberRole(guild) {
  // Die Minecraft-Mod vergibt weiterhin diese Rolle. Sie darf allein keinen
  // Zugang zu geschützten Mitgliederbereichen gewähren.
  return guild.roles.cache.find(role => role.name === config.legacyMemberRoleName);
}

async function protectMemberChannels(channels, guild, verifiedRole) {
  const legacyMemberRole = getLegacyMemberRole(guild);
  await Promise.all(channels.map(async channel => {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false
    }, 'Mitgliederbereich nur nach Regel-Bestätigung');
    if (legacyMemberRole && legacyMemberRole.id !== verifiedRole.id) {
      await channel.permissionOverwrites.edit(legacyMemberRole, {
        ViewChannel: false
      }, 'Die alte Mitglied-Rolle reicht ohne Regel-Bestätigung nicht aus');
    }
    await channel.permissionOverwrites.edit(verifiedRole, {
      ViewChannel: true,
      ReadMessageHistory: true
    }, 'Mitgliederbereich für bestätigte Mitglieder freigeben');
  }));
}

async function makeChannelPublic(channel, guild) {
  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: true,
    ReadMessageHistory: true
  }, 'Öffentlicher Kanal vor der Regel-Bestätigung');
}

function isRulesMessage(message) {
  const botRulesMessage = message.author?.id === client.user?.id &&
    message.embeds.some(embed => embed.title === 'Serverregeln');
  const configuredRulesText = message.channelId === config.rulesChannelId &&
    message.content?.includes('Serverregeln');
  return botRulesMessage || configuredRulesText;
}

function streamRoleButtons() {
  const buttons = streamers.map(streamer => new ButtonBuilder()
    .setCustomId(`stream-role:${streamer.login}`)
    .setLabel(streamer.displayName)
    .setStyle(ButtonStyle.Primary));

  // Discord erlaubt höchstens fünf Buttons in einer Zeile.
  return Array.from({ length: Math.ceil(buttons.length / 5) }, (_, index) =>
    new ActionRowBuilder().addComponents(buttons.slice(index * 5, index * 5 + 5))
  );
}

const ticketTypes = {
  support: { label: 'Support', description: 'Frage oder Hilfe zum Server', emoji: '🎫' },
  feedback: { label: 'Feedback', description: 'Rückmeldung zum Server oder Bot', emoji: '💡' },
  wunsch: { label: 'Wunsch', description: 'Idee oder Wunsch einreichen', emoji: '✨' },
  meldung: { label: 'Meldung', description: 'Ein Problem oder Mitglied melden', emoji: '🛡️' },
  sonstiges: { label: 'Sonstiges', description: 'Anderes Anliegen', emoji: '💬' }
};

const applicationTypes = { supporter: 'Sup', tester: 'Tester', content: 'Content' };

const opHelperKnowledge = `
Verlässliches Wissen zur OP-Helper Mod:
- OP-Helper ist eine clientseitige Fabric-Mod für Spieler auf opsucht.net.
- Sie bietet Job-Tracking mit XP, Einnahmen, Fortschritt und Sitzungsstatistiken.
- Sie zeigt Auktionsinformationen, Itempreise und Inventarwert-Zusammenfassungen in unterstützten Truhen-Ansichten.
- Weitere Funktionen sind Seltenheitsfarben, optionale farbenblindfreundliche Kennzeichnungen, Talisman-Rucksack-Icons in Tooltips sowie anpassbare Menüs, Akzentfarben, Schriftarten, Sprache und Tooltip-Vorlesefunktion.
- Das Einstellungsmenü wird mit /ophelper geöffnet. Geschützte Befehle wie /rename können eine Bestätigung verlangen.
- OP-Helper unterstützt ausschließlich Fabric, nicht Forge oder NeoForge. Installation: passende OP-Helper-JAR in den Minecraft-mods-Ordner legen; Fabric Loader und Fabric API werden benötigt. Es darf nur eine zur Minecraft-Version passende OP-Helper-Datei installiert sein.
- Unterstützte Minecraft-Versionen sind ausschließlich: ${config.supportedModVersions}. Minecraft 1.21.10 wird ausdrücklich nicht unterstützt. Nennt ein Nutzer eine andere Version (insbesondere 1.21.10), erkläre kurz: „Diese Minecraft-Version wird von OP-Helper nicht unterstützt. Bitte nutze eine der unterstützten Versionen: ${config.supportedModVersions}.“ Danach keine Diagnose für diese nicht unterstützte Version anbieten.
- Für Minecraft 1.21.11 wird Java 21 benötigt; für 26.x-Versionen Java 25. Bei Problemen mit einer unterstützten Version immer nach OP-Helper-Datei, Fabric-Version, Fabric-API und Fehlermeldung fragen.
- Preisangaben hängen von verfügbaren Auktions- und externen Daten ab. Fehlende oder Vergleichspreise nicht als exakte Werte ausgeben.
- Erfinde keine weiteren Funktionen, Server-Plugins oder Unterstützung für andere Server.
`.trim();

function ticketPanelComponents(ticketChannelId, supportRoleId, notificationChannelId) {
  return new ActionRowBuilder().addComponents(Object.entries(ticketTypes).map(([type, details]) =>
    new ButtonBuilder()
      .setCustomId(`ticket:create:${type}:${ticketChannelId}:${supportRoleId || 'none'}:${notificationChannelId}`)
      .setLabel(details.label)
      .setEmoji(details.emoji)
      .setStyle(ButtonStyle.Primary)
  ));
}

function applicationButtons() {
  return new ActionRowBuilder().addComponents(Object.entries(applicationTypes).map(([type, label]) =>
    new ButtonBuilder()
      .setCustomId(`application:choose:${type}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Primary)
  ));
}

function safeTicketText(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'anliegen';
}

function ticketThreadName({ ticketId, state = 'offen', type, ownerId, title }) {
  const ticketPrefix = ticketId ? `ticket-${String(ticketId).padStart(4, '0')}-` : 'ticket-';
  const prefix = `${ticketPrefix}${state}-${type}-`;
  const suffix = `-${ownerId}`;
  const available = 100 - prefix.length - suffix.length;
  return `${prefix}${safeTicketText(title).slice(0, Math.max(1, available))}${suffix}`;
}

function parseTicketThread(channel) {
  if (!channel?.isThread?.()) return null;
  const numberedMatch = /^ticket-(\d{4,})-(offen|geschlossen)-(support|feedback|wunsch|meldung|sonstiges)-.+-(\d{17,20})$/.exec(channel.name);
  if (numberedMatch) return { ticketId: numberedMatch[1], state: numberedMatch[2], type: numberedMatch[3], ownerId: numberedMatch[4] };
  // Alte Tickets ohne laufende Nummer bleiben weiterhin bedienbar.
  const legacyMatch = /^ticket-(offen|geschlossen)-(support|feedback|wunsch|meldung|sonstiges)-.+-(\d{17,20})$/.exec(channel.name);
  return legacyMatch && { ticketId: null, state: legacyMatch[1], type: legacyMatch[2], ownerId: legacyMatch[3] };
}

async function getNextTicketNumber(ticketChannel) {
  const cached = ticketNumbersByChannel.get(ticketChannel.id);
  if (cached) {
    const next = cached + 1;
    ticketNumbersByChannel.set(ticketChannel.id, next);
    return String(next).padStart(4, '0');
  }

  const active = await ticketChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
  const archived = await ticketChannel.threads.fetchArchived({ type: 'private', limit: 100 }).catch(() => ({ threads: new Map() }));
  const allThreads = [...active.threads.values(), ...archived.threads.values()];
  const highest = allThreads.reduce((maximum, thread) => {
    const ticket = parseTicketThread(thread);
    return ticket?.ticketId ? Math.max(maximum, Number(ticket.ticketId)) : maximum;
  }, 0);
  const next = highest + 1;
  ticketNumbersByChannel.set(ticketChannel.id, next);
  return String(next).padStart(4, '0');
}

function ticketNumberLabel(ticket) {
  return ticket.ticketId ? `Ticket #${ticket.ticketId}` : 'Dieses Ticket';
}

function ticketTitleFromThreadName(thread, ticket) {
  const numbered = new RegExp(`^ticket-${ticket.ticketId}-(?:offen|geschlossen)-${ticket.type}-(.+)-${ticket.ownerId}$`).exec(thread.name);
  if (numbered) return numbered[1];
  const legacy = new RegExp(`^ticket-(?:offen|geschlossen)-${ticket.type}-(.+)-${ticket.ownerId}$`).exec(thread.name);
  return legacy?.[1] || 'anliegen';
}

function isTicketSupport(interaction, supportRoleId) {
  return supportRoleId && interaction.member.roles?.cache.has(supportRoleId);
}

function getConfiguredTeamRoleId(guild) {
  // Die Rolle kann in Discord unterschiedlich groß geschrieben sein, z. B. "TEAM".
  return guild.roles.cache.find(role => role.name.toLowerCase() === config.teamRoleName.toLowerCase())?.id || null;
}

function canManageTicket(interaction, ticket, supportRoleId) {
  return interaction.user.id === ticket.ownerId || isTicketSupport(interaction, supportRoleId) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
}

async function addSupportMembers(thread, guild, supportRoleId) {
  if (!supportRoleId) return;
  const supportRole = guild.roles.cache.get(supportRoleId);
  if (!supportRole) return;
  const members = await guild.members.fetch();
  await Promise.all(members.filter(member => member.roles.cache.has(supportRole.id))
    .map(member => thread.members.add(member.id).catch(() => null)));
}

async function getTicketRouting(thread) {
  const messages = await thread.messages.fetch({ limit: 20 });
  const openingMessage = messages.find(message =>
    message.author.id === client.user.id && message.components.some(row =>
      row.components.some(component => component.customId?.startsWith('ticket:close'))));
  const closeButton = openingMessage?.components
    .flatMap(row => row.components)
    .find(component => component.customId?.startsWith('ticket:close'));
  const [, , buttonSupportRoleId = 'none', notificationChannelId = 'none'] = (closeButton?.customId || '').split(':');
  return {
    supportRoleId: buttonSupportRoleId !== 'none' ? buttonSupportRoleId : openingMessage?.mentions.roles.first()?.id,
    notificationChannelId: notificationChannelId !== 'none' ? notificationChannelId : null
  };
}

async function getTicketSupportRoleId(thread) {
  return (await getTicketRouting(thread)).supportRoleId;
}

async function forwardTicketToTeam(thread, ticket, summary) {
  const routing = await getTicketRouting(thread);
  // Alte Ticket-Panels können noch "Discord Serverleitung" enthalten. Für die
  // tatsächliche Weiterleitung zählt deshalb immer die feste Discord-Rolle Team.
  const teamRoleId = getConfiguredTeamRoleId(thread.guild);
  const notificationChannelId = config.ticketNotificationChannelId || routing.notificationChannelId;
  if (!notificationChannelId) return false;
  const notificationChannel = await thread.guild.channels.fetch(notificationChannelId).catch(() => null);
  if (!notificationChannel?.isTextBased()) return false;
  const messages = await notificationChannel.messages.fetch({ limit: 50 });
  // Ältere Ticket-Panels können noch eine falsche Rolle in der Button-ID
  // enthalten. Deshalb reicht die Thread-ID zum Wiederfinden aus.
  const notification = messages.find(message => message.components.some(row =>
    row.components.some(component => component.customId?.startsWith(`ticket:join:${thread.id}:`))));
  const button = notification?.components.flatMap(row => row.components)
    .find(component => component.customId?.startsWith('ticket:join:'));
  if (button?.label === 'Ticket übernehmen') return false;

  const forwardedTicket = {
    content: teamRoleId ? `<@&${teamRoleId}>` : undefined,
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Ticket wartet auf Übernahme')
      .setDescription('Die Ticket-KI hat das erste Anliegen aufgenommen. Übernimm das Ticket, um direkt zu helfen.')
      .addFields(
        { name: 'Ticket-ID', value: ticket.ticketId ? `#${ticket.ticketId}` : 'Altes Ticket ohne Nummer', inline: true },
        { name: 'Ticket', value: `<#${thread.id}>` },
        { name: 'Erstellt von', value: `<@${ticket.ownerId}>` },
        { name: 'Anliegen', value: summary.slice(0, 900) || 'Kein Text angegeben.' }
      )
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:join:${thread.id}:${teamRoleId || 'none'}`)
        .setLabel('Ticket übernehmen')
        .setEmoji('📩')
        .setStyle(ButtonStyle.Success)
    )],
    allowedMentions: teamRoleId ? { roles: [teamRoleId] } : { parse: [] }
  };
  // Falls ein sehr altes Ticket keine ursprüngliche Team-Nachricht hat,
  // wird eine neue mit denselben Informationen erzeugt.
  if (notification) await notification.edit(forwardedTicket);
  else await notificationChannel.send(forwardedTicket);
  return true;
}

async function closeTicket(thread, ticket, closedBy = null, reason = null) {
  const scheduled = scheduledTicketClosures.get(thread.id);
  if (scheduled) clearTimeout(scheduled.timeout);
  scheduledTicketClosures.delete(thread.id);
  const closedByText = closedBy?.tag || closedBy?.username || scheduled?.requesterTag || 'dem Support-Team';
  const closeReason = reason || scheduled?.reason || 'Kein Grund angegeben.';
  const ticketLabel = ticketNumberLabel(ticket);
  const owner = await thread.client.users.fetch(ticket.ownerId).catch(() => null);
  if (owner) {
    await owner.send({
      embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('Ticket geschlossen')
        .setDescription(`Dein **${ticketLabel}** wurde geschlossen.`)
        .addFields(
          { name: 'Bereich', value: ticketTypes[ticket.type]?.label || ticket.type || 'Nicht angegeben', inline: true },
          { name: 'Bearbeitet von', value: closedByText, inline: true },
          { name: 'Grund', value: closeReason }
        )
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Ticket ansehen')
          .setEmoji('🔎')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${thread.guild.id}/${thread.id}`)
      )]
    }).catch(error => console.warn(`DM für geschlossenes ${ticketLabel} konnte nicht gesendet werden:`, error.message));
  }
  await thread.setName(ticketThreadName({
    ticketId: ticket.ticketId, state: 'geschlossen', type: ticket.type, ownerId: ticket.ownerId, title: ticketTitleFromThreadName(thread, ticket)
  }));
  await thread.send({
    content: `<@${ticket.ownerId}> 🔒 **${ticketLabel}** wurde geschlossen und archiviert.\n**Grund:** ${closeReason}\nEs bleibt für das Team zur Einsicht erhalten.`,
    allowedMentions: { users: [ticket.ownerId] }
  });
  await thread.setLocked(true);
  await thread.setArchived(true);
}

async function getApplicationApplicantId(thread) {
  const messages = await thread.messages.fetch({ limit: 50 }).catch(() => new Map());
  for (const message of messages.values()) {
    const applicationEmbed = message.embeds.find(embed => embed.title?.startsWith('Bewerbung:'));
    const applicantId = applicationEmbed?.description?.match(/\((\d{17,20})\)/)?.[1];
    if (applicantId) return applicantId;
  }
  return null;
}

async function closeApplicationThread(thread, closedBy = null, reason = 'Kein Grund angegeben.') {
  const scheduled = scheduledTicketClosures.get(thread.id);
  if (scheduled) clearTimeout(scheduled.timeout);
  scheduledTicketClosures.delete(thread.id);
  const closedByText = closedBy?.tag || closedBy?.username || scheduled?.requesterTag || 'dem Serverteam';
  await thread.send(`🔒 Diese Bewerbung wurde von ${closedByText} geschlossen.\n**Grund:** ${reason || scheduled?.reason || 'Kein Grund angegeben.'}`);
  await thread.setLocked(true, 'Bewerbung geschlossen');
  await thread.setArchived(true, 'Bewerbung geschlossen');
}

function isTicketTeam(interaction, supportRoleId) {
  const configuredTeamRoleId = getConfiguredTeamRoleId(interaction.guild);
  return isTicketSupport(interaction, configuredTeamRoleId) || isTicketSupport(interaction, supportRoleId) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
}

function closeRequestComponents() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:approve-close').setLabel('Schließung zustimmen').setEmoji('✅').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:deny-close').setLabel('Ablehnen').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
  );
}

async function requestTicketClose(thread, ticket, requester, autoCloseMinutes = 1440, reason = null) {
  const recentMessages = await thread.messages.fetch({ limit: 30 });
  const alreadyRequested = recentMessages.some(message => message.components.some(row =>
    row.components.some(component => component.customId === 'ticket:approve-close')));
  if (alreadyRequested) return false;
  const closesAt = Math.floor((Date.now() + autoCloseMinutes * 60_000) / 1000);
  const requesterText = requester.id === thread.client.user.id
    ? 'Die Ticket-KI schlägt vor'
    : `${requester} aus dem Team schlägt vor`;
  await thread.send({
    content: `<@${ticket.ownerId}>`,
    embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('Schließungsvorschlag')
      .setDescription(`${requesterText}, **${ticketNumberLabel(ticket)}** zu schließen. Nur die Person, die das Ticket erstellt hat, kann zustimmen oder ablehnen.\n\n**Grund:** ${reason || 'Kein Grund angegeben.'}\nOhne Antwort wird das Ticket automatisch <t:${closesAt}:R> geschlossen.`)
      .setTimestamp()],
    components: [closeRequestComponents()],
    allowedMentions: { users: [ticket.ownerId] }
  });
  const timeout = setTimeout(async () => {
    const currentTicket = parseTicketThread(thread);
    if (!currentTicket || currentTicket.state !== 'offen') return;
    try {
      await closeTicket(thread, currentTicket);
    } catch (error) {
      console.error('Ticket konnte nicht automatisch geschlossen werden:', error.message);
    }
  }, autoCloseMinutes * 60_000);
  scheduledTicketClosures.set(thread.id, { timeout, closesAt, requesterTag: requester.tag || requester.username, reason });
  return true;
}

function extractGeminiText(response) {
  return response.steps
    ?.filter(step => step.type === 'model_output')
    .flatMap(step => step.content || [])
    .filter(content => content.type === 'text')
    .map(content => content.text)
    .join('\n')
    .trim();
}

function teamMention(guild) {
  const roleId = getConfiguredTeamRoleId(guild);
  return roleId ? `<@&${roleId}>` : 'das Support-Team';
}

async function answerTicketWithGemini(message, ticket) {
  if (!config.geminiApiKey || message.author.id !== ticket.ownerId || ticketAiBusyThreads.has(message.channel.id)) return;
  ticketAiBusyThreads.add(message.channel.id);
  let typingRefresh;
  try {
    const userText = message.content.trim().slice(0, 1800);
    if (!userText) return;
    if (ticketFollowupPendingClosures.has(message.channel.id) && ticket.type === 'support') {
      const answer = userText.toLowerCase().replace(/[.!?,]/g, '').trim();
      if (['nein', 'nee', 'nö', 'no', 'nope'].includes(answer)) {
        ticketFollowupPendingClosures.delete(message.channel.id);
        const requested = await requestTicketClose(
          message.channel,
          ticket,
          client.user,
          24 * 60,
          'Die Person hat bestätigt, dass keine weitere Frage offen ist.'
        );
        await message.reply({
          content: requested
            ? 'Alles klar. Ich habe eine Schließungsanfrage gestellt. Du kannst sie unten bestätigen oder ablehnen. Wenn du nicht antwortest, wird das Ticket in 24 Stunden automatisch geschlossen.'
            : 'Für dieses Ticket gibt es bereits eine offene Schließungsanfrage. Du kannst sie unten bestätigen oder ablehnen.',
          allowedMentions: { parse: [] }
        });
        return;
      }
      if (['ja', 'j', 'yes'].includes(answer)) {
        ticketFollowupPendingClosures.delete(message.channel.id);
        await message.reply({ content: 'Okay, was ist deine Frage?', allowedMentions: { parse: [] } });
        return;
      }
      // Eine neue Frage beendet den Schließungs-Follow-up; sie wird normal beantwortet.
      ticketFollowupPendingClosures.delete(message.channel.id);
    }
    const isUserReportRequest = /\b(?:user|nutzer|mitglied|spieler|jemanden)\b.{0,60}\b(?:melden|meldung|report|beschweren)\b|\b(?:melden|meldung|report|beschweren)\b.{0,60}\b(?:user|nutzer|mitglied|spieler|jemanden)\b/i.test(userText);
    if (ticket.type !== 'meldung' && isUserReportRequest) {
      const panelChannelId = message.channel.parentId;
      const response = {
        content: `Ja, du kannst den Spieler dem Serverteam melden. In diesem **${ticketTypes[ticket.type]?.label || 'Support'}**-Ticket wurde die Meldung aber noch nicht eingereicht. So erstellst du das passende Ticket:\n1. Klicke auf **Ticket-Auswahl öffnen**.\n2. Wähle im Panel den Button **Meldung**.\n3. Im neuen privaten Thread nennst du den Spielernamen, beschreibst kurz den Vorfall und wann er passiert ist. Screenshots oder andere Belege kannst du dort ebenfalls senden.\n\nDein aktuelles Ticket bleibt offen. Die Meldung wird erst im neuen **Meldung**-Ticket ans Team geschickt. Hast du sonst noch eine Frage?`,
        allowedMentions: { parse: [] }
      };
      if (panelChannelId) {
        response.components = [new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Ticket-Auswahl öffnen')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${message.guild.id}/${panelChannelId}`)
        )];
      }
      await message.reply(response);
      if (ticket.type === 'support') ticketFollowupPendingClosures.add(message.channel.id);
      return;
    }
    const pendingConfirmation = ticketSummaryConfirmations.get(message.channel.id);
    if (pendingConfirmation) {
      const answer = userText.toLowerCase().replace(/[.!?]/g, '').trim();
      if (['ja', 'j', 'yes'].includes(answer)) {
        ticketSummaryConfirmations.delete(message.channel.id);
        const wasForwarded = await forwardTicketToTeam(message.channel, ticket, pendingConfirmation.summary);
        const teamRoleId = getConfiguredTeamRoleId(message.guild);
        await message.reply({
          content: wasForwarded
            ? `✅ Danke für die Bestätigung. Ich leite dein Ticket jetzt an ${teamMention(message.guild)} weiter. Ein Teammitglied wird sich darum kümmern.`
            : '✅ Danke für die Bestätigung. Dein Anliegen bleibt für das Support-Team im Ticket sichtbar.',
          allowedMentions: wasForwarded && teamRoleId ? { roles: [teamRoleId], repliedUser: false } : { parse: [], repliedUser: false }
        });
        return;
      }
      if (['nein', 'n', 'no'].includes(answer)) {
        ticketSummaryConfirmations.delete(message.channel.id);
        await message.reply({ content: 'Kein Problem. Schreibe bitte, was an der Zusammenfassung nicht stimmt oder ergänze die fehlenden Angaben. Ich fasse es danach erneut zusammen.', allowedMentions: { repliedUser: false } });
        return;
      }
      await message.reply({ content: 'Bitte antworte auf die Zusammenfassung nur mit **Ja** oder **Nein**.', allowedMentions: { repliedUser: false } });
      return;
    }
    // Der Indikator verschwindet nach wenigen Sekunden. Daher wird er bei
    // längeren Gemini-Anfragen regelmäßig erneuert.
    await message.channel.sendTyping().catch(() => null);
    typingRefresh = setInterval(() => message.channel.sendTyping().catch(() => null), 7_000);
    const recentMessages = await message.channel.messages.fetch({ limit: 20 });
    const oldHistory = [...recentMessages.values()]
      .filter(item => item.id !== message.id && item.content.trim() && item.embeds.length === 0)
      .filter(item => item.author.id === ticket.ownerId || item.author.id === client.user.id)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(item => ({
        role: item.author.id === ticket.ownerId ? 'Nutzer' : 'KI',
        text: item.content.trim().slice(0, 1800)
      }));
    const conversationEntries = [...oldHistory, { role: 'Nutzer', text: userText }].slice(-8);
    const conversation = conversationEntries
      .map(entry => `${entry.role}: ${entry.text}`)
      .join('\n');
    const ticketCategoryInstruction = ticket.type === 'meldung'
      ? 'KATEGORIE MELDUNG: Dieses Ticket ist für Meldungen über Mitglieder oder Probleme auf dem Server. Bearbeite solche Meldungen hier im Server-Support. Verweise die Person dafür niemals an den Discord-Support. Frage bei Bedarf kurz nach dem gemeldeten Mitglied, was passiert ist, wann es passiert ist und ob Belege vorhanden sind. Behaupte nicht, selbst Maßnahmen gegen jemanden ausführen zu können.'
      : `KATEGORIE ${ticketTypes[ticket.type]?.label || ticket.type}: Wenn die Person einen Servernutzer melden möchte, ist dieses Ticket die falsche Kategorie. Antworte freundlich und direkt, dass dieses Ticket für „${ticketTypes[ticket.type]?.label || ticket.type}“ gedacht ist, und bitte sie, im Ticket-Panel ein neues Ticket über den Button „Meldung“ zu öffnen. Verweise sie dafür niemals an den Discord-Support. Sammle in der falschen Kategorie keine weiteren Details zur Meldung und gib dafür keine SUMMARY_READY-Zusammenfassung aus.`;
    const prompt = `Du bist der freundliche deutsche KI-Assistent für die Support-Tickets dieses Minecraft-Servers und die Mod „OP-Helper Mod“. Ordne Anliegen anhand der Ticket-Art ein: Fragen zur OP-Helper-Mod sind Mod-Support; Meldungen über Mitglieder sind Server-Support und werden über die Ticket-Kategorie „Meldung“ bearbeitet. Verweise Meldungen über Servermitglieder nicht an den Discord-Support. Nenne keine Plugins, Server-Einstellungen oder Mod-Funktionen, wenn die Person sie nicht selbst erwähnt hat. Nutze ausschließlich das untenstehende Wissen für konkrete Aussagen über die Mod. Lies den vollständigen Ticketverlauf sorgfältig: Frage niemals erneut nach einer Minecraft-Version, Mod-Version, Fehlermeldung oder anderen Angabe, die dort bereits genannt wurde. OP-Helper unterstützt nur Fabric; frage niemals nach Forge, NeoForge oder dem Mod-Loader. Erfinde keine Fakten, Anleitungen oder Zusagen. Du kannst keine Server-Einstellungen ändern, keine Konten prüfen und keine Aktionen ausführen.\n\n${ticketCategoryInstruction}\n\nDein Ablauf: Sammle zuerst die relevanten Angaben. Bei einem technischen Problem sind das normalerweise Minecraft-Version, OP-Helper-Datei bzw. Mod-Version, Fabric/Fabric-API, genaue Problembeschreibung, Fehlermeldung und bereits versuchte Schritte – frage aber nur nach Angaben, die wirklich noch fehlen. Bei Feedback, Wünschen oder Meldungen in der passenden Kategorie reichen die dafür passenden Details. Stelle immer nur eine kurze, gezielte Rückfrage. Beginne niemals mit „Hallo“, „Hi“ oder „Willkommen“.\n\nSobald die Angaben für das Team ausreichend klar sind ODER die Person ausdrücklich eine Weiterleitung, Zusammenfassung oder „fertig“ verlangt, antworte ausschließlich in diesem technischen Format und ohne weiteren Text:\nSUMMARY_READY\n- kurze Zusammenfassung mit allen bekannten Angaben\n- fehlende Angaben ausdrücklich als „nicht angegeben“ nennen\n\nWenn noch etwas Wichtiges fehlt, stelle stattdessen nur die nächste kurze Rückfrage.\n\n${opHelperKnowledge}\n\nTicket-Art: ${ticketTypes[ticket.type]?.label || ticket.type}\n\nTicketverlauf:\n${conversation}`;
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: {
          'x-goog-api-key': config.geminiApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.geminiModel,
          store: false,
          input: prompt
        })
      });
      if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 2) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(`Gemini-Anfrage fehlgeschlagen (HTTP ${response.status})`);
    const data = await response.json();
    const answer = extractGeminiText(data).slice(0, 1900);
    if (!answer) throw new Error('Gemini hat keine Textantwort geliefert');
    const summaryMatch = /^SUMMARY_READY\s*\n([\s\S]+)/i.exec(answer);
    if (summaryMatch) {
      const summary = summaryMatch[1].trim().slice(0, 1800);
      ticketSummaryConfirmations.set(message.channel.id, { summary });
      await message.reply({
        embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('Zusammenfassung deines Anliegens')
          .setDescription(summary)
          .setFooter({ text: 'Stimmt das? Antworte bitte mit Ja oder Nein.' })
          .setTimestamp()],
        allowedMentions: { repliedUser: false }
      });
      return;
    }
    await message.reply({ content: answer, allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) {
    console.error('Ticket-KI konnte nicht antworten:', error.message);
    await message.reply({ content: 'Die Ticket-KI ist gerade nicht erreichbar. Ein Teammitglied kann dein Anliegen trotzdem bearbeiten.', allowedMentions: { repliedUser: false } }).catch(() => null);
  } finally {
    if (typingRefresh) clearInterval(typingRefresh);
    ticketAiBusyThreads.delete(message.channel.id);
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Angemeldet als ${readyClient.user.tag}`);
  if (config.tempVoiceLobbyId) {
    const lobby = await readyClient.channels.fetch(config.tempVoiceLobbyId).catch(error => {
      console.error('Voice-Lobby konnte nicht geladen werden:', error.message);
      return null;
    });
    if (lobby) {
      const permissions = lobby.permissionsFor(readyClient.user);
      console.log(`Voice-Lobby erkannt: ${lobby.name} (Voice: ${lobby.isVoiceBased()}, Verwalten: ${permissions?.has(PermissionFlagsBits.ManageChannels)}, Verschieben: ${permissions?.has(PermissionFlagsBits.MoveMembers)})`);
    }
  }
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    if (config.guildId) {
      // Alte globale Befehle entfernen, damit Discord nichts doppelt anzeigt.
      await rest.put(Routes.applicationCommands(readyClient.user.id), { body: [] });
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, config.guildId), {
        body: commands.map(command => command.toJSON())
      });
      console.log('Slash-Befehle für diesen Server registriert; globale Duplikate entfernt.');
    } else {
      await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands.map(command => command.toJSON()) });
      console.log('Slash-Befehle registriert. Discord kann bis zu einer Stunde brauchen, bis sie überall sichtbar sind.');
    }
  } catch (error) {
    console.error('Slash-Befehle konnten nicht registriert werden:', error.message);
  }
  await checkTwitchStreams();
  setInterval(checkTwitchStreams, config.streamPollMinutes * 60_000);
});

client.on(Events.GuildMemberAdd, async member => {
  const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(`Willkommen auf **${member.guild.name}**, ${member}! Bitte lies zuerst die Regeln.`);
  }
});

async function removeEmptyTempVoiceChannel(channel) {
  if (!channel?.isVoiceBased() || !channel.name.startsWith('🔊│')) return;
  if (channel.members.size !== 0) return;
  await channel.delete('Temporärer Sprachkanal ist leer').catch(error =>
    console.error('Temporärer Sprachkanal konnte nicht gelöscht werden:', error.message));
  temporaryVoiceOwners.delete(channel.id);
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  console.log(`Voice-Status: ${newState.member?.user?.tag || 'unbekannt'} ${oldState.channelId || '—'} → ${newState.channelId || '—'}`);
  // Leere, vom Bot angelegte Räume werden automatisch entfernt.
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await removeEmptyTempVoiceChannel(oldState.channel);
  }
  if (!config.tempVoiceLobbyId || newState.channelId !== config.tempVoiceLobbyId) return;

  const lobby = newState.channel;
  if (!lobby?.isVoiceBased()) return;
  try {
    const room = await newState.guild.channels.create({
      name: `🔊│${newState.member.displayName}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: config.tempVoiceCategoryId || lobby.parentId || undefined,
      reason: `Temporärer Talk für ${newState.member.user.tag}`
    });
    temporaryVoiceOwners.set(room.id, newState.member.id);
    await room.send?.({
      embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Dein Voice-Chat')
        .setDescription(`${newState.member}, du bist der Inhaber dieses temporären Voice-Chats.\n\nUm eine Person zu entfernen, nutze: \`/voice-kick mitglied:@Name\`\nDer Befehl funktioniert nur, solange du selbst in diesem Voice-Chat bist.`)]
    }).catch(error => console.error('Voice-Chat-Anleitung konnte nicht gesendet werden:', error.message));
    await newState.setChannel(room, 'Eigenen temporären Talk erstellen');
  } catch (error) {
    console.error('Temporärer Sprachkanal konnte nicht erstellt werden:', error.message);
  }
});

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  if (config.bannedTerms.length && !message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    const matchedTerm = config.bannedTerms.find(term => message.content.toLowerCase().includes(term));
    if (matchedTerm) {
      await message.delete().catch(console.error);
      const member = message.member;
      let result = 'Nachricht gelöscht';
      if (config.filterAction === 'timeout' && member?.moderatable) {
        await member.timeout(config.timeoutMinutes * 60_000, `Filtertreffer: ${matchedTerm}`);
        result += `; Timeout für ${config.timeoutMinutes} Minuten`;
      } else if (config.filterAction === 'ban' && member?.bannable) {
        await member.ban({ reason: `Filtertreffer: ${matchedTerm}`, deleteMessageSeconds: 0 });
        result += '; Mitglied gebannt';
      }
      await logModeration(message.guild, 'Automoderation', [
        { name: 'Mitglied', value: `${message.author.tag} (${message.author.id})` },
        { name: 'Aktion', value: result },
        { name: 'Regel', value: `Filtertreffer: ${matchedTerm}` }
      ]);
      return;
    }
  }
  const ticket = parseTicketThread(message.channel);
  if (ticket?.state === 'offen') await answerTicketWithGemini(message, ticket);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '✅') return;
  try {
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message;
    if (message.partial) await message.fetch();
    if (!message.guild || !isRulesMessage(message)) return;

    const member = await message.guild.members.fetch(user.id);
    const memberRole = await getOrCreateMemberRole(message.guild);
    if (!member.roles.cache.has(memberRole.id)) {
      await member.roles.add(memberRole, 'Serverregeln mit grünem Haken bestätigt');
    }
  } catch (error) {
    console.error('Mitgliederrolle nach Regel-Bestätigung konnte nicht vergeben werden:', error.message);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot || reaction.emoji.name !== '✅') return;
  try {
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message;
    if (message.partial) await message.fetch();
    if (!message.guild || !isRulesMessage(message)) return;

    const member = await message.guild.members.fetch(user.id);
    const memberRole = await getOrCreateMemberRole(message.guild);
    if (member.roles.cache.has(memberRole.id)) {
      await member.roles.remove(memberRole, 'Regel-Bestätigung mit grünem Haken zurückgenommen');
    }
  } catch (error) {
    console.error('Mitgliederrolle nach entfernten Regel-Haken konnte nicht entfernt werden:', error.message);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.inGuild()) return;

  if ((interaction.isStringSelectMenu() && interaction.customId === 'application:type') ||
      (interaction.isButton() && interaction.customId.startsWith('application:choose:'))) {
    const type = interaction.isButton() ? interaction.customId.split(':')[2] : interaction.values[0];
    if (!applicationTypes[type]) return interaction.reply({ content: 'Diese Bewerbungsart gibt es nicht.', ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId(`application:submit:${type}`)
      .setTitle(`Bewerbung als ${applicationTypes[type]}`)
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('age').setLabel('Wie alt bist du?').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('availability').setLabel('Wann bist du meist verfügbar?').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('motivation').setLabel('Warum möchtest du diese Rolle?').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('experience').setLabel('Welche Erfahrung bringst du mit?').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true))
      );
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('application:submit:')) {
    const type = interaction.customId.split(':')[2];
    const channel = config.applicationChannelId
      ? await interaction.guild.channels.fetch(config.applicationChannelId).catch(() => null)
      : interaction.channel;
    if (!applicationTypes[type]) return interaction.reply({ content: 'Diese Bewerbungsart gibt es nicht.', ephemeral: true });
    if (!channel?.isTextBased()) {
      return interaction.reply({ content: 'Der Bewerbungskanal ist nicht konfiguriert. Bitte informiere das Serverteam.', ephemeral: true });
    }
    if (!channel.threads || channel.isThread?.()) {
      return interaction.reply({ content: 'Der Bewerbungskanal unterstützt keine privaten Threads. Bitte informiere das Serverteam.', ephemeral: true });
    }
    try {
      const answers = [
        { name: 'Alter', value: interaction.fields.getTextInputValue('age') },
        { name: 'Verfügbarkeit', value: interaction.fields.getTextInputValue('availability') },
        { name: 'Motivation', value: interaction.fields.getTextInputValue('motivation') },
        { name: 'Erfahrung', value: interaction.fields.getTextInputValue('experience') }
      ];
      const thread = await channel.threads.create({
        name: `Bewerbung-${applicationTypes[type]}-${interaction.user.username}`.slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
        reason: `Bewerbung als ${applicationTypes[type]} von ${interaction.user.tag}`
      });
      await thread.members.add(interaction.user.id);
      await thread.send({
        content: `Neue Bewerbung von ${interaction.user} · ${applicationTypes[type]}`,
        embeds: [new EmbedBuilder().setColor(0x5865F2)
          .setTitle(`Bewerbung: ${applicationTypes[type]}`)
          .setDescription(`**Bewerber:** ${interaction.user.tag} (\`${interaction.user.id}\`)`)
          .addFields(answers)
          .setTimestamp()],
        allowedMentions: { parse: [] }
      });
      const notificationChannel = await interaction.guild.channels
        .fetch(config.applicationNotificationChannelId).catch(() => null);
      if (notificationChannel?.isTextBased() && !notificationChannel.isThread?.()) {
        const teamRole = interaction.guild.roles.cache.find(role => role.name === config.teamRoleName);
        await notificationChannel.send({
          content: teamRole ? `<@&${teamRole.id}> Neue Bewerbung eingegangen.` : 'Neue Bewerbung eingegangen.',
          embeds: [new EmbedBuilder().setColor(0xFEE75C)
            .setTitle(`Neue Bewerbung: ${applicationTypes[type]}`)
            .setDescription(`${interaction.user} hat sich beworben.`)
            .setTimestamp()],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`application:take:${thread.id}`)
              .setLabel('Bewerbung übernehmen').setEmoji('📩').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setLabel('Bewerbung öffnen')
              .setURL(`https://discord.com/channels/${interaction.guild.id}/${thread.id}`)
              .setStyle(ButtonStyle.Link)
          )],
          allowedMentions: teamRole ? { roles: [teamRole.id] } : { parse: [] }
        }).catch(error => console.error('Team-Benachrichtigung zur Bewerbung konnte nicht gesendet werden:', error.message));
      }
      return interaction.reply({ content: `Deine Bewerbung wurde in einem privaten Thread erstellt: <#${thread.id}>`, ephemeral: true });
    } catch (error) {
      console.error('Bewerbung konnte nicht gesendet werden:', error);
      return interaction.reply({ content: 'Deine Bewerbung konnte gerade nicht gesendet werden. Bitte versuche es später erneut.', ephemeral: true });
    }
  }

  if ((interaction.isStringSelectMenu() || interaction.isButton()) && interaction.customId.startsWith('ticket:create:')) {
    const parts = interaction.customId.split(':');
    const hasTypeInCustomId = Boolean(ticketTypes[parts[2]]);
    const ticketType = hasTypeInCustomId
      ? parts[2]
      : (interaction.isStringSelectMenu() ? (interaction.values[0] || 'support') : 'support');
    const ticketChannelId = hasTypeInCustomId ? parts[3] : parts[2];
    const supportRoleId = (hasTypeInCustomId ? parts[4] : parts[3]) || 'none';
    const notificationChannelId = (hasTypeInCustomId ? parts[5] : parts[4]) || 'none';
    // Neue Tickets verwenden immer die Rolle "Team", sofern sie vorhanden ist.
    // Dadurch wird eine versehentlich beim Setup gewählte Serverleitungs-Rolle
    // nicht mehr angepingt.
    const teamRoleId = getConfiguredTeamRoleId(interaction.guild) || (supportRoleId === 'none' ? null : supportRoleId);
    const ticketTeamRoleId = teamRoleId || 'none';
    const ticketChannel = await interaction.guild.channels.fetch(ticketChannelId).catch(() => null);
    if (!ticketChannel?.isTextBased() || !ticketChannel.threads) {
      return interaction.reply({ content: 'Der Ticket-Kanal wurde nicht gefunden.', ephemeral: true });
    }
    if (!ticketTypes[ticketType]) return interaction.reply({ content: 'Diese Ticket-Art gibt es nicht.', ephemeral: true });
    try {
      const activeThreads = await ticketChannel.threads.fetchActive();
      const existing = activeThreads.threads.find(thread => {
        const details = parseTicketThread(thread);
        return details?.ownerId === interaction.user.id && details.state === 'offen' && details.type === ticketType;
      });
      if (existing) return interaction.reply({ content: `Du hast bereits ein offenes ${ticketTypes[ticketType].label}-Ticket: <#${existing.id}>`, ephemeral: true });

      const ticketId = await getNextTicketNumber(ticketChannel);

      const ticket = await ticketChannel.threads.create({
        name: ticketThreadName({ ticketId, type: ticketType, ownerId: interaction.user.id, title: interaction.user.username }),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
        reason: `${ticketTypes[ticketType].label}-Ticket von ${interaction.user.tag}`
      });
      await ticket.members.add(interaction.user.id);
      await ticket.send({
        content: `${interaction.user}${ticketTeamRoleId !== 'none' ? ` <@&${ticketTeamRoleId}>` : ''}`,
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${ticketNumberLabel({ ticketId })} · ${ticketTypes[ticketType].label}`)
          .setDescription(config.geminiApiKey
            ? `Hallo ${interaction.user}! Ich bin die Ticket-KI. Bitte nenne mir dein Anliegen möglichst genau, dann helfe ich dir bei der Einordnung. Ein Teammitglied kann jederzeit übernehmen. Schreibe **„bitte weiterleiten“**, wenn du direkt an das Support-Team übergeben werden möchtest.\n\nDas Support-Team kann bei Bedarf einen Schließungsvorschlag senden. Du entscheidest dann, ob das Ticket geschlossen wird.`
            : 'Beschreibe dein Anliegen so genau wie möglich. Ein Teammitglied meldet sich hier.\n\nDas Support-Team kann bei Bedarf einen Schließungsvorschlag senden. Du entscheidest dann, ob das Ticket geschlossen wird.')
          .setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket:close:${ticketTeamRoleId}:${notificationChannelId}`).setLabel('Schließung vorschlagen').setEmoji('🔒').setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: ticketTeamRoleId !== 'none'
          ? { roles: [ticketTeamRoleId], users: [interaction.user.id] }
          : { users: [interaction.user.id] }
      });
      const teamNotificationChannelId = config.ticketNotificationChannelId || notificationChannelId;
      if (teamNotificationChannelId !== 'none') {
        const notificationChannel = await interaction.guild.channels.fetch(teamNotificationChannelId).catch(() => null);
        if (notificationChannel?.isTextBased()) {
          await notificationChannel.send({
            content: ticketTeamRoleId !== 'none' ? `<@&${ticketTeamRoleId}>` : undefined,
            embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('Neues Ticket')
              .setDescription(`${interaction.user} hat ein neues Ticket erstellt. Klicke auf den Button, um dem privaten Ticket beizutreten.`)
              .addFields(
                { name: 'Ticket-ID', value: `#${ticketId}`, inline: true },
                { name: 'Ticket', value: `<#${ticket.id}>`, inline: true }
              )
              .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`ticket:join:${ticket.id}:${ticketTeamRoleId}`)
                .setLabel('Ticket beitreten')
                .setEmoji('📩')
                .setStyle(ButtonStyle.Success)
            )],
            allowedMentions: ticketTeamRoleId !== 'none' ? { roles: [ticketTeamRoleId] } : { parse: [] }
          });
        }
      }
      return interaction.reply({ content: `Dein privates Ticket wurde als Thread erstellt: <#${ticket.id}>`, ephemeral: true });
    } catch (error) {
      console.error('Ticket konnte nicht erstellt werden:', error);
      return interaction.reply({ content: `Ticket konnte nicht erstellt werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('application:take:')) {
    const threadId = interaction.customId.split(':')[2];
    const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
    if (!thread?.isThread?.() || thread.type !== ChannelType.PrivateThread) {
      return interaction.reply({ content: 'Der private Bewerbungs-Thread wurde nicht gefunden.', ephemeral: true });
    }
    if (!isTicketTeam(interaction, null)) {
      return interaction.reply({ content: 'Nur das Serverteam kann eine Bewerbung übernehmen.', ephemeral: true });
    }
    try {
      await thread.members.add(interaction.user.id);
      await thread.send(`📩 ${interaction.user} hat diese Bewerbung übernommen.`)
        .catch(error => console.error('Übernahme konnte nicht im Bewerbungs-Thread vermerkt werden:', error.message));
      return interaction.update({
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`application:take:${thread.id}`)
            .setLabel(`Übernommen von ${interaction.user.username}`.slice(0, 80))
            .setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setLabel('Bewerbung öffnen')
            .setURL(`https://discord.com/channels/${interaction.guild.id}/${thread.id}`)
            .setStyle(ButtonStyle.Link)
        )]
      });
    } catch (error) {
      return interaction.reply({ content: `Bewerbung konnte nicht übernommen werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket:join:')) {
    const [, , ticketId, supportRoleId = 'none'] = interaction.customId.split(':');
    const ticketChannel = await interaction.guild.channels.fetch(ticketId).catch(() => null);
    const ticket = parseTicketThread(ticketChannel);
    if (!ticket || ticket.state !== 'offen') {
      return interaction.reply({ content: 'Dieses Ticket ist nicht mehr offen.', ephemeral: true });
    }
    if (!isTicketTeam(interaction, supportRoleId === 'none' ? null : supportRoleId)) {
      return interaction.reply({ content: 'Nur das Support-Team darf diesem Ticket beitreten.', ephemeral: true });
    }
    try {
      await ticketChannel.members.add(interaction.user.id);
      if (interaction.component.label === 'Ticket übernehmen') {
        await interaction.update({
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ticket:join:${ticketChannel.id}:${supportRoleId}`)
              .setLabel(`Übernommen von ${interaction.user.username}`.slice(0, 80))
              .setEmoji('✅')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          )]
        });
        await ticketChannel.send(`📩 ${interaction.user} hat dieses Ticket übernommen.`);
        return;
      }
      return interaction.reply({ content: `Du bist dem Ticket beigetreten: <#${ticketChannel.id}>`, ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Beitritt zum Ticket fehlgeschlagen: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket:close')) {
    const ticket = parseTicketThread(interaction.channel);
    if (!ticket || ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen oder ungültig.', ephemeral: true });
    const [, , buttonSupportRoleId = 'none'] = interaction.customId.split(':');
    const supportRoleId = buttonSupportRoleId !== 'none' ? buttonSupportRoleId : interaction.message.mentions.roles.first()?.id;
    if (!isTicketTeam(interaction, supportRoleId)) {
      return interaction.reply({ content: 'Nur das Support-Team kann einen Schließungsvorschlag senden.', ephemeral: true });
    }
    try {
      const requested = await requestTicketClose(interaction.channel, ticket, interaction.user);
      return interaction.reply({ content: requested ? 'Der Schließungsvorschlag wurde an die Ticket-Erstellerin bzw. den Ticket-Ersteller gesendet.' : 'Für dieses Ticket gibt es bereits einen offenen Schließungsvorschlag.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Schließungsvorschlag konnte nicht gesendet werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && ['ticket:approve-close', 'ticket:deny-close'].includes(interaction.customId)) {
    const ticket = parseTicketThread(interaction.channel);
    const applicationThread = interaction.channel?.isThread?.() &&
      interaction.channel.type === ChannelType.PrivateThread && /^bewerbung-/i.test(interaction.channel.name);
    const applicantId = !ticket && applicationThread ? await getApplicationApplicantId(interaction.channel) : null;
    if ((!ticket && !applicantId) || (ticket && ticket.state !== 'offen')) {
      return interaction.reply({ content: 'Dieses Ticket oder diese Bewerbung ist bereits geschlossen oder ungültig.', ephemeral: true });
    }
    if (interaction.user.id !== (ticket?.ownerId || applicantId)) {
      return interaction.reply({ content: 'Nur die Person, die dieses Ticket oder diese Bewerbung erstellt hat, darf darüber entscheiden.', ephemeral: true });
    }
    if (interaction.customId === 'ticket:deny-close') {
      const scheduled = scheduledTicketClosures.get(interaction.channel.id);
      if (scheduled) clearTimeout(scheduled.timeout);
      scheduledTicketClosures.delete(interaction.channel.id);
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Schließungsvorschlag abgelehnt')
          .setDescription(`${interaction.user} hat den Schließungsvorschlag abgelehnt. Das Ticket bleibt offen.`).setTimestamp()],
        components: []
      });
    }
    try {
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('Schließungsvorschlag bestätigt')
          .setDescription(`${interaction.user} hat zugestimmt. Das Ticket wird archiviert.`).setTimestamp()],
        components: []
      });
      if (ticket) await closeTicket(interaction.channel, ticket);
      else await closeApplicationThread(interaction.channel, interaction.user);
    } catch (error) {
      return interaction.followUp({ content: `Ticket konnte nicht geschlossen werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('stream-role:')) {
    const streamer = streamers.find(item => interaction.customId === `stream-role:${item.login}`);
    if (!streamer) return;
    const role = interaction.guild.roles.cache.find(item => item.name === streamer.roleName);
    if (!role) return interaction.reply({ content: 'Die Rolle wurde noch nicht eingerichtet.', ephemeral: true });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
      return interaction.reply({ content: `Du bekommst keine Benachrichtigungen mehr für **${streamer.displayName}**.`, ephemeral: true });
    }
    await member.roles.add(role);
    return interaction.reply({ content: `Du wirst jetzt bei Streams von **${streamer.displayName}** benachrichtigt.`, ephemeral: true });
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'regeln') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Dafür brauchst du die Berechtigung „Server verwalten“.', ephemeral: true });
    }
    const subcommand = interaction.options.getSubcommand();
    try {
      const memberRole = await getOrCreateMemberRole(interaction.guild);
      if (subcommand === 'setup') {
        if (!interaction.channel?.isTextBased() || interaction.channel.isThread?.()) {
          return interaction.reply({ content: 'Führe `/regeln setup` bitte im normalen Regeln-Textkanal aus.', ephemeral: true });
        }
        const rulesMessage = await interaction.channel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Serverregeln')
            .setDescription(`Willkommen auf **${interaction.guild.name}**!\n\nBitte lies die Regeln vollständig durch:\n\n1. Gehe respektvoll miteinander um – keine Beleidigungen, Diskriminierung oder Belästigung.\n2. Kein Spam, keine Werbung und keine unerlaubten Links.\n3. Nutze die passenden Kanäle für dein Thema und halte dich an die Discord-Richtlinien.\n4. Folge den Anweisungen des Teams.\n\nReagiere unten mit ✅. Damit bestätigst du die Regeln und erhältst Zugriff auf die Mitgliederbereiche.`)
            .setFooter({ text: `Nach der Bestätigung erhältst du die Rolle ${memberRole.name}.` })
            .setTimestamp()]
        });
        await rulesMessage.react('✅');
        return interaction.reply({ content: 'Die Regeln mit dem grünen Bestätigungs-Haken wurden gesendet.', ephemeral: true });
      }

      if (subcommand === 'kategorie') {
        const category = interaction.options.getChannel('kategorie', true);
        if (category.type !== ChannelType.GuildCategory) {
          return interaction.reply({ content: 'Wähle bitte eine Kategorie aus.', ephemeral: true });
        }
        const channels = interaction.guild.channels.cache.filter(channel =>
          (channel.id === category.id || channel.parentId === category.id) && !channel.isThread?.());
        await protectMemberChannels(channels, interaction.guild, memberRole);
        return interaction.reply({ content: `Die Kategorie **${category.name}** ist jetzt nur mit **Verifiziert** sichtbar. Die Rolle **${config.legacyMemberRoleName}** allein reicht dort nicht mehr aus.`, ephemeral: true });
      }

      const teamCategory = interaction.options.getChannel('team-kategorie', true);
      if (teamCategory.type !== ChannelType.GuildCategory) {
        return interaction.reply({ content: 'Wähle bitte deine Team-Kategorie aus.', ephemeral: true });
      }
      const publicChannelIds = new Set([config.rulesChannelId, config.welcomeChannelId].filter(Boolean));
      const protectedChannels = interaction.guild.channels.cache.filter(channel =>
        !channel.isThread?.() &&
        channel.id !== teamCategory.id &&
        channel.parentId !== teamCategory.id &&
        !publicChannelIds.has(channel.id));
      await protectMemberChannels(protectedChannels, interaction.guild, memberRole);

      for (const channelId of publicChannelIds) {
        const channel = interaction.guild.channels.cache.get(channelId);
        if (channel?.permissionOverwrites) await makeChannelPublic(channel, interaction.guild);
      }
      return interaction.reply({ content: `Alle normalen Kanäle sind jetzt nur mit **Verifiziert** sichtbar. Regeln und Willkommen bleiben offen; die Team-Kategorie **${teamCategory.name}** wurde nicht verändert.`, ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Regel-Verifizierung konnte nicht eingerichtet werden: ${error.message}`, ephemeral: true });
    }
  }
  if (interaction.commandName === 'voice-kick') {
    const caller = await interaction.guild.members.fetch(interaction.user.id);
    const room = caller.voice.channel;
    const ownerId = room && temporaryVoiceOwners.get(room.id);
    if (!room || !ownerId || ownerId !== interaction.user.id) {
      return interaction.reply({ content: 'Diesen Befehl darf nur der Inhaber in seinem eigenen temporären Voice-Chat verwenden.', ephemeral: true });
    }
    const member = interaction.options.getMember('mitglied');
    if (!member || !('voice' in member) || member.voice.channelId !== room.id) {
      return interaction.reply({ content: 'Dieses Mitglied ist nicht in deinem Voice-Chat.', ephemeral: true });
    }
    if (member.id === interaction.user.id) {
      return interaction.reply({ content: 'Du kannst dich nicht selbst entfernen.', ephemeral: true });
    }
    try {
      await member.voice.disconnect(`Aus temporärem Voice-Chat von ${interaction.user.tag} entfernt`);
      return interaction.reply({ content: `${member} wurde aus deinem Voice-Chat entfernt.`, ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Mitglied konnte nicht entfernt werden: ${error.message}`, ephemeral: true });
    }
  }
  if (interaction.commandName === 'ticket') {
    const subcommand = interaction.options.getSubcommand();
    const ticket = parseTicketThread(interaction.channel);

    if (subcommand === 'setup') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Dafür brauchst du die Berechtigung „Server verwalten“.', ephemeral: true });
      }
      if (!interaction.channel?.isTextBased() || interaction.channel.isThread?.()) {
        return interaction.reply({ content: 'Führe `/ticket setup` bitte in einem normalen Textkanal aus, nicht in einem Thread.', ephemeral: true });
      }
      const supportRole = interaction.options.getRole('supportrolle');
      const notificationChannel = interaction.options.getChannel('benachrichtigungskanal', true);
      if (!notificationChannel?.isTextBased() || notificationChannel.isThread?.()) {
        return interaction.reply({ content: 'Wähle bitte einen normalen Textkanal für die Ticket-Benachrichtigungen.', ephemeral: true });
      }
      try {
        // Der normale Ticket-Startkanal bleibt für alle lesbar, auch wenn die
        // übergeordnete Kategorie den Nachrichtenverlauf eingeschränkt hat.
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          ReadMessageHistory: true
        }, 'Nachrichtenverlauf im Ticket-Startkanal anzeigen');
        await interaction.channel.send({
          embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Allgemeiner Support')
            .setDescription('Erstelle ein Ticket für dein Anliegen, um gezielte Hilfe in verschiedenen Bereichen zu erhalten. Wähle unten den passenden Bereich aus; dein Ticket wird als privater Thread erstellt.')],
          components: [ticketPanelComponents(interaction.channel.id, supportRole?.id, notificationChannel.id)]
        });
        return interaction.reply({ content: 'Das Ticket-Auswahlmenü wurde erstellt.', ephemeral: true });
      } catch (error) {
        return interaction.reply({ content: `Ticket-Menü konnte nicht erstellt werden: ${error.message}`, ephemeral: true });
      }
    }

    if (!ticket) {
      const applicationThread = interaction.channel?.isThread?.() &&
        interaction.channel.type === ChannelType.PrivateThread && /^bewerbung-/i.test(interaction.channel.name);
      if (applicationThread && ['close', 'close-anfrage', 'rename', 'add'].includes(subcommand)) {
        if (!isTicketTeam(interaction, null)) {
          return interaction.reply({ content: 'Nur das Serverteam kann Bewerbungen verwalten.', ephemeral: true });
        }
        try {
          if (subcommand === 'add') {
            const member = interaction.options.getMember('mitglied');
            if (!member || !('user' in member)) return interaction.reply({ content: 'Mitglied nicht gefunden.', ephemeral: true });
            await interaction.channel.members.add(member.id);
            return interaction.reply({ content: `${member} wurde zum Bewerbungs-Thread hinzugefügt.`, ephemeral: true });
          }
          if (subcommand === 'rename') {
            const name = interaction.options.getString('name', true);
            const newThreadName = `Bewerbung-${safeTicketText(name)}`.slice(0, 100);
            await interaction.channel.setName(newThreadName);
            return interaction.reply({ content: `Bewerbungs-Thread wurde in **${newThreadName}** umbenannt.`, ephemeral: true });
          }
          if (subcommand === 'close-anfrage') {
            const applicantId = await getApplicationApplicantId(interaction.channel);
            if (!applicantId) return interaction.reply({ content: 'Die bewerbende Person konnte nicht ermittelt werden.', ephemeral: true });
            const recentMessages = await interaction.channel.messages.fetch({ limit: 30 });
            const pendingRequest = recentMessages.some(message => message.components.some(row =>
              row.components.some(component => component.customId === 'ticket:approve-close')));
            if (pendingRequest) return interaction.reply({ content: 'Für diese Bewerbung gibt es bereits eine offene Schließungsanfrage.', ephemeral: true });
            const minutes = interaction.options.getInteger('minuten', true);
            const reason = interaction.options.getString('grund') || 'Kein Grund angegeben.';
            const closesAt = Math.floor((Date.now() + minutes * 60_000) / 1000);
            await interaction.channel.send({
              content: `<@${applicantId}>`,
              embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('Schließungsvorschlag')
                .setDescription(`${interaction.user} aus dem Team schlägt vor, diese Bewerbung zu schließen. Du kannst zustimmen oder ablehnen.\n\n**Grund:** ${reason}\nOhne Antwort wird die Bewerbung automatisch <t:${closesAt}:R> geschlossen.`)
                .setTimestamp()],
              components: [closeRequestComponents()],
              allowedMentions: { users: [applicantId] }
            });
            const timeout = setTimeout(async () => {
              if (interaction.channel.archived || interaction.channel.locked) return;
              try {
                await closeApplicationThread(interaction.channel, null, reason);
              } catch (error) {
                console.error('Bewerbung konnte nach Schließungsanfrage nicht automatisch geschlossen werden:', error.message);
              }
            }, minutes * 60_000);
            scheduledTicketClosures.set(interaction.channel.id, {
              timeout, closesAt, requesterTag: interaction.user.tag || interaction.user.username, reason
            });
            return interaction.reply({ content: `Die Schließungsanfrage wurde gesendet. Ohne Antwort wird die Bewerbung in ${minutes} Minuten geschlossen.`, ephemeral: true });
          }
          const reason = interaction.options.getString('grund') || 'Kein Grund angegeben.';
          await closeApplicationThread(interaction.channel, interaction.user, reason);
          return interaction.reply({ content: 'Die Bewerbung wurde geschlossen und archiviert.', ephemeral: true });
        } catch (error) {
          return interaction.reply({ content: `Bewerbung konnte nicht geschlossen werden: ${error.message}`, ephemeral: true });
        }
      }
      return interaction.reply({ content: 'Diesen Befehl kannst du nur in einem Ticket- oder Bewerbungs-Thread verwenden.', ephemeral: true });
    }
    const supportRoleId = await getTicketSupportRoleId(interaction.channel);
    if (subcommand === 'close') {
      if (ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen.', ephemeral: true });
      if (!isTicketTeam(interaction, supportRoleId)) {
        return interaction.reply({ content: 'Nur das Support-Team kann ein Ticket sofort schließen.', ephemeral: true });
      }
      try {
        const reason = interaction.options.getString('grund') || null;
        await closeTicket(interaction.channel, ticket, interaction.user, reason);
        return interaction.reply({ content: `${ticketNumberLabel(ticket)} wurde sofort geschlossen.`, ephemeral: true });
      } catch (error) {
        return interaction.reply({ content: `Ticket konnte nicht geschlossen werden: ${error.message}`, ephemeral: true });
      }
    }
    if (subcommand === 'close-anfrage') {
      if (ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen.', ephemeral: true });
      if (!isTicketTeam(interaction, supportRoleId)) {
        return interaction.reply({ content: 'Nur das Support-Team kann einen Schließungsvorschlag senden.', ephemeral: true });
      }
      const minutes = interaction.options.getInteger('minuten', true);
      const reason = interaction.options.getString('grund') || null;
      try {
        const requested = await requestTicketClose(interaction.channel, ticket, interaction.user, minutes, reason);
        return interaction.reply({ content: requested ? `Die Schließungsanfrage wurde gesendet. Ohne Antwort wird ${ticketNumberLabel(ticket)} in ${minutes} Minuten geschlossen.` : 'Für dieses Ticket gibt es bereits einen offenen Schließungsvorschlag.', ephemeral: true });
      } catch (error) {
        return interaction.reply({ content: `Schließungsvorschlag konnte nicht gesendet werden: ${error.message}`, ephemeral: true });
      }
    }
    if (!canManageTicket(interaction, ticket, supportRoleId)) {
      return interaction.reply({ content: 'Dafür musst du das Ticket erstellt haben oder zum Support-Team gehören.', ephemeral: true });
    }
    if (ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen.', ephemeral: true });

    try {
      if (subcommand === 'add') {
        const member = interaction.options.getMember('mitglied');
        if (!member || !('user' in member)) return interaction.reply({ content: 'Mitglied nicht gefunden.', ephemeral: true });
        await interaction.channel.members.add(member.id);
        return interaction.reply({ content: `${member} wurde zu diesem Ticket hinzugefügt.`, ephemeral: true });
      }
      if (subcommand === 'rename') {
        const name = interaction.options.getString('name', true);
        await interaction.channel.setName(ticketThreadName({ ticketId: ticket.ticketId, type: ticket.type, ownerId: ticket.ownerId, title: name }));
        return interaction.reply({ content: `Ticket wurde in **${name}** umbenannt.`, ephemeral: true });
      }
    } catch (error) {
      return interaction.reply({ content: `Ticket konnte nicht bearbeitet werden: ${error.message}`, ephemeral: true });
    }
  }
  if (interaction.commandName === 'stream-rollen') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Dafür brauchst du die Berechtigung „Server verwalten“.', ephemeral: true });
    }
    try {
      for (const streamer of streamers) await getOrCreateStreamRole(interaction.guild, streamer);
      await interaction.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0x9146FF)
          .setTitle('Streamer-Benachrichtigungen')
          .setDescription('Klicke auf einen Namen, um die entsprechende Ping-Rolle ein- oder auszuschalten. Du kannst mehrere auswählen.')],
        components: streamRoleButtons()
      });
      return interaction.reply({ content: 'Die auswählbaren Streamer-Rollen wurden eingerichtet.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Rollen konnten nicht eingerichtet werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'bewerber') {
    await interaction.channel.send({
      embeds: [new EmbedBuilder().setColor(0x5865F2)
        .setTitle('Bewerbung')
        .setDescription('Hier kannst du dich für verschiedene Rollen bewerben. Schau dir bitte vorab die Voraussetzungen für die jeweilige Rolle an. Wähle unten eine Rolle aus, um das Bewerbungsformular zu öffnen.')],
      components: [applicationButtons()]
    });
    return interaction.reply({ content: 'Das Bewerbungsmenü wurde in diesem Kanal veröffentlicht.', ephemeral: true });
  }

  if (!canModerate(interaction)) return interaction.reply({ content: 'Dafür fehlt dir die Berechtigung.', ephemeral: true });
  const member = interaction.options.getMember('mitglied');
  const reason = interaction.options.getString('grund') || `Moderation durch ${interaction.user.tag}`;
  if (!member || !('user' in member)) return interaction.reply({ content: 'Mitglied nicht gefunden.', ephemeral: true });

  try {
    if (interaction.commandName === 'ban') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers) || !member.bannable) throw new Error('Ich kann dieses Mitglied nicht bannen. Prüfe Rollenreihenfolge und Berechtigungen.');
      await member.ban({ reason, deleteMessageSeconds: 0 });
      await interaction.reply(`${member.user.tag} wurde gebannt.`);
      await logModeration(interaction.guild, 'Bann', [{ name: 'Mitglied', value: member.user.tag }, { name: 'Grund', value: reason }]);
    }
    if (interaction.commandName === 'timeout') {
      const minutes = interaction.options.getInteger('minuten', true);
      if (!member.moderatable) throw new Error('Ich kann dieses Mitglied nicht sperren. Prüfe Rollenreihenfolge und Berechtigungen.');
      await member.timeout(minutes * 60_000, reason);
      await interaction.reply(`${member.user.tag} hat jetzt ${minutes} Minuten Timeout.`);
      await logModeration(interaction.guild, 'Timeout', [{ name: 'Mitglied', value: member.user.tag }, { name: 'Grund', value: reason }]);
    }
    if (interaction.commandName === 'warn') {
      await interaction.reply(`${member.user.tag} wurde verwarnt.`);
      await logModeration(interaction.guild, 'Verwarnung', [{ name: 'Mitglied', value: member.user.tag }, { name: 'Grund', value: reason }]);
    }
  } catch (error) {
    await interaction.reply({ content: error.message || 'Moderation fehlgeschlagen.', ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
