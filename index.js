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
    .setName('ticket-setup')
    .setDescription('Erstellt ein Ticket-Auswahlmenü in diesem Kanal')
    .addChannelOption(option => option.setName('kategorie').setDescription('Kategorie, in der die Tickets erstellt werden').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption(option => option.setName('supportrolle').setDescription('Rolle, die Tickets bearbeiten darf'))
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

function ticketPanelComponents(categoryId, supportRoleId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ticket:create:${categoryId}:${supportRoleId || 'none'}`)
      .setPlaceholder('Wähle aus, wofür du ein Ticket brauchst')
      .addOptions(
        { label: 'Support', value: 'support', description: 'Frage oder Hilfe zum Server', emoji: '🎫' },
        { label: 'Meldung', value: 'meldung', description: 'Ein Problem oder Mitglied melden', emoji: '🛡️' },
        { label: 'Sonstiges', value: 'sonstiges', description: 'Anderes Anliegen', emoji: '💬' }
      )
  );
}

function ticketMetadata(ownerId, supportRoleId, state = 'open') {
  return `ticket-owner:${ownerId};support:${supportRoleId || 'none'};state:${state}`;
}

function parseTicketMetadata(topic) {
  const match = /^ticket-owner:(\d+);support:(\d+|none);state:(open|closed)$/.exec(topic || '');
  return match && { ownerId: match[1], supportRoleId: match[2], state: match[3] };
}

function ticketChannelName(user) {
  const safeName = user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 50);
  return `ticket-${safeName || user.id}`;
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
    const [, , categoryId, supportRoleId] = interaction.customId.split(':');
    const existing = interaction.guild.channels.cache.find(channel =>
      channel.parentId === categoryId && parseTicketMetadata(channel.topic)?.ownerId === interaction.user.id &&
      parseTicketMetadata(channel.topic)?.state === 'open'
    );
    if (existing) return interaction.reply({ content: `Du hast bereits ein offenes Ticket: ${existing}`, ephemeral: true });

    const supportRole = supportRoleId === 'none' ? null : interaction.guild.roles.cache.get(supportRoleId);
    const ticketType = interaction.values[0] || 'support';
    try {
      const overwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
      ];
      if (supportRole) overwrites.push({ id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      const ticket = await interaction.guild.channels.create({
        name: ticketChannelName(interaction.user),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: ticketMetadata(interaction.user.id, supportRole?.id),
        permissionOverwrites: overwrites,
        reason: `Ticket von ${interaction.user.tag}`
      });
      const typeLabels = { support: 'Support', meldung: 'Meldung', sonstiges: 'Sonstiges' };
      await ticket.send({
        content: `${interaction.user}${supportRole ? ` ${supportRole}` : ''}`,
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`${typeLabels[ticketType] || 'Support'}-Ticket`)
          .setDescription('Beschreibe dein Anliegen so genau wie möglich. Ein Teammitglied meldet sich hier.\n\nZum Abschließen klickst du auf den Button unten.')
          .setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:close').setLabel('Ticket schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger)
        )],
        allowedMentions: supportRole ? { roles: [supportRole.id], users: [interaction.user.id] } : { users: [interaction.user.id] }
      });
      return interaction.reply({ content: `Dein Ticket wurde erstellt: ${ticket}`, ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Ticket konnte nicht erstellt werden: ${error.message}`, ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId === 'ticket:close') {
    const metadata = parseTicketMetadata(interaction.channel?.topic);
    if (!metadata || metadata.state !== 'open') return interaction.reply({ content: 'Dieses Ticket ist bereits geschlossen oder ungültig.', ephemeral: true });
    const isSupport = metadata.supportRoleId !== 'none' && interaction.member.roles?.cache.has(metadata.supportRoleId);
    if (interaction.user.id !== metadata.ownerId && !isSupport && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: 'Nur die Person, die das Ticket erstellt hat, oder das Support-Team kann es schließen.', ephemeral: true });
    }
    try {
      await interaction.channel.permissionOverwrites.edit(metadata.ownerId, { SendMessages: false });
      await interaction.channel.setName(`geschlossen-${interaction.channel.name.replace(/^ticket-/, '').slice(0, 70)}`);
      await interaction.channel.setTopic(ticketMetadata(metadata.ownerId, metadata.supportRoleId, 'closed'));
      await interaction.channel.send('Dieses Ticket wurde geschlossen und bleibt für das Team zur Einsicht erhalten.');
      return interaction.reply({ content: 'Ticket geschlossen.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Ticket konnte nicht geschlossen werden: ${error.message}`, ephemeral: true });
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
  if (interaction.commandName === 'ticket-setup') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Dafür brauchst du die Berechtigung „Server verwalten“.', ephemeral: true });
    }
    const category = interaction.options.getChannel('kategorie', true);
    const supportRole = interaction.options.getRole('supportrolle');
    if (category.type !== ChannelType.GuildCategory) return interaction.reply({ content: 'Bitte wähle eine Kategorie aus.', ephemeral: true });
    try {
      await interaction.channel.send({
        embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Support-Tickets')
          .setDescription('Wähle unten ein Thema aus. Danach wird für dich ein privater Ticket-Kanal erstellt.')],
        components: [ticketPanelComponents(category.id, supportRole?.id)]
      });
      return interaction.reply({ content: 'Das Ticket-Auswahlmenü wurde erstellt.', ephemeral: true });
    } catch (error) {
      return interaction.reply({ content: `Ticket-Menü konnte nicht erstellt werden: ${error.message}`, ephemeral: true });
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
