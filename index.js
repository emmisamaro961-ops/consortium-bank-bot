require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");

const config = require("./config");
const {
  nowIso,
  generateId,
  getMemberRoleState,
  isHighAuthority,
  isBankStaff,
  canUseEventCommands,
  assertChannel,
  staffCommandNames,
  publicCommandNames,
  getOrCreateAccount,
  hasActiveAccount,
  getOrCreatePoints,
  addTransactionToAccount,
  addDepositRecord,
  addPointsHistory,
  updateTreasury,
  formatMoney,
  formatDate,
  getMonthlyWithdrawn,
  addMonthlyWithdrawn,
  daysBetween,
  hasDepositCooldown,
  getDepositCooldownRemaining,
  setDepositCooldown,
  buildErrorEmbed,
  buildSuccessEmbed,
  buildInfoEmbed,
  getAccountSummary,
  chunkArray,
} = require("./utils");

const { initDatabase, loadData, saveData } = require("./database");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

let data = loadData();

function reloadData() {
  data = loadData();
}

function persist() {
  saveData(data);
}

function getGuildRoleMention(roleId) {
  return `<@&${roleId}>`;
}

function parseMentions(text) {
  if (!text || typeof text !== "string") return [];
  const matches = [...text.matchAll(/<@!?(\d+)>/g)];
  return [...new Set(matches.map(m => m[1]))];
}

function reasonLabel(reason, otherReason = null) {
  switch (reason) {
    case "event":
      return "Event";
    case "milestone_reward":
      return "Milestone Reward";
    case "medal_reward":
      return "Medal Reward";
    case "promotion_reward":
      return "Promotion Reward";
    case "other":
      return otherReason?.trim() ? `Other — ${otherReason.trim()}` : "Other";
    default:
      return reason || "Unknown";
  }
}

function makePublicDepositText(userMention, grossAmount, treasuryTax, reason, otherReason) {
  switch (reason) {
    case "event":
      return `${userMention} completed an event and earned ${formatMoney(grossAmount)}, adding ${formatMoney(treasuryTax)} to the Treasury.`;
    case "milestone_reward":
      return `${userMention} completed a milestone and earned ${formatMoney(grossAmount)}, adding ${formatMoney(treasuryTax)} to the Treasury.`;
    case "medal_reward":
      return `${userMention} got a medal and earned ${formatMoney(grossAmount)}, adding ${formatMoney(treasuryTax)} to the Treasury.`;
    case "promotion_reward":
      return `${userMention} got a promotion and earned ${formatMoney(grossAmount)}, adding ${formatMoney(treasuryTax)} to the Treasury.`;
    case "other":
    default:
      return `${userMention} earned ${formatMoney(grossAmount)}, adding ${formatMoney(treasuryTax)} to the Treasury.${otherReason ? ` Reason: ${otherReason}` : ""}`;
  }
}

function depositNeedsHighAuthority(tx, approverMember) {
  const roleState = getMemberRoleState(approverMember);
  const isHigh = roleState.isSovereign || roleState.isDirector;
  if (isHigh) return false;

  if (tx.amount > config.economy.bankerAutoApprovalMax) return true;
  if (tx.requiresHighAuthority) return true;
  return false;
}

function bankerCanApproveTx(tx, approverMember) {
  const roles = getMemberRoleState(approverMember);

  if (roles.isSovereign || roles.isDirector) {
    return { ok: true };
  }

  if (!roles.isBanker) {
    return { ok: false, message: "You are not allowed to approve banking transactions." };
  }

  if (tx.createdBy === approverMember.id) {
    return { ok: false, message: "You cannot approve your own deposit." };
  }

  if (tx.amount > config.economy.bankerAutoApprovalMax) {
    return {
      ok: false,
      message: "You are not authorized to approve deposits above $30. Only the Consortium Sovereign or Bank Director can approve this transaction.",
    };
  }

  if (tx.requiresHighAuthority) {
    return {
      ok: false,
      message: "This transaction requires approval from the Consortium Sovereign or Bank Director.",
    };
  }

  return { ok: true };
}

async function sendTreasuryEmbed(description, color = config.colors.treasury) {
  const channel = await client.channels.fetch(config.channels.treasury).catch(() => null);
  if (!channel) return null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("💰 The Consortium Treasury")
    .setDescription(description)
    .setTimestamp();

  return channel.send({ embeds: [embed] });
}

async function sendTransactionsLog(embed) {
  const channel = await client.channels.fetch(config.channels.transactionsLogs).catch(() => null);
  if (!channel) return null;
  return channel.send({ embeds: [embed] });
}

async function sendConsortiumBankEmbed(embed) {
  const channel = await client.channels.fetch(config.channels.consortiumBank).catch(() => null);
  if (!channel) return null;
  return channel.send({ embeds: [embed] });
}

async function sendPointsRegistrarMessage(content) {
  const channel = await client.channels.fetch("1493860433923407953").catch(() => null);
  // Fallback: user did not give ID for points-registrar in this turn. Since they said it exists but did not provide ID,
  // we intentionally avoid sending rather than guessing.
  if (!channel) return null;
  return channel.send({ content });
}

async function tryFindPointsRegistrarChannel() {
  const guilds = [...client.guilds.cache.values()];
  for (const guild of guilds) {
    const found = guild.channels.cache.find(ch => ch.name === "⬆️┆points-registrar" || ch.name === "points-registrar");
    if (found) return found;
  }
  return null;
}

async function sendPointsRegistrar(content) {
  let channel = await tryFindPointsRegistrarChannel();
  if (!channel) return null;
  return channel.send({ content });
}

async function sendEventLoggingTask(task) {
  const channel = await client.channels.fetch(config.channels.eventLogging).catch(() => null);
  if (!channel) return null;

  const embed = new EmbedBuilder()
    .setColor(config.colors.deposit)
    .setTitle("📅 Event Deposit Required")
    .setDescription(`${task.userMention} completed an event and needs a ${formatMoney(task.amount)} deposit.`)
    .addFields(
      { name: "Event ID", value: task.eventId, inline: true },
      { name: "Task ID", value: task.taskId, inline: true },
      { name: "Status", value: task.status, inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`eventdeposit_complete_${task.taskId}`)
      .setLabel("Deposit Completed")
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  return msg;
}

async function syncPendingMirrorMessage(tx, newContent, disableButtons = false) {
  const ids = [tx.pendingMessageId, tx.staffMessageId].filter(Boolean);
  const channelPairs = [
    { channelId: config.channels.pendingTransactions, messageId: tx.pendingMessageId },
    { channelId: config.channels.staffTransactions, messageId: tx.staffMessageId },
  ];

  for (const pair of channelPairs) {
    if (!pair.messageId) continue;

    const channel = await client.channels.fetch(pair.channelId).catch(() => null);
    if (!channel) continue;

    const msg = await channel.messages.fetch(pair.messageId).catch(() => null);
    if (!msg) continue;

    const existingEmbed = msg.embeds?.[0];
    const embed = existingEmbed
      ? EmbedBuilder.from(existingEmbed).setFooter({ text: newContent })
      : new EmbedBuilder().setColor(config.colors.info).setDescription(newContent);

    let components = msg.components;
    if (disableButtons) {
      components = msg.components.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(c => ButtonBuilder.from(c).setDisabled(true));
        return newRow;
      });
    }

    await msg.edit({ embeds: [embed], components }).catch(() => null);
  }
}

function createPendingDepositObject({
  userId,
  createdBy,
  amount,
  reason,
  otherReason,
  issuerRoleType,
  source = "manual",
  sourceRef = null,
  notes = null,
}) {
  const txId = generateId("DEP");
  const isSelfDeposit = userId === createdBy;
  const requiresHighAuthority = amount > config.economy.bankerAutoApprovalMax || isSelfDeposit;

  data.pendingDeposits[txId] = {
    txId,
    userId,
    createdBy,
    amount,
    reason,
    otherReason: otherReason || null,
    issuerRoleType,
    source,
    sourceRef,
    notes,
    status: "pending",
    requiresHighAuthority,
    isUpper: amount > config.economy.bankerAutoApprovalMax,
    isSelfDeposit,
    createdAt: nowIso(),
    approvedAt: null,
    approvedBy: null,
    pendingMessageId: null,
    staffMessageId: null,
  };

  persist();
  return data.pendingDeposits[txId];
}

async function postPendingDeposit(tx, guild) {
  const targetUser = await client.users.fetch(tx.userId).catch(() => null);
  const creatorUser = await client.users.fetch(tx.createdBy).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(config.colors.neutral)
    .setTitle("⏳ Pending Deposit Approval")
    .addFields(
      { name: "Transaction ID", value: tx.txId, inline: true },
      { name: "User", value: targetUser ? `${targetUser}` : `<@${tx.userId}>`, inline: true },
      { name: "Amount", value: formatMoney(tx.amount), inline: true },
      { name: "Reason", value: reasonLabel(tx.reason, tx.otherReason), inline: false },
      { name: "Requested By", value: creatorUser ? `${creatorUser}` : `<@${tx.createdBy}>`, inline: true },
      { name: "Type", value: tx.isUpper ? "Upper Deposit" : (tx.isSelfDeposit ? "Staff Deposit" : "Normal Deposit"), inline: true },
      { name: "Approval Rule", value: tx.requiresHighAuthority ? "High Authority Required" : "Banker Approval Allowed", inline: true }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_deposit_${tx.txId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`deny_deposit_${tx.txId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
  );

  const pendingChannel = await guild.channels.fetch(config.channels.pendingTransactions).catch(() => null);
  if (pendingChannel) {
    const msg = await pendingChannel.send({ embeds: [embed], components: [row] });
    tx.pendingMessageId = msg.id;
  }

  if (tx.isUpper) {
    const staffChannel = await guild.channels.fetch(config.channels.staffTransactions).catch(() => null);
    if (staffChannel) {
      const msg = await staffChannel.send({ embeds: [embed], components: [row] });
      tx.staffMessageId = msg.id;
    }
  }

  persist();
}

async function approveDeposit(tx, approver, guild) {
  const account = getOrCreateAccount(data, tx.userId);
  if (account.status !== "active") {
    throw new Error("This user does not have an active bank account.");
  }

  const recipientAmount = Math.floor(tx.amount * config.economy.depositRecipientRate);
  const approverRoles = getMemberRoleState(approver.member);

  let treasuryAmount = 0;
  let bankerCut = 0;

  if (approverRoles.isBanker && !approverRoles.isDirector && !approverRoles.isSovereign) {
    treasuryAmount = Math.floor(tx.amount * config.economy.depositTreasuryRateBanker);
    bankerCut = tx.amount - recipientAmount - treasuryAmount;
  } else {
    treasuryAmount = tx.amount - recipientAmount;
  }

  account.balance += recipientAmount;
  account.pendingApprovalBalance = Math.max(0, Number(account.pendingApprovalBalance || 0) - tx.amount);

  addTransactionToAccount(account, {
    id: tx.txId,
    type: "deposit",
    grossAmount: tx.amount,
    creditedAmount: recipientAmount,
    treasuryAmount,
    bankerCut,
    reason: tx.reason,
    otherReason: tx.otherReason,
    source: tx.source,
    sourceRef: tx.sourceRef,
    by: tx.createdBy,
    approvedBy: approver.user.id,
    createdAt: tx.createdAt,
    approvedAt: nowIso(),
  });

  addDepositRecord(account, {
    id: tx.txId,
    grossAmount: tx.amount,
    creditedAmount: recipientAmount,
    unlockAt: new Date(Date.now() + config.economy.depositUnlockDays * 24 * 60 * 60 * 1000).toISOString(),
    approvedAt: nowIso(),
    source: tx.source,
    sourceRef: tx.sourceRef,
  });

  const treasuryUpdate = updateTreasury(data, treasuryAmount, {
    reason: "deposit_tax",
    txId: tx.txId,
  });

  if (bankerCut > 0) {
    const bankerAccount = getOrCreateAccount(data, tx.createdBy);
    if (bankerAccount.status === "active") {
      bankerAccount.balance += bankerCut;

      addTransactionToAccount(bankerAccount, {
        id: `${tx.txId}-BANKERCUT`,
        type: "banker_cut",
        grossAmount: bankerCut,
        creditedAmount: bankerCut,
        by: tx.createdBy,
        approvedBy: approver.user.id,
        createdAt: tx.createdAt,
        approvedAt: nowIso(),
        source: "deposit_cut",
        sourceRef: tx.txId,
      });

      addDepositRecord(bankerAccount, {
        id: `${tx.txId}-BANKERCUT`,
        grossAmount: bankerCut,
        creditedAmount: bankerCut,
        unlockAt: new Date(Date.now() + config.economy.depositUnlockDays * 24 * 60 * 60 * 1000).toISOString(),
        approvedAt: nowIso(),
        source: "deposit_cut",
        sourceRef: tx.txId,
      });
    }
  }

  tx.status = "approved";
  tx.approvedBy = approver.user.id;
  tx.approvedAt = nowIso();

  persist();

  await sendTreasuryEmbed(
    `${formatMoney(treasuryAmount)} was added to The Consortium Treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`
  );

  const internalEmbed = new EmbedBuilder()
    .setColor(config.colors.deposit)
    .setTitle("🧾 Deposit Approved")
    .addFields(
      { name: "Transaction ID", value: tx.txId, inline: true },
      { name: "User", value: `<@${tx.userId}>`, inline: true },
      { name: "Gross Amount", value: formatMoney(tx.amount), inline: true },
      { name: "User Received", value: formatMoney(recipientAmount), inline: true },
      { name: "Treasury Received", value: formatMoney(treasuryAmount), inline: true },
      { name: "Banker Cut", value: formatMoney(bankerCut), inline: true },
      { name: "Approved By", value: `${approver.user}`, inline: true },
      { name: "Reason", value: reasonLabel(tx.reason, tx.otherReason), inline: true },
      { name: "Source", value: tx.source, inline: true }
    )
    .setTimestamp();

  await sendTransactionsLog(internalEmbed);

  const publicEmbed = new EmbedBuilder()
    .setColor(config.colors.deposit)
    .setDescription(makePublicDepositText(`<@${tx.userId}>`, tx.amount, treasuryAmount, tx.reason, tx.otherReason))
    .setTimestamp();

  await sendConsortiumBankEmbed(publicEmbed);

  await syncPendingMirrorMessage(tx, `Approved by ${approver.user.tag}`, true);
}

async function denyDeposit(tx, approver) {
  const account = getOrCreateAccount(data, tx.userId);
  account.pendingApprovalBalance = Math.max(0, Number(account.pendingApprovalBalance || 0) - tx.amount);

  tx.status = "denied";
  tx.approvedBy = approver.user.id;
  tx.approvedAt = nowIso();

  persist();

  await syncPendingMirrorMessage(tx, `Denied by ${approver.user.tag}`, true);

  const embed = new EmbedBuilder()
    .setColor(config.colors.error)
    .setTitle("🧾 Deposit Denied")
    .addFields(
      { name: "Transaction ID", value: tx.txId, inline: true },
      { name: "User", value: `<@${tx.userId}>`, inline: true },
      { name: "Amount", value: formatMoney(tx.amount), inline: true },
      { name: "Denied By", value: `${approver.user}`, inline: true }
    )
    .setTimestamp();

  await sendTransactionsLog(embed);
}

async function openAccountForUser(targetUserId, openedByUserId, publicLog = true) {
  const account = getOrCreateAccount(data, targetUserId);

  if (account.status === "active") {
    return { ok: false, message: "That user already has an active bank account." };
  }

  account.status = "active";
  account.createdAt = nowIso();
  account.closedAt = null;
  account.closedReason = null;
  account.balance = 0;
  account.withdrawableBalance = 0;
  account.pendingApprovalBalance = 0;
  account.transactions = [];
  account.deposits = [];
  account.monthlyWithdrawals = {};
  account.boostRewards = [];

  addTransactionToAccount(account, {
    id: generateId("ACCOPEN"),
    type: "account_opened",
    by: openedByUserId,
    createdAt: nowIso(),
  });

  persist();

  if (publicLog) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.deposit)
      .setDescription(`<@${targetUserId}> opened a Consortium Bank account and can now earn deposit rewards!`)
      .setTimestamp();

    await sendConsortiumBankEmbed(embed);
  }

  await tryClaimPendingBoost(targetUserId);

  return { ok: true };
}

async function closeAccountForUser(targetUserId, closedByUserId, tax25, reason = "manual_close", announce = true) {
  const account = getOrCreateAccount(data, targetUserId);
  if (account.status !== "active") {
    return { ok: false, message: "This user does not have an active bank account." };
  }

  const originalBalance = Number(account.balance || 0);
  let taxedAmount = 0;

  if (tax25 && originalBalance > 0) {
    taxedAmount = Math.floor(originalBalance * 0.25);
    updateTreasury(data, taxedAmount, { reason: "account_closure_tax", userId: targetUserId });
    await sendTreasuryEmbed(
      `${formatMoney(taxedAmount)} was added to The Consortium Treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`
    );
  }

  account.status = "closed";
  account.closedAt = nowIso();
  account.closedReason = reason;
  account.balance = 0;
  account.withdrawableBalance = 0;
  account.pendingApprovalBalance = 0;
  account.deposits = [];

  addTransactionToAccount(account, {
    id: generateId("ACCCLOSE"),
    type: "account_closed",
    by: closedByUserId,
    taxApplied: tax25,
    taxedAmount,
    originalBalance,
    createdAt: nowIso(),
  });

  persist();

  if (announce) {
    const embed = new EmbedBuilder()
      .setColor(config.colors.error)
      .setTitle("🧾 Account Closed")
      .addFields(
        { name: "User", value: `<@${targetUserId}>`, inline: true },
        { name: "Tax Applied", value: tax25 ? "Yes" : "No", inline: true },
        { name: "Tax Sent To Treasury", value: formatMoney(taxedAmount), inline: true }
      )
      .setTimestamp();

    await sendTransactionsLog(embed);
  }

  return { ok: true, taxedAmount };
}

function buildHelpEmbedForMember(interaction) {
  const roles = getMemberRoleState(interaction.member);
  const isStaff = roles.isBanker || roles.isDirector || roles.isSovereign;

  if (isStaff) {
    return new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle("📜 Banker Help")
      .setDescription(
        [
          `Use banker commands in <#${config.channels.bankerCommands}>`,
          "",
          "**Bank Staff Commands**",
          "`/deposit` - create a deposit request",
          "`/fee` - charge a fee",
          "`/undofee` - reverse a fee",
          "`/create_bank_account` - open an account",
          "`/close_account` - close an account",
          "`/addpoints` - add points",
          "`/removepoints` - remove points",
          "`/logevent` - log an event",
          "",
          "**Notes**",
          "- All deposits require approval.",
          "- Deposits above $30 require Sovereign or Director approval.",
          "- Bankers cannot approve their own deposits.",
        ].join("\n")
      );
  }

  return new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle("🏧 Consortium Bank Help")
    .setDescription(
      [
  `Use public bank commands in <#${config.channels.bankCommands}>`,
  "",
  "**Member Commands**",
  "`/balance` - view your account balance",
  "`/account` - view your account details",
  "`/withdraw` - check if you meet withdrawal requirements",
  "",
  "**Withdrawal Rules**",
  "- Active bank account required",
  "- Balance must be above $100",
  "- Account must be 30 days old",
  "- Enough withdrawable balance required",
  "- Monthly withdrawal limit is $250",
].join("\n")
    );
}

async function tryClaimPendingBoost(userId) {
  const pending = data.pendingBoosts[userId];
  if (!pending) return;

  const expires = new Date(pending.expiresAt).getTime();
  if (Date.now() > expires) {
    delete data.pendingBoosts[userId];
    persist();
    return;
  }

  if (!hasActiveAccount(data, userId)) return;

  const account = getOrCreateAccount(data, userId);
  account.balance += config.economy.boostRewardUser;
  account.boostRewards.push({
    amount: config.economy.boostRewardUser,
    treasuryAmount: config.economy.boostRewardTreasury,
    grantedAt: nowIso(),
    expiresAt: pending.expiresAt,
    reversibleUntil: pending.expiresAt,
    source: "pending_boost_claim",
  });

  addTransactionToAccount(account, {
    id: generateId("BOOST"),
    type: "boost_reward",
    grossAmount: config.economy.boostRewardUser,
    createdAt: nowIso(),
    source: "boost",
  });

  updateTreasury(data, config.economy.boostRewardTreasury, { reason: "boost_reward", userId });

  persist();

  await sendTreasuryEmbed(
    `<@${userId}> Boosted the server, adding ${formatMoney(config.economy.boostRewardTreasury)} to The Consortium Treasury!\nNew Treasury Balance: ${formatMoney(data.treasury)}\nThank you for boosting! <@${userId}>`,
    config.colors.boost
  );

  const boostEmbed = new EmbedBuilder()
    .setColor(config.colors.boost)
    .setDescription(`<@${userId}> boosted the server and claimed a boost reward of ${formatMoney(config.economy.boostRewardUser)}. Thank you for boosting! <@${userId}>`)
    .setTimestamp();

  await sendConsortiumBankEmbed(boostEmbed);

  const internal = new EmbedBuilder()
    .setColor(config.colors.boost)
    .setTitle("🧾 Boost Reward Claimed")
    .setDescription(`<@${userId}> claimed their pending boost reward.`)
    .setTimestamp();

  await sendTransactionsLog(internal);

  delete data.pendingBoosts[userId];
  persist();
}

function updateWithdrawableDepositsForAccount(account) {
  const now = Date.now();
  let updated = false;

  for (const deposit of account.deposits || []) {
    if (!deposit.movedToWithdrawable && deposit.unlockAt && new Date(deposit.unlockAt).getTime() <= now) {
      account.withdrawableBalance += Number(deposit.creditedAmount || 0);
      deposit.movedToWithdrawable = true;
      updated = true;
    }
  }

  return updated;
}

function getWithdrawalEligibility(account, requestedAmount) {
  const issues = [];
  const accountAgeDays = daysBetween(account.createdAt);

  if (account.status !== "active") {
    issues.push("You do not have an active bank account.");
  }

  if (Number(account.balance || 0) <= config.economy.withdrawMinAccountBalance) {
    issues.push(`You must have an account balance above ${formatMoney(config.economy.withdrawMinAccountBalance)}.`);
  }

  if (accountAgeDays < config.economy.withdrawMinAccountAgeDays) {
    issues.push(`You have not yet met the ${config.economy.withdrawMinAccountAgeDays} day account holding period.`);
  }

  if (Number(account.withdrawableBalance || 0) < requestedAmount) {
    issues.push(`You do not have enough withdrawable balance for ${formatMoney(requestedAmount)}.`);
  }

  const withdrawnThisMonth = getMonthlyWithdrawn(account);
  const remaining = config.economy.withdrawMonthlyLimit - withdrawnThisMonth;
  if (requestedAmount > remaining) {
    issues.push(`You can only withdraw ${formatMoney(Math.max(0, remaining))} more this month.`);
  }

  return issues;
}

async function logPointsChange(userId, amount, actorId, reasonText, isMvp = false) {
  const points = getOrCreatePoints(data, userId);
  points.total += amount;
  if (reasonText.includes("event")) {
    points.eventsAttended += amount >= 0 ? 1 : -1;
    if (points.eventsAttended < 0) points.eventsAttended = 0;
  }

  addPointsHistory(points, {
    id: generateId("PTS"),
    amount,
    actorId,
    reason: reasonText,
    createdAt: nowIso(),
  });

  persist();

  const userMention = `<@${userId}>`;
  const actorMention = actorId ? `<@${actorId}>` : null;

  let message;
  if (reasonText === "manual_add") {
    message = `${actorMention} added ${amount} points to ${userMention}, they now have a total of ${points.total} points.`;
  } else if (reasonText === "manual_remove") {
    message = `${actorMention} removed ${Math.abs(amount)} points from ${userMention}, they now have a total of ${points.total} points.`;
  } else if (reasonText === "event_add") {
    message = isMvp
      ? `${userMention} was an event MVP and gained ${amount} points and now has a total of ${points.total} points. Events attended: ${points.eventsAttended}`
      : `${userMention} gained ${amount} points and now has a total of ${points.total} points. Events attended: ${points.eventsAttended}`;
  } else if (reasonText === "event_remove") {
    message = `${userMention} was removed from an event log and lost ${Math.abs(amount)} points. They now have a total of ${points.total} points. Events attended: ${points.eventsAttended}`;
  }

  if (message) {
    await sendPointsRegistrar(message);
  }
}

async function createEventLog(interaction) {
  const voiceChannel = interaction.options.getChannel("voicechannel", true);
  if (
    voiceChannel.type !== ChannelType.GuildVoice &&
    voiceChannel.type !== ChannelType.GuildStageVoice
  ) {
    throw new Error("The selected channel must be a voice channel.");
  }

  const hostsInput = interaction.options.getString("hosts", true);
  const mvpsInput = interaction.options.getString("mvps", true);
  const points = interaction.options.getInteger("points", true);
  const mvpPoints = interaction.options.getInteger("mvp_points", true);
  const eventType = interaction.options.getString("event_type", true);
  const notes = interaction.options.getString("notes") || "None";

  const eventId = generateId("EVT");
  const attendeeIds = [...voiceChannel.members.keys()];
  const hostIds = parseMentions(hostsInput);
  const mvpIds = mvpsInput.toLowerCase() === "none" ? [] : parseMentions(mvpsInput);

  data.events[eventId] = {
    id: eventId,
    voiceChannelId: voiceChannel.id,
    hostIds,
    mvpIds,
    attendeeIds,
    points,
    mvpPoints,
    eventType,
    notes,
    createdBy: interaction.user.id,
    createdAt: nowIso(),
    loggingCampMessageId: null,
    status: "active",
  };

  persist();

  const loggingCamp = await client.channels.fetch(config.channels.loggingCamp).catch(() => null);
  if (!loggingCamp) {
    throw new Error("Logging camp channel is unavailable.");
  }

  const attendeeText = attendeeIds.length ? attendeeIds.map(id => `<@${id}>`).join(", ") : "None";
  const mvpText = mvpIds.length ? mvpIds.map(id => `<@${id}>`).join(", ") : "None";
  const hostText = hostIds.length ? hostIds.map(id => `<@${id}>`).join(", ") : "None";

  const embed = new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle(`📣 ${eventType}`)
    .addFields(
      { name: "Event ID", value: eventId, inline: true },
      { name: "Hosts", value: hostText, inline: false },
      { name: "Attendees", value: attendeeText, inline: false },
      { name: "MVP(s)", value: mvpText, inline: false },
      { name: "Event Points", value: `${points}`, inline: true },
      { name: "MVP Points", value: `${mvpPoints}`, inline: true },
      { name: "Event Bank Deposit", value: `${config.economy.eventDepositAttendee}`, inline: true },
      { name: "MVP Bank Deposit", value: `${config.economy.eventDepositMvp}`, inline: true },
      { name: "Notes", value: notes || "None", inline: false }
    )
    .setFooter({ text: `Logged by ${interaction.user.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_edit_${eventId}`)
      .setLabel("Edit")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`event_points_${eventId}`)
      .setLabel("Points")
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await loggingCamp.send({ embeds: [embed], components: [row] });
  data.events[eventId].loggingCampMessageId = msg.id;
  persist();

  for (const userId of attendeeIds) {
    const isMvp = mvpIds.includes(userId);
    const awardedPoints = isMvp ? mvpPoints : points;
    await logPointsChange(userId, awardedPoints, interaction.user.id, "event_add", isMvp);

    if (hasActiveAccount(data, userId)) {
      const amount = isMvp ? config.economy.eventDepositMvp : config.economy.eventDepositAttendee;
      const taskId = generateId("EVDEP");
      const task = {
        taskId,
        eventId,
        userId,
        userMention: `<@${userId}>`,
        amount,
        status: "pending",
        createdAt: nowIso(),
        completedBy: null,
        completedAt: null,
        messageId: null,
      };
      data.eventDepositTasks[taskId] = task;
      persist();

      const taskMsg = await sendEventLoggingTask(task);
      if (taskMsg) {
        data.eventDepositTasks[taskId].messageId = taskMsg.id;
        persist();
      }
    }
  }

  return eventId;
}

async function maybeHandleBoosterMembershipUpdate(oldMember, newMember) {
  // NOTE:
  // Discord.js can detect premiumSince changes on guildMemberUpdate.
  // This implementation handles:
  // - boost gained
  // - boost lost before 10 days
  // If no account exists, it stores pending boost reward.
  const oldBoost = oldMember.premiumSinceTimestamp;
  const newBoost = newMember.premiumSinceTimestamp;

  if (!oldBoost && newBoost) {
    const userId = newMember.id;

    if (hasActiveAccount(data, userId)) {
      const account = getOrCreateAccount(data, userId);
      account.balance += config.economy.boostRewardUser;
      account.boostRewards.push({
        amount: config.economy.boostRewardUser,
        treasuryAmount: config.economy.boostRewardTreasury,
        grantedAt: nowIso(),
        expiresAt: new Date(Date.now() + config.economy.boostGraceDays * 24 * 60 * 60 * 1000).toISOString(),
        reversibleUntil: new Date(Date.now() + config.economy.boostGraceDays * 24 * 60 * 60 * 1000).toISOString(),
        source: "boost",
      });

      addTransactionToAccount(account, {
        id: generateId("BOOST"),
        type: "boost_reward",
        grossAmount: config.economy.boostRewardUser,
        createdAt: nowIso(),
        source: "boost",
      });

      updateTreasury(data, config.economy.boostRewardTreasury, { reason: "boost_reward", userId });
      persist();

      await sendTreasuryEmbed(
        `<@${userId}> Boosted the server, adding ${formatMoney(config.economy.boostRewardTreasury)} to The Consortium Treasury!\nNew Treasury Balance: ${formatMoney(data.treasury)}\nThank you for boosting! <@${userId}>`,
        config.colors.boost
      );

      const publicEmbed = new EmbedBuilder()
        .setColor(config.colors.boost)
        .setDescription(`<@${userId}> boosted the server and received a boost reward of ${formatMoney(config.economy.boostRewardUser)}. Thank you for boosting! <@${userId}>`)
        .setTimestamp();

      await sendConsortiumBankEmbed(publicEmbed);

      const txEmbed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("🧾 Boost Reward Granted")
        .setDescription(`<@${userId}> received an immediate boost reward.`)
        .setTimestamp();

      await sendTransactionsLog(txEmbed);
    } else {
      data.pendingBoosts[userId] = {
        amountUser: config.economy.boostRewardUser,
        amountTreasury: config.economy.boostRewardTreasury,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + config.economy.boostGraceDays * 24 * 60 * 60 * 1000).toISOString(),
      };
      persist();

      const channel = await client.channels.fetch(config.channels.consortiumBank).catch(() => null);
      if (channel) {
        await channel.send({
          content: `<@${userId}> boosted the server but does not have a Consortium Bank account.\nOpen an account within 10 days to claim your reward!`,
        }).catch(() => null);
      }
    }
  }

  if (oldBoost && !newBoost) {
    const userId = newMember.id;
    const account = getOrCreateAccount(data, userId);
    const reward = [...(account.boostRewards || [])].reverse().find(r => !r.reversedAt);

    if (!reward) return;

    const grantedAt = new Date(reward.grantedAt).getTime();
    const ageDays = Math.floor((Date.now() - grantedAt) / (1000 * 60 * 60 * 24));

    if (ageDays < config.economy.boostGraceDays) {
      account.balance = Math.max(0, Number(account.balance || 0) - Number(reward.amount || 0));
      data.treasury = Math.max(0, Number(data.treasury || 0) - Number(reward.treasuryAmount || 0));
      reward.reversedAt = nowIso();
      reward.reversalReason = "boost_expired_early";

      addTransactionToAccount(account, {
        id: generateId("BOOSTREV"),
        type: "boost_reversal",
        grossAmount: reward.amount,
        createdAt: nowIso(),
      });

      persist();

      await sendTreasuryEmbed(
        `<@${userId}>'s boost expired early, removing ${formatMoney(reward.treasuryAmount)} from The Consortium Treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`,
        config.colors.treasury
      );

      const publicEmbed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setDescription(`<@${userId}>'s boost expired before 10 days, removing ${formatMoney(reward.amount)} from their account and ${formatMoney(reward.treasuryAmount)} from the treasury.`)
        .setTimestamp();

      await sendConsortiumBankEmbed(publicEmbed);

      const txEmbed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("🧾 Boost Reversal")
        .setDescription(`<@${userId}>'s boost expired before 10 days. Reward was reversed.`)
        .setTimestamp();

      await sendTransactionsLog(txEmbed);
    }
  }
}

client.once("clientReady", async () => {
  await initDatabase();
  data = loadData();

  console.log(`🏦 ${client.user.tag} is online`);

  for (const account of Object.values(data.accounts)) {
    if (account?.status === "active") {
      const changed = updateWithdrawableDepositsForAccount(account);
      if (changed) {
        persist();
      }
    }
  }
});

client.on("guildMemberRemove", async (member) => {
  const account = getOrCreateAccount(data, member.id);
  if (account.status === "active") {
    await closeAccountForUser(member.id, client.user.id, false, "member_left", true);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  await maybeHandleBoosterMembershipUpdate(oldMember, newMember).catch(console.error);
});

client.on("interactionCreate", async (interaction) => {
  try {
    reloadData();

    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId === "start_bank_account_application") {
        if (hasActiveAccount(data, interaction.user.id)) {
          return interaction.reply({
            embeds: [buildErrorEmbed("You already have an active Consortium Bank Account. You cannot have more than 1 accounts.")],
            ephemeral: true,
          });
        }

        const applicationsChannel = await client.channels.fetch(config.channels.accountApplications).catch(() => null);
        if (!applicationsChannel || applicationsChannel.type !== ChannelType.GuildText) {
          return interaction.reply({
            embeds: [buildErrorEmbed("The application channel is unavailable.")],
            ephemeral: true,
          });
        }

        const thread = await applicationsChannel.threads.create({
          name: `application-${interaction.user.username}-${interaction.user.id.slice(-4)}`,
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          invitable: false,
          reason: `Bank account application for ${interaction.user.tag}`,
        });

        await thread.members.add(interaction.user.id).catch(() => null);

        for (const member of interaction.guild.members.cache.values()) {
          const roleState = getMemberRoleState(member);
          if (roleState.isSovereign || roleState.isDirector) {
            await thread.members.add(member.id).catch(() => null);
          }
        }

        const applicationId = generateId("APP");
        data.applications[applicationId] = {
          id: applicationId,
          userId: interaction.user.id,
          threadId: thread.id,
          answers: {},
          questionIndex: 0,
          status: "collecting",
          createdAt: nowIso(),
        };
        persist();

        const introEmbed = new EmbedBuilder()
          .setColor(config.colors.info)
          .setTitle("🗃️ Consortium Bank Account Application")
          .setDescription(
            [
              `Welcome, ${interaction.user}.`,
              "",
              "Before opening a bank account, please understand the system:",
              "- Deposits require approval.",
              "- Approved deposits unlock for withdrawal after 15 days.",
              "- Withdrawals require an active account, account age of 30 days, and balance above $100.",
              "- Fraud, abuse, or dishonesty may result in account closure.",
              "- Only one active account is allowed per member.",
              "",
              "Please answer the following questions carefully.",
            ].join("\n")
          )
          .setTimestamp();

        await thread.send({ embeds: [introEmbed] });

        const firstQuestion = config.setup.applicationQuestions[0];
        await thread.send({ content: `**Question 1/${config.setup.applicationQuestions.length}:** ${firstQuestion.question}` });

        return interaction.reply({
          embeds: [buildSuccessEmbed(`Your application thread has been created: <#${thread.id}>`)],
          ephemeral: true,
        });
      }

      if (customId.startsWith("approve_deposit_") || customId.startsWith("deny_deposit_")) {
  const action = customId.startsWith("approve_deposit_") ? "approve" : "deny";
  const txId = customId.replace(`${action}_deposit_`, "");
  const tx = data.pendingDeposits[txId];

  if (!tx) {
    return interaction.reply({
      embeds: [buildErrorEmbed("This deposit transaction could not be found.")],
      ephemeral: true,
    });
  }

  if (tx.status !== "pending") {
    return interaction.reply({
      embeds: [buildErrorEmbed("This transaction has already been handled.")],
      ephemeral: true,
    });
  }

  const approvalCheck = bankerCanApproveTx(tx, interaction.member);
  if (!approvalCheck.ok) {
    return interaction.reply({
      embeds: [buildErrorEmbed(approvalCheck.message)],
      ephemeral: true,
    });
  }

  if (action === "approve") {
    await approveDeposit(tx, interaction, interaction.guild);
    return interaction.reply({
      embeds: [buildSuccessEmbed(`Deposit ${tx.txId} approved.`)],
      ephemeral: true,
    });
  }

  if (action === "deny") {
    await denyDeposit(tx, interaction);
    return interaction.reply({
      embeds: [buildSuccessEmbed(`Deposit ${tx.txId} denied.`)],
      ephemeral: true,
    });
  }
}

      if (customId.startsWith("event_points_")) {
        const eventId = customId.replace("event_points_", "");
        const event = data.events[eventId];
        if (!event) {
          return interaction.reply({
            embeds: [buildErrorEmbed("Event could not be found.")],
            ephemeral: true,
          });
        }

        const lines = event.attendeeIds.map((id) => {
          const isMvp = event.mvpIds.includes(id);
          const amount = isMvp ? event.mvpPoints : event.points;
          return `${isMvp ? "⭐" : "•"} <@${id}> — ${amount} point(s)`;
        });

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.info)
              .setTitle(`📊 Event Points — ${event.id}`)
              .setDescription(lines.length ? lines.join("\n") : "No attendees found.")
          ],
          ephemeral: true,
        });
      }

      if (customId.startsWith("event_edit_")) {
        const eventId = customId.replace("event_edit_", "");
        const event = data.events[eventId];
        if (!event) {
          return interaction.reply({
            embeds: [buildErrorEmbed("Event could not be found.")],
            ephemeral: true,
          });
        }

        if (!canUseEventCommands(interaction.member)) {
          return interaction.reply({
            embeds: [buildErrorEmbed("You are not allowed to edit this event log.")],
            ephemeral: true,
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`event_add_${eventId}`)
            .setLabel("Add")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`event_remove_${eventId}`)
            .setLabel("Remove")
            .setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(config.colors.info)
              .setTitle("✏️ Event Editor")
              .setDescription("Use the buttons below. This editor is only visible to you.\n\nBecause Discord buttons cannot open freeform user pickers by themselves, I’ll use the next typed message you send in this channel as the target mention(s).")
          ],
          components: [row],
          ephemeral: true,
        });
      }

      if (customId.startsWith("event_add_") || customId.startsWith("event_remove_")) {
        const mode = customId.startsWith("event_add_") ? "add" : "remove";
        const eventId = customId.replace(`event_${mode}_`, "");
        const event = data.events[eventId];
        if (!event) {
          return interaction.reply({
            embeds: [buildErrorEmbed("Event could not be found.")],
            ephemeral: true,
          });
        }

        data.applications[`TEMP_EVENT_EDIT_${interaction.user.id}`] = {
          mode,
          eventId,
          expiresAt: Date.now() + 120000,
        };
        persist();

        return interaction.reply({
          embeds: [
            buildInfoEmbed(
              "Event Edit Pending",
              `Please send the user mention(s) in this channel within 2 minutes. I will ${mode} them from event ${eventId}.`
            )
          ],
          ephemeral: true,
        });
      }

      if (customId.startsWith("eventdeposit_complete_")) {
        const taskId = customId.replace("eventdeposit_complete_", "");
        const task = data.eventDepositTasks[taskId];
        if (!task) {
          return interaction.reply({
            embeds: [buildErrorEmbed("This event deposit task could not be found.")],
            ephemeral: true,
          });
        }

        if (!isBankStaff(interaction.member)) {
          return interaction.reply({
            embeds: [buildErrorEmbed("Only bank staff can mark event deposit tasks.")],
            ephemeral: true,
          });
        }

        if (task.status !== "pending") {
          return interaction.reply({
            embeds: [buildErrorEmbed("This event deposit task has already been handled.")],
            ephemeral: true,
          });
        }

        task.status = "completed";
        task.completedBy = interaction.user.id;
        task.completedAt = nowIso();
        persist();

        const embed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle("📅 Event Deposit Task Completed")
          .setDescription(`${task.userMention}'s event deposit task has been marked as completed by ${interaction.user}.`)
          .addFields(
            { name: "Task ID", value: task.taskId, inline: true },
            { name: "Amount", value: formatMoney(task.amount), inline: true }
          )
          .setTimestamp();

        return interaction.update({ embeds: [embed], components: [] });
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName;
    const roles = getMemberRoleState(interaction.member);

    // Channel restrictions
    if (staffCommandNames().has(commandName) && commandName !== "help") {
      if (!assertChannel(interaction, config.channels.bankerCommands)) {
        return interaction.reply({
          embeds: [buildErrorEmbed(`Use this command in <#${config.channels.bankerCommands}>.`)],
          ephemeral: true,
        });
      }
    }

    if (publicCommandNames().has(commandName) && commandName !== "help") {
      if (!assertChannel(interaction, config.channels.bankCommands)) {
        return interaction.reply({
          embeds: [buildErrorEmbed(`Use this command in <#${config.channels.bankCommands}>.`)],
          ephemeral: true,
        });
      }
    }

    if (commandName === "help") {
      const isStaff = isBankStaff(interaction.member);
      const correctChannel = isStaff ? config.channels.bankerCommands : config.channels.bankCommands;
      if (interaction.channelId !== correctChannel) {
        return interaction.reply({
          embeds: [buildErrorEmbed(`Use /help in <#${correctChannel}>.`)],
          ephemeral: true,
        });
      }

      return interaction.reply({
        embeds: [buildHelpEmbedForMember(interaction)],
        ephemeral: true,
      });
    }

    if (commandName === "create_bank_account") {
      if (!isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only the Consortium Sovereign or Bank Director can use this command.")],
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser("user", true);
      const result = await openAccountForUser(user.id, interaction.user.id, true);
      if (!result.ok) {
        return interaction.reply({ embeds: [buildErrorEmbed(result.message)], ephemeral: true });
      }

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Opened a Consortium Bank account for ${user}.`)],
        ephemeral: true,
      });
    }

    if (commandName === "close_account") {
      if (!isHighAuthority(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only the Consortium Sovereign or Bank Director can use this command.")],
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser("user", true);
      const tax25 = interaction.options.getBoolean("tax25", true);

      const result = await closeAccountForUser(user.id, interaction.user.id, tax25, "manual_close", true);
      if (!result.ok) {
        return interaction.reply({ embeds: [buildErrorEmbed(result.message)], ephemeral: true });
      }

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Closed ${user}'s account.${tax25 ? ` Treasury received ${formatMoney(result.taxedAmount)}.` : ""}`)],
        ephemeral: true,
      });
    }

    if (commandName === "balance") {
      const targetUser = interaction.options.getUser("user") || interaction.user;

      if (targetUser.id !== interaction.user.id && !isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only bank staff can view another member's balance.")],
          ephemeral: true,
        });
      }

      if (!hasActiveAccount(data, targetUser.id)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("This user does not have an active bank account")],
          ephemeral: true,
        });
      }

      const account = getOrCreateAccount(data, targetUser.id);
      const changed = updateWithdrawableDepositsForAccount(account);
      if (changed) persist();

      const summary = getAccountSummary(account);

      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle(`💳 Balance — ${targetUser.tag}`)
        .addFields(
          { name: "Balance", value: formatMoney(summary.balance), inline: true },
          { name: "Withdrawable Balance", value: formatMoney(summary.withdrawableBalance), inline: true },
          { name: "Pending Approval Balance", value: formatMoney(summary.pendingApprovalBalance), inline: true },
          { name: "Account Status", value: summary.status, inline: true },
          { name: "Opened", value: summary.createdAt ? formatDate(summary.createdAt) : "N/A", inline: false }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === "account") {
      const targetUser = interaction.options.getUser("user") || interaction.user;
      const page = interaction.options.getInteger("page") || 1;

      if (targetUser.id !== interaction.user.id && !isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only bank staff can view another member's account.")],
          ephemeral: true,
        });
      }

      if (!hasActiveAccount(data, targetUser.id)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("This user does not have an active bank account")],
          ephemeral: true,
        });
      }

      const account = getOrCreateAccount(data, targetUser.id);
      const changed = updateWithdrawableDepositsForAccount(account);
      if (changed) persist();

      const summary = getAccountSummary(account);
      const logs = [...(account.transactions || [])].reverse();
      const pages = chunkArray(logs, 10);
      const selectedPage = Math.max(1, Math.min(page, pages.length || 1));
      const selectedLogs = pages[selectedPage - 1] || [];

      const description = selectedLogs.length
        ? selectedLogs.map(log => {
            const base = `**${log.type}** — ${log.createdAt ? formatDate(log.createdAt) : "Unknown time"}`;
            if (log.grossAmount != null) return `${base}\nAmount: ${formatMoney(log.grossAmount)}`;
            return base;
          }).join("\n\n")
        : "No logs found.";

      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle(`🏦 Account — ${targetUser.tag}`)
        .addFields(
          { name: "Balance", value: formatMoney(summary.balance), inline: true },
          { name: "Withdrawable Balance", value: formatMoney(summary.withdrawableBalance), inline: true },
          { name: "Pending Approval Balance", value: formatMoney(summary.pendingApprovalBalance), inline: true },
          { name: "Account Status", value: summary.status, inline: true },
          { name: "Opened", value: summary.createdAt ? formatDate(summary.createdAt) : "N/A", inline: false },
          { name: `Logs (Page ${selectedPage}/${Math.max(1, pages.length)})`, value: description, inline: false }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === "deposit") {
      if (!isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only bank staff can use this command.")],
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const reason = interaction.options.getString("reason", true);
      const otherReason = interaction.options.getString("other_reason");

      if (amount < config.economy.minimumDeposit) {
        return interaction.reply({
          embeds: [buildErrorEmbed(`Minimum deposit is ${formatMoney(config.economy.minimumDeposit)}.`)],
          ephemeral: true,
        });
      }

      if (reason === "other" && !otherReason) {
        return interaction.reply({
          embeds: [buildErrorEmbed("You must provide Other Reason when using the Other deposit reason.")],
          ephemeral: true,
        });
      }

      if (!hasActiveAccount(data, user.id)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("This user does not have an active bank account")],
          ephemeral: true,
        });
      }

      if (hasDepositCooldown(data, user.id)) {
        return interaction.reply({
          embeds: [buildErrorEmbed(`A deposit has been made to this user within the last 60 seconds, please try again soon. (${getDepositCooldownRemaining(data, user.id)}s remaining)`)],
          ephemeral: true,
        });
      }

      setDepositCooldown(data, user.id);

      const account = getOrCreateAccount(data, user.id);
      account.pendingApprovalBalance += amount;

      const issuerRoleType = roles.isBanker && !roles.isDirector && !roles.isSovereign
        ? "banker"
        : "high_authority";

      const tx = createPendingDepositObject({
        userId: user.id,
        createdBy: interaction.user.id,
        amount,
        reason,
        otherReason,
        issuerRoleType,
        source: "manual",
      });

      persist();
      await postPendingDeposit(tx, interaction.guild);

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Deposit request ${tx.txId} created and sent to pending approval.`)],
        ephemeral: true,
      });
    }

    if (commandName === "fee") {
      if (!isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only bank staff can use this command.")],
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const reason = interaction.options.getString("reason", true);

      if (!hasActiveAccount(data, user.id)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("This user does not have an active bank account")],
          ephemeral: true,
        });
      }

      const account = getOrCreateAccount(data, user.id);
      if (Number(account.balance || 0) < amount) {
        return interaction.reply({
          embeds: [buildErrorEmbed("This account does not have enough balance for that fee.")],
          ephemeral: true,
        });
      }

      const feeId = generateId("FEE");
      account.balance -= amount;
      account.withdrawableBalance = Math.max(0, Number(account.withdrawableBalance || 0) - amount);

      addTransactionToAccount(account, {
        id: feeId,
        type: "fee",
        grossAmount: amount,
        by: interaction.user.id,
        reason,
        createdAt: nowIso(),
      });

      data.fees[feeId] = {
        id: feeId,
        userId: user.id,
        amount,
        reason,
        chargedBy: interaction.user.id,
        createdAt: nowIso(),
        reversed: false,
        reversedAt: null,
        reversedBy: null,
      };

      updateTreasury(data, amount, { reason: "fee", userId: user.id });
      persist();

      await sendTreasuryEmbed(
        `${formatMoney(amount)} was added to The Consortium Treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`
      );

      const txEmbed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("🧾 Fee Charged")
        .addFields(
          { name: "Fee ID", value: feeId, inline: true },
          { name: "User", value: `${user}`, inline: true },
          { name: "Amount", value: formatMoney(amount), inline: true },
          { name: "Reason", value: reason, inline: false }
        )
        .setTimestamp();

      await sendTransactionsLog(txEmbed);

      const publicEmbed = new EmbedBuilder()
        .setColor(config.colors.withdrawal)
        .setDescription(`${user} paid a fee of ${formatMoney(amount)}, adding it to the treasury. Reason: ${reason}`)
        .setTimestamp();

      await sendConsortiumBankEmbed(publicEmbed);

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Fee ${feeId} applied to ${user}.`)],
        ephemeral: true,
      });
    }

    if (commandName === "undofee") {
      if (!isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only bank staff can use this command.")],
          ephemeral: true,
        });
      }

      const feeId = interaction.options.getString("fee_id", true);
      const reason = interaction.options.getString("reason", true);

      const fee = data.fees[feeId];
      if (!fee) {
        return interaction.reply({
          embeds: [buildErrorEmbed("That fee ID was not found.")],
          ephemeral: true,
        });
      }

      if (fee.reversed) {
        return interaction.reply({
          embeds: [buildErrorEmbed("That fee has already been reversed.")],
          ephemeral: true,
        });
      }

      const account = getOrCreateAccount(data, fee.userId);
      if (data.treasury < fee.amount) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Treasury does not have enough funds to reverse this fee.")],
          ephemeral: true,
        });
      }

      account.balance += fee.amount;

      addTransactionToAccount(account, {
        id: `${feeId}-UNDO`,
        type: "fee_reversal",
        grossAmount: fee.amount,
        by: interaction.user.id,
        reason,
        createdAt: nowIso(),
      });

      data.treasury -= fee.amount;
      fee.reversed = true;
      fee.reversedAt = nowIso();
      fee.reversedBy = interaction.user.id;
      persist();

      await sendTreasuryEmbed(
        `${formatMoney(fee.amount)} was removed from The Consortium Treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`
      );

      const txEmbed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("🧾 Fee Reversed")
        .addFields(
          { name: "Fee ID", value: feeId, inline: true },
          { name: "User", value: `<@${fee.userId}>`, inline: true },
          { name: "Amount Returned", value: formatMoney(fee.amount), inline: true },
          { name: "Reversed By", value: `${interaction.user}`, inline: true },
          { name: "Reason", value: reason, inline: false }
        )
        .setTimestamp();

      await sendTransactionsLog(txEmbed);

      const publicEmbed = new EmbedBuilder()
        .setColor(config.colors.deposit)
        .setDescription(`${interaction.user} reversed <@${fee.userId}>'s fee, adding back ${formatMoney(fee.amount)} to their account.`)
        .setTimestamp();

      await sendConsortiumBankEmbed(publicEmbed);

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Fee ${feeId} reversed.`)],
        ephemeral: true,
      });
    }

    if (commandName === "treasurydonate") {
      if (!roles.isSovereign) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only the Consortium Sovereign can use this command.")],
          ephemeral: true,
        });
      }

      const amount = interaction.options.getInteger("amount", true);
      updateTreasury(data, amount, { reason: "sovereign_donation", by: interaction.user.id });
      persist();

      await sendTreasuryEmbed(
        `MemeEgg donated ${formatMoney(amount)} to The Consortium Treasury!\nNew Treasury Balance: ${formatMoney(data.treasury)}\nTHANK YOU MEMEEGG!`
      );

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Donated ${formatMoney(amount)} to the treasury.`)],
        ephemeral: true,
      });
    }

    if (commandName === "withdraw") {
  if (!hasActiveAccount(data, interaction.user.id)) {
    return interaction.reply({
      embeds: [buildErrorEmbed("This user does not have an active bank account")],
      ephemeral: true,
    });
  }

  const amount = interaction.options.getInteger("amount", true);
  const account = getOrCreateAccount(data, interaction.user.id);
  const changed = updateWithdrawableDepositsForAccount(account);
  if (changed) persist();

  const issues = getWithdrawalEligibility(account, amount);
  if (issues.length) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.error)
          .setTitle("❌ Withdrawal Requirements Not Met")
          .setDescription(issues.map(i => `• ${i}`).join("\n"))
      ],
      ephemeral: true,
    });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle("✅ Withdrawal Available")
        .setDescription(
          `You meet the requirements to withdraw ${formatMoney(amount)}!\n\nPlease go to the **Request Withdrawal** channel and request a withdrawal.`
        )
        .setTimestamp()
    ],
    ephemeral: true,
  });
}

if (commandName === "staffwithdraw") {
  if (!isHighAuthority(interaction.member)) {
    return interaction.reply({
      embeds: [buildErrorEmbed("Only the Consortium Sovereign or Bank Director can use this command.")],
      ephemeral: true,
    });
  }

  const user = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount", true);

  if (!hasActiveAccount(data, user.id)) {
    return interaction.reply({
      embeds: [buildErrorEmbed("This user does not have an active bank account")],
      ephemeral: true,
    });
  }

  const account = getOrCreateAccount(data, user.id);
  const changed = updateWithdrawableDepositsForAccount(account);
  if (changed) persist();

  if (Number(account.balance || 0) < amount) {
    return interaction.reply({
      embeds: [buildErrorEmbed("This account does not have enough balance for that withdrawal.")],
      ephemeral: true,
    });
  }

  if (Number(account.withdrawableBalance || 0) < amount) {
    return interaction.reply({
      embeds: [buildErrorEmbed("This account does not have enough withdrawable balance for that withdrawal.")],
      ephemeral: true,
    });
  }

  if (data.treasury < amount) {
    return interaction.reply({
      embeds: [buildErrorEmbed("Treasury does not have enough funds.")],
      ephemeral: true,
    });
  }

  const taxAmount = Math.floor(amount * config.economy.withdrawTaxRate);

  account.balance = Math.max(0, Number(account.balance || 0) - amount);
  account.withdrawableBalance = Math.max(0, Number(account.withdrawableBalance || 0) - amount);
  addMonthlyWithdrawn(account, amount);

  addTransactionToAccount(account, {
    id: generateId("STFWDR"),
    type: "staff_withdrawal",
    grossAmount: amount,
    taxAmount,
    by: interaction.user.id,
    createdAt: nowIso(),
  });

  data.treasury -= amount;
  persist();

  await sendTreasuryEmbed(
    `${formatMoney(amount)} was withdrawn from the treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`
  );

  const publicEmbed = new EmbedBuilder()
    .setColor(config.colors.withdrawal)
    .setDescription(`<@${user.id}> withdrew ${formatMoney(amount)}, keeping ${formatMoney(taxAmount)} in the treasury.`)
    .setTimestamp();

  await sendConsortiumBankEmbed(publicEmbed);

  const txEmbed = new EmbedBuilder()
    .setColor(config.colors.withdrawal)
    .setTitle("🧾 Staff Withdrawal")
    .addFields(
      { name: "User", value: `<@${user.id}>`, inline: true },
      { name: "Amount", value: formatMoney(amount), inline: true },
      { name: "Treasury Balance After", value: formatMoney(data.treasury), inline: true },
      { name: "Processed By", value: `${interaction.user}`, inline: true }
    )
    .setTimestamp();

  await sendTransactionsLog(txEmbed);

  return interaction.reply({
    embeds: [buildSuccessEmbed(`Withdrew ${formatMoney(amount)} from ${user}'s account.`)],
    ephemeral: true,
  });
}

if (commandName === "treasuryremove") {
  if (!isHighAuthority(interaction.member)) {
    return interaction.reply({
      embeds: [buildErrorEmbed("Only the Consortium Sovereign or Bank Director can use this command.")],
      ephemeral: true,
    });
  }

  const amount = interaction.options.getInteger("amount", true);

  if (data.treasury < amount) {
    return interaction.reply({
      embeds: [buildErrorEmbed("Treasury does not have enough funds.")],
      ephemeral: true,
    });
  }

  data.treasury -= amount;
  persist();

  await sendTreasuryEmbed(
    `${formatMoney(amount)} was withdrawn from the treasury.\nNew Treasury Balance: ${formatMoney(data.treasury)}`
  );

  const txEmbed = new EmbedBuilder()
    .setColor(config.colors.withdrawal)
    .setTitle("🧾 Treasury Removal")
    .addFields(
      { name: "Amount Removed", value: formatMoney(amount), inline: true },
      { name: "New Treasury Balance", value: formatMoney(data.treasury), inline: true },
      { name: "Removed By", value: `${interaction.user}`, inline: true }
    )
    .setTimestamp();

  await sendTransactionsLog(txEmbed);

  return interaction.reply({
    embeds: [buildSuccessEmbed(`Removed ${formatMoney(amount)} from the treasury.`)],
    ephemeral: true,
  });
}

    if (commandName === "addpoints" || commandName === "removepoints") {
      if (!isBankStaff(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only bank staff can use this command.")],
          ephemeral: true,
        });
      }

      const user = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const signedAmount = commandName === "addpoints" ? amount : -amount;

      await logPointsChange(
        user.id,
        signedAmount,
        interaction.user.id,
        commandName === "addpoints" ? "manual_add" : "manual_remove",
        false
      );

      return interaction.reply({
        embeds: [buildSuccessEmbed(`${commandName === "addpoints" ? "Added" : "Removed"} ${amount} points ${commandName === "addpoints" ? "to" : "from"} ${user}.`)],
        ephemeral: true,
      });
    }

    if (commandName === "logevent") {
      if (!canUseEventCommands(interaction.member)) {
        return interaction.reply({
          embeds: [buildErrorEmbed("Only Consortium Event Executives or high authority can use this command.")],
          ephemeral: true,
        });
      }

      const eventId = await createEventLog(interaction);

      return interaction.reply({
        embeds: [buildSuccessEmbed(`Event ${eventId} logged successfully.`)],
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      return interaction.followUp({
        embeds: [buildErrorEmbed(`An error occurred: ${error.message}`)],
        ephemeral: true,
      }).catch(() => null);
    }

    return interaction.reply({
      embeds: [buildErrorEmbed(`An error occurred: ${error.message}`)],
      ephemeral: true,
    }).catch(() => null);
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    reloadData();

    // Application answers
    const application = Object.values(data.applications).find(app =>
      app.threadId === message.channel.id &&
      app.userId === message.author.id &&
      app.status === "collecting"
    );

    if (application) {
      const question = config.setup.applicationQuestions[application.questionIndex];
      if (!question) return;

      application.answers[question.key] = message.content.trim();
      application.questionIndex += 1;

      if (application.questionIndex >= config.setup.applicationQuestions.length) {
        application.status = "submitted";
        application.submittedAt = nowIso();
        persist();

        const summaryLines = config.setup.applicationQuestions.map(q => {
          const answer = application.answers[q.key] || "No answer";
          return `**${q.question}**\n${answer}`;
        });

        const embed = new EmbedBuilder()
          .setColor(config.colors.info)
          .setTitle("🗃️ Application Submitted")
          .setDescription(summaryLines.join("\n\n"))
          .setTimestamp();

        await message.channel.send({
          content: `Application Submitted. ${getGuildRoleMention(config.roles.sovereign)} or ${getGuildRoleMention(config.roles.director)} will review your application.`,
          embeds: [embed],
        });

        return;
      }

      persist();
      const nextQuestion = config.setup.applicationQuestions[application.questionIndex];
      return message.channel.send({
        content: `**Question ${application.questionIndex + 1}/${config.setup.applicationQuestions.length}:** ${nextQuestion.question}`
      });
    }

    // Temporary event edit flow
    const tempEdit = data.applications[`TEMP_EVENT_EDIT_${message.author.id}`];
    if (tempEdit && tempEdit.expiresAt > Date.now()) {
      const event = data.events[tempEdit.eventId];
      if (!event) return;

      const mentionedIds = parseMentions(message.content);
      if (!mentionedIds.length) {
        await message.reply("Please mention at least one user.");
        return;
      }

      if (tempEdit.mode === "add") {
        for (const userId of mentionedIds) {
          if (!event.attendeeIds.includes(userId)) {
            event.attendeeIds.push(userId);
            const isMvp = event.mvpIds.includes(userId);
            const points = isMvp ? event.mvpPoints : event.points;
            await logPointsChange(userId, points, message.author.id, "event_add", isMvp);

            if (hasActiveAccount(data, userId)) {
              const amount = isMvp ? config.economy.eventDepositMvp : config.economy.eventDepositAttendee;
              const taskId = generateId("EVDEP");
              const task = {
                taskId,
                eventId: event.id,
                userId,
                userMention: `<@${userId}>`,
                amount,
                status: "pending",
                createdAt: nowIso(),
                completedBy: null,
                completedAt: null,
                messageId: null,
              };
              data.eventDepositTasks[taskId] = task;
              persist();

              const taskMsg = await sendEventLoggingTask(task);
              if (taskMsg) {
                data.eventDepositTasks[taskId].messageId = taskMsg.id;
                persist();
              }
            }
          }
        }

        await message.reply("Attendee(s) added to the event log.");
      } else if (tempEdit.mode === "remove") {
        for (const userId of mentionedIds) {
          if (event.attendeeIds.includes(userId)) {
            event.attendeeIds = event.attendeeIds.filter(id => id !== userId);
            const isMvp = event.mvpIds.includes(userId);
            const points = isMvp ? event.mvpPoints : event.points;
            await logPointsChange(userId, -points, message.author.id, "event_remove", isMvp);

            const relatedTasks = Object.values(data.eventDepositTasks).filter(task =>
              task.eventId === event.id && task.userId === userId
            );

            for (const task of relatedTasks) {
              if (task.status === "pending") {
                task.status = "voided";
                task.voidedAt = nowIso();

                const channel = await client.channels.fetch(config.channels.eventLogging).catch(() => null);
                if (channel && task.messageId) {
                  const msg = await channel.messages.fetch(task.messageId).catch(() => null);
                  if (msg) {
                    const embed = new EmbedBuilder()
                      .setColor(config.colors.error)
                      .setTitle("📅 Event Deposit Voided")
                      .setDescription(`<@${userId}> was removed from the event log.\nThis deposit has been voided.`)
                      .setTimestamp();

                    await msg.edit({ embeds: [embed], components: [] }).catch(() => null);
                  }
                }
              } else if (task.status === "completed") {
                task.status = "needs_review";
                task.reviewFlaggedAt = nowIso();

                const channel = await client.channels.fetch(config.channels.eventLogging).catch(() => null);
                if (channel && task.messageId) {
                  const msg = await channel.messages.fetch(task.messageId).catch(() => null);
                  if (msg) {
                    const embed = new EmbedBuilder()
                      .setColor(config.colors.error)
                      .setTitle("📅 Reversal Review Required")
                      .setDescription(`<@${userId}> was removed from the event log after their deposit had already been issued.\nThis deposit now requires reversal review.`)
                      .setTimestamp();

                    await msg.edit({ embeds: [embed], components: [] }).catch(() => null);
                  }
                }
              }
            }

            persist();
          }
        }

        await message.reply("Attendee(s) removed from the event log.");
      }

      delete data.applications[`TEMP_EVENT_EDIT_${message.author.id}`];
      persist();
    }
  } catch (error) {
    console.error("messageCreate handler error:", error);
  }
});

client.login(process.env.TOKEN);
