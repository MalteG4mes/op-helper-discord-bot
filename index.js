require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, PermissionFlagsBits,
  EmbedBuilder, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  StringSelectMenuBuilder
} = require('discord.js');

const required = ['DISCORD_TOKEN'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} fehlt in .env`);
}

const streamers = [
  { login: 'misskowalski', displayName: 'MissKowalski' },
  { login: 'opphorx', displayName: 'Opphil' },
  { login: 'wuchitv', displayName: 'WuchiTV' },
  { login: 'ronjawolf2007', displayName: 'RonjaWolf2007' }
].map(streamer => ({ ...streamer, roleName: `Stream-Ping: ${streamer.displayName}` }));

const config = {
  welcomeChannelId: process.env.WELCOME_CHANNEL_ID,
  modLogChannelId: process.env.MOD_LOG_CHANNEL_ID,
  bannedTerms: (process.env.BANNED_TERMS || '')
    .split(',').map(term => term.trim().toLowerCase()).filter(Boolean),
  filterAction: process.env.FILTER_ACTION || 'delete',
  timeoutMinutes: Math.max(1, Math.min(Number(process.env.FILTER_TIMEOUT_MINUTES) || 60, 40320)),
  streamAlertChannelId: process.env.STREAM_ALERT_CHANNEL_ID,
  twitchClientId: process.env.TWITCH_CLIENT_ID,
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET,
  twitchStreamers: streamers.map(streamer => streamer.login),
  streamPollMinutes: Math.max(1, Math.min(Number(process.env.STREAM_POLL_MINUTES) || 5, 60))
};

if (!['delete', 'timeout', 'ban'].includes(config.filterAction)) {
  throw new Error('FILTER_ACTION muss delete, timeout oder ban sein.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
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
    .setName('ticket')
    .setDescription('Verwaltet Support-Tickets als private Threads')
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Erstellt das Ticket-Auswahlmenü in diesem Kanal')
      .addRoleOption(option => option.setName('supportrolle').setDescription('Rolle, die Tickets bearbeiten darf')))
    .addSubcommand(subcommand => subcommand
      .setName('close')
      .setDescription('Schließt das Ticket in diesem Thread'))
    .addSubcommand(subcommand => subcommand
      .setName('add')
      .setDescription('Fügt ein Mitglied zu diesem Ticket hinzu')
      .addUserOption(option => option.setName('mitglied').setDescription('Mitglied, das Zugriff erhalten soll').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('rename')
      .setDescription('Benennt dieses Ticket um')
      .addStringOption(option => option.setName('name').setDescription('Kurzer neuer Name für das Ticket').setRequired(true).setMaxLength(50)))
];

const streamerStatus = new Map();
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

function streamRoleButtons() {
  return new ActionRowBuilder().addComponents(
    streamers.map(streamer => new ButtonBuilder()
      .setCustomId(`stream-role:${streamer.login}`)
      .setLabel(streamer.displayName)
      .setStyle(ButtonStyle.Primary))
  );
}

const ticketTypes = {
  support: { label: 'Support', description: 'Frage oder Hilfe zum Server', emoji: '🎫' },
  feedback: { label: 'Feedback', description: 'Rückmeldung zum Server oder Bot', emoji: '💡' },
  wunsch: { label: 'Wunsch', description: 'Idee oder Wunsch einreichen', emoji: '✨' },
  meldung: { label: 'Meldung', description: 'Ein Problem oder Mitglied melden', emoji: '🛡️' },
  sonstiges: { label: 'Sonstiges', description: 'Anderes Anliegen', emoji: '💬' }
};

function ticketPanelComponents(ticketChannelId, supportRoleId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:create:${ticketChannelId}:${supportRoleId || 'none'}`)
      .setPlaceholder('Wähle aus, wofür du ein Ticket brauchst')
      .addOptions(Object.entries(ticketTypes).map(([value, type]) => ({ value, ...type })))
  );
}

function safeTicketText(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'anliegen';
}

function ticketThreadName({ state = 'offen', type, ownerId, title }) {
  const prefix = `ticket-${state}-${type}-`;
  const suffix = `-${ownerId}`;
  const available = 100 - prefix.length - suffix.length;
  return `${prefix}${safeTicketText(title).slice(0, Math.max(1, available))}${suffix}`;
}

function parseTicketThread(channel) {
  if (!channel?.isThread?.()) return null;
  const match = /^ticket-(offen|geschlossen)-(support|feedback|wunsch|meldung|sonstiges)-.+-(\d{17,20})$/.exec(channel.name);
  return match && { state: match[1], type: match[2], ownerId: match[3] };
}

function isTicketSupport(interaction, supportRoleId) {
  return supportRoleId && interaction.member.roles?.cache.has(supportRoleId);
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

async function getTicketSupportRoleId(thread) {
  const messages = await thread.messages.fetch({ limit: 20 });
  const openingMessage = messages.find(message =>
    message.author.id === client.user.id && message.components.some(row =>
      row.components.some(component => component.customId === 'ticket:close')));
  return openingMessage?.mentions.roles.first()?.id;
}

async function closeTicket(thread, ticket) {
  await thread.setName(ticketThreadName({
    state: 'geschlossen', type: ticket.type, ownerId: ticket.ownerId, title: thread.name
  }));
  await thread.send('🔒 Dieses Ticket ist **geschlossen** und wurde archiviert. Es bleibt für das Team zur Einsicht erhalten.');
  await thread.setLocked(true);
  await thread.setArchived(true);
}

function closeRequestComponents() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:approve-close').setLabel('Schließung bestätigen').setEmoji('✅').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:deny-close').setLabel('Ablehnen').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
  );
}

async function requestTicketClose(thread, requester, supportRoleId) {
  const recentMessages = await thread.messages.fetch({ limit: 30 });
  const alreadyRequested = recentMessages.some(message => message.components.some(row =>
    row.components.some(component => component.customId === 'ticket:approve-close')));
  if (alreadyRequested) return false;
  await thread.send({
    content: supportRoleId ? `<@&${supportRoleId}>` : undefined,
    embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('Schließungsantrag')
      .setDescription(`${requester} möchte dieses Ticket schließen. Das Support-Team entscheidet darüber.`)
      .setTimestamp()],
    components: [closeRequestComponents()],
    allowedMentions: supportRoleId ? { roles: [supportRoleId] } : { parse: [] }
  });
  return true;
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Angemeldet als ${readyClient.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands.map(command => command.toJSON()) });
    console.log('Slash-Befehle registriert. Discord kann bis zu einer Stunde brauchen, bis sie überall sichtbar sind.');
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

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot || !config.bannedTerms.length) return;
  // Teammitglieder werden nicht automatisch sanktioniert; ihre Nachrichten bleiben nachvollziehbar.
  if (message.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
  const matchedTerm = config.bannedTerms.find(term => message.content.toLowerCase().includes(term));
  if (!matchedTerm) return;

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
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.inGuild()) return;

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket:create:')) {
    const [, , ticketChannelId, supportRoleId = 'none'] = interaction.customId.split(':');
    const ticketChannel = await interaction.guild.channels.fetch(ticketChannelId).catch(() => null);
    if (!ticketChannel?.isTextBased() || !ticketChannel.threads) {
      return interaction.reply({ content: 'Der Ticket-Kanal wurde nicht gefunden.', ephemeral: true });
    }
    const ticketType = interaction.values[0] || 'support';
    if (!ticketTypes[ticketType]) return interaction.reply({ content: 'Diese Ticket-Art gibt es nicht.', ephemeral: true });
    try {
      const activeThreads = await ticketChannel.threads.fetchActive();
      const existing = activeThreads.threads.find(thread => {
        const details = parseTicketThread(thread);
        return details?.ownerId === interaction.user.id && details.state === 'offen';
      });
      if (existing) return interaction.reply({ content: `Du hast bereits ein offenes Ticket: <#${existing.id}>`, ephemeral: true });

      const ticket = await ticketChannel.threads.create({
        name: ticketThreadName({ type: ticketType, ownerId: interaction.user.id, title: interaction.user.username }),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
        reason: `${ticketTypes[ticketType].label}-Ticket von ${interaction.user.tag}`
      });
      await ticket.members.add(interaction.user.id);
      if (supportRoleId !== 'none') await addSupportMembers(ticket, interaction.guild, supportRoleId);
      await ticket.send({
        content: `${interaction.user}${supportRoleId !== 'none' ? ` <@&${supportRoleId}>` : ''}`,
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${ticketTypes[ticketType].label}-Ticket`)
          .setDescription('Beschreibe dein Anliegen so genau wie möglich. Ein Teammitglied meldet sich hier.\n\nMit `/ticket close` oder dem Button unten stellst du einen Schließungsantrag. Das Support-Team bestätigt ihn.')
          .setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:close').setLabel('Schließung beantragen').setEmoji('🔒').setStyle(ButtonStyle.Primary)
        )],
        allowedMentions: supportRoleId !== 'none'
          ? { roles: [supportRoleId], users: [interaction.user.id] }
          : { users: [interaction.user.id] }
      });
      return interaction.reply({ content: `Dein privates Ticket wurde als Thread erstellt: <#${ticket.id}>`, ephemeral: true });
    } catch (error) {
      console.error('Ticket konnte nicht erstellt werden:', error);
      return interaction.reply({ content: `Ticket konnte nicht erstellt werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId === 'ticket:close') {
    const ticket = parseTicketThread(interaction.channel);
    if (!ticket || ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen oder ungültig.', ephemeral: true });
    const supportRoleId = interaction.message.mentions.roles.first()?.id;
    if (interaction.user.id !== ticket.ownerId) {
      return interaction.reply({ content: 'Nur die Person, die das Ticket erstellt hat, kann einen Schließungsantrag stellen.', ephemeral: true });
    }
    try {
      const requested = await requestTicketClose(interaction.channel, interaction.user, supportRoleId);
      return interaction.reply({ content: requested ? 'Dein Schließungsantrag wurde an das Support-Team gesendet.' : 'Für dieses Ticket gibt es bereits einen offenen Schließungsantrag.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Schließungsantrag konnte nicht gesendet werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && ['ticket:approve-close', 'ticket:deny-close'].includes(interaction.customId)) {
    const ticket = parseTicketThread(interaction.channel);
    if (!ticket || ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen oder ungültig.', ephemeral: true });
    const supportRoleId = await getTicketSupportRoleId(interaction.channel);
    const isSupport = isTicketSupport(interaction, supportRoleId) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageThreads) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
    if (!isSupport) return interaction.reply({ content: 'Nur das Support-Team darf einen Schließungsantrag bearbeiten.', ephemeral: true });
    if (interaction.customId === 'ticket:deny-close') {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Schließungsantrag abgelehnt')
          .setDescription(`${interaction.user} hat den Schließungsantrag abgelehnt. Das Ticket bleibt offen.`).setTimestamp()],
        components: []
      });
    }
    try {
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('Schließungsantrag bestätigt')
          .setDescription(`${interaction.user} hat den Antrag bestätigt. Das Ticket wird archiviert.`).setTimestamp()],
        components: []
      });
      await closeTicket(interaction.channel, ticket);
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
      try {
        await interaction.channel.send({
          embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Tickets')
            .setDescription('Wähle unten dein Thema aus. Danach wird für dich ein **privater Thread** in diesem Kanal erstellt.')],
          components: [ticketPanelComponents(interaction.channel.id, supportRole?.id)]
        });
        return interaction.reply({ content: 'Das Ticket-Auswahlmenü wurde erstellt.', ephemeral: true });
      } catch (error) {
        return interaction.reply({ content: `Ticket-Menü konnte nicht erstellt werden: ${error.message}`, ephemeral: true });
      }
    }

    if (!ticket) return interaction.reply({ content: 'Diesen Befehl kannst du nur in einem Ticket-Thread verwenden.', ephemeral: true });
    const supportRoleId = await getTicketSupportRoleId(interaction.channel);
    if (!canManageTicket(interaction, ticket, supportRoleId)) {
      return interaction.reply({ content: 'Dafür musst du das Ticket erstellt haben oder zum Support-Team gehören.', ephemeral: true });
    }
    if (ticket.state !== 'offen') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen.', ephemeral: true });

    try {
      if (subcommand === 'close') {
        if (interaction.user.id === ticket.ownerId) {
          const requested = await requestTicketClose(interaction.channel, interaction.user, supportRoleId);
          return interaction.reply({ content: requested ? 'Dein Schließungsantrag wurde an das Support-Team gesendet.' : 'Für dieses Ticket gibt es bereits einen offenen Schließungsantrag.', ephemeral: true });
        }
        await closeTicket(interaction.channel, ticket);
        return interaction.reply({ content: 'Schließungsantrag bestätigt: Ticket geschlossen und archiviert.', ephemeral: true });
      }
      if (subcommand === 'add') {
        const member = interaction.options.getMember('mitglied');
        if (!member || !('user' in member)) return interaction.reply({ content: 'Mitglied nicht gefunden.', ephemeral: true });
        await interaction.channel.members.add(member.id);
        return interaction.reply({ content: `${member} wurde zu diesem Ticket hinzugefügt.`, ephemeral: true });
      }
      if (subcommand === 'rename') {
        const name = interaction.options.getString('name', true);
        await interaction.channel.setName(ticketThreadName({ type: ticket.type, ownerId: ticket.ownerId, title: name }));
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
        components: [streamRoleButtons()]
      });
      return interaction.reply({ content: 'Die auswählbaren Streamer-Rollen wurden eingerichtet.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Rollen konnten nicht eingerichtet werden: ${error.message}`, ephemeral: true });
    }
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
