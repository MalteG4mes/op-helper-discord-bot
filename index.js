require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, PermissionFlagsBits,
  EmbedBuilder, REST, Routes, SlashCommandBuilder
} = require('discord.js');

const required = ['DISCORD_TOKEN'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} fehlt in .env`);
}

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
  twitchStreamers: (process.env.TWITCH_STREAMERS || '')
    .split(',').map(name => name.trim()).filter(Boolean),
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
    .addStringOption(option => option.setName('grund').setDescription('Grund für die Verwarnung'))
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
      const thumbnail = live.thumbnail_url.replace('{width}', '1280').replace('{height}', '720');
      const embed = new EmbedBuilder()
        .setColor(0x9146FF)
        .setTitle(`${live.user_name} ist jetzt live!`)
        .setDescription(live.title || 'Schau im Stream vorbei!')
        .setURL(`https://www.twitch.tv/${live.user_login}`)
        .setImage(`${thumbnail}?t=${Date.now()}`)
        .addFields({ name: 'Kategorie', value: live.game_name || 'Ohne Kategorie', inline: true })
        .setTimestamp();
      await channel.send({ embeds: [embed] });
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
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
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
