require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the bank help page"),

  new SlashCommandBuilder()
    .setName("deposit")
    .setDescription("Create a deposit request")
    .addUserOption(option =>
      option.setName("user").setDescription("User receiving the deposit").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Deposit amount").setRequired(true).setMinValue(1)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the deposit").setRequired(true)
        .addChoices(
          { name: "Event", value: "event" },
          { name: "Milestone Reward", value: "milestone_reward" },
          { name: "Medal Reward", value: "medal_reward" },
          { name: "Promotion Reward", value: "promotion_reward" },
          { name: "Other", value: "other" },
        )
    )
    .addStringOption(option =>
      option.setName("other_reason").setDescription("Required only if reason is Other").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("fee")
    .setDescription("Charge a fee to a user")
    .addUserOption(option =>
      option.setName("user").setDescription("User to charge").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Fee amount").setRequired(true).setMinValue(1)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the fee").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("undofee")
    .setDescription("Reverse a fee by fee ID")
    .addStringOption(option =>
      option.setName("fee_id").setDescription("Fee ID to reverse").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for reversing the fee").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Request a withdrawal from your bank account")
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Amount to withdraw").setRequired(true).setMinValue(1)
    ),

  new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("View the top 10 bank account balances"),
  
  new SlashCommandBuilder()
  .setName("staffwithdraw")
  .setDescription("Withdraw funds from a user's account")
  .addUserOption(option =>
    option.setName("user").setDescription("User to withdraw from").setRequired(true)
  )
  .addIntegerOption(option =>
    option.setName("amount").setDescription("Amount to withdraw").setRequired(true).setMinValue(1)
  ),

  new SlashCommandBuilder()
  .setName("treasuryremove")
  .setDescription("Remove funds from the treasury")
  .addIntegerOption(option =>
    option.setName("amount").setDescription("Amount to remove").setRequired(true).setMinValue(1)
  ),

  new SlashCommandBuilder()
    .setName("create_bank_account")
    .setDescription("Create a bank account for a user")
    .addUserOption(option =>
      option.setName("user").setDescription("User to create an account for").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("close_account")
    .setDescription("Close a user's bank account")
    .addUserOption(option =>
      option.setName("user").setDescription("User whose account will be closed").setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName("tax25").setDescription("Apply 25% tax before deleting remaining funds").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("account")
    .setDescription("View account details and recent logs")
    .addUserOption(option =>
      option.setName("user").setDescription("User to view").setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName("page").setDescription("Page number").setRequired(false).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("View account balances")
    .addUserOption(option =>
      option.setName("user").setDescription("User to view").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("treasurydonate")
    .setDescription("Donate funds directly to the treasury")
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Amount to donate").setRequired(true).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("addpoints")
    .setDescription("Add points to a user")
    .addUserOption(option =>
      option.setName("user").setDescription("User to add points to").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Points to add").setRequired(true).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("removepoints")
    .setDescription("Remove points from a user")
    .addUserOption(option =>
      option.setName("user").setDescription("User to remove points from").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Points to remove").setRequired(true).setMinValue(1)
    ),

new SlashCommandBuilder()
  .setName("testweeklyreports")
  .setDescription("Test the weekly inactivity and clan reports"),

new SlashCommandBuilder()
  .setName("eventstart")
  .setDescription("Start an event session timer"),
  
  new SlashCommandBuilder()
    .setName("logevent")
    .setDescription("Log an event from a voice channel")
    .addChannelOption(option =>
      option.setName("voicechannel").setDescription("Voice channel used for the event").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("hosts").setDescription("Mention the host(s), separated by spaces").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("mvps").setDescription("Mention MVP(s), separated by spaces, or 'None'").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("points").setDescription("Normal attendee points").setRequired(true).setMinValue(0)
    )
    .addIntegerOption(option =>
      option.setName("mvp_points").setDescription("MVP points").setRequired(true).setMinValue(0)
    )
    .addStringOption(option =>
      option.setName("event_type").setDescription("Type of event").setRequired(true)
    )
    .addStringOption(option =>
  option.setName("notes").setDescription("Optional notes").setRequired(false)
)
.addAttachmentOption(option =>
  option.setName("screenshot").setDescription("Optional event screenshot").setRequired(false)
),
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

const CLIENT_ID = "1493705911930191872";
const GUILD_ID = "1492053089681674270";

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("Slash commands registered successfully.");
  } catch (error) {
    console.error(error);
  }
})();
