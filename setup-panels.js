require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const config = require("./config");
const { loadData, saveData } = require("./utils");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  try {
    console.log(`Connected as ${client.user.tag}`);
    const data = loadData();

    const createAccountChannel = await client.channels.fetch(config.channels.createAccount);
    const bankerCommandsChannel = await client.channels.fetch(config.channels.bankerCommands);
    const bankCommandsChannel = await client.channels.fetch(config.channels.bankCommands);

    if (createAccountChannel) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("🏦 Open a Consortium Bank Account")
        .setDescription(
          [
            "In order to earn deposits, you must have an active account with **The Consortium Bank**.",
            "",
            "Use the button below to begin your application.",
            "",
            "All applications are reviewed by **Consortium Sovereign** or **Consortium Bank Director**.",
            "Only **one active account** is allowed per user."
          ].join("\n")
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("start_bank_account_application")
          .setLabel("Start Bank Account Application")
          .setStyle(ButtonStyle.Primary)
      );

      const msg = await createAccountChannel.send({ embeds: [embed], components: [row] });
      data.setupMessages.createAccountPanel = msg.id;
    }

    if (bankerCommandsChannel) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("📜 Banker Commands")
        .setDescription(
          [
            "This channel is for **bank staff commands only**.",
            "",
            "**Allowed here:**",
            "`/help`",
            "`/deposit`",
            "`/fee`",
            "`/undofee`",
            "`/create_bank_account`",
            "`/close_account`",
            "`/treasurydonate`",
            "`/addpoints`",
            "`/removepoints`",
            "`/logevent`",
            "",
            "These commands will be blocked outside this channel."
          ].join("\n")
        );

      const msg = await bankerCommandsChannel.send({ embeds: [embed] });
      data.setupMessages.bankerCommandsPanel = msg.id;
    }

    if (bankCommandsChannel) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("🏧 Bank Commands")
        .setDescription(
          [
            "This channel is for **public banking commands**.",
            "",
            "**Use here:**",
            "`/help`",
            "`/balance`",
            "`/account`",
            "`/withdraw`",
            "",
            "These commands will be blocked outside this channel."
          ].join("\n")
        );

      const msg = await bankCommandsChannel.send({ embeds: [embed] });
      data.setupMessages.bankCommandsPanel = msg.id;
    }

    saveData(data);
    console.log("Setup panels created.");
  } catch (error) {
    console.error("Failed to create setup panels:", error);
  } finally {
    client.destroy();
  }
});

client.login(process.env.TOKEN);