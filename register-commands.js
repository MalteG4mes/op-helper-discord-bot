require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} fehlt in .env`);
}

const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt ein Mitglied.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option => option.setName('mitglied').setDescription('Zu bannendes Mitglied').setRequired(true))
    .addStringOption(option => option.setName('grund').setDescription('Grund für den Bann')),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Sperrt ein Mitglied zeitweise.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('mitglied').setDescription('Mitglied').setRequired(true))
    .addIntegerOption(option => option.setName('minuten').setDescription('Dauer (1–40320 Minuten)').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(option => option.setName('grund').setDescription('Grund')),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Erteilt eine Warnung und protokolliert sie.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option => option.setName('mitglied').setDescription('Mitglied').setRequired(true))
    .addStringOption(option => option.setName('grund').setDescription('Grund').setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands })
  .then(() => console.log('Slash-Befehle für den Testserver registriert.'))
  .catch(console.error);
