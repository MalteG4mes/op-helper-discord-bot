require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, PermissionFlagsBits,
  EmbedBuilder
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
  timeoutMinutes: Math.max(1, Math.min(Number(process.env.FILTER_TIMEOUT_MINUTES) || 60, 40320))
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

client.once(Events.ClientReady, readyClient => {
  console.log(`Angemeldet als ${readyClient.user.tag}`);
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
