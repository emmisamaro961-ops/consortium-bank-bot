const fs = require("fs");
const path = require("path");
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const config = require("./config");

const DATA_PATH = path.join(__dirname, "data.json");

function loadData() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      return createDefaultData();
    }

    const raw = fs.readFileSync(DATA_PATH, "utf8");
    if (!raw.trim()) {
      return createDefaultData();
    }

    const parsed = JSON.parse(raw);
    return mergeDefaults(parsed);
  } catch (error) {
    console.error("Failed to load data.json, using defaults:", error);
    return createDefaultData();
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function createDefaultData() {
  return {
    treasury: 0,
    accounts: {},
    points: {},
    pendingDeposits: {},
    fees: {},
    withdrawals: {},
    events: {},
    pendingBoosts: {},
    setupMessages: {},
    cooldowns: {
      deposits: {},
    },
    applications: {},
    eventDepositTasks: {},
    boostHistory: {},
  };
}

function mergeDefaults(data) {
  const defaults = createDefaultData();
  return {
    ...defaults,
    ...data,
    cooldowns: {
      ...defaults.cooldowns,
      ...(data.cooldowns || {}),
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix = "ID") {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  const time = Date.now().toString().slice(-6);
  return `${prefix}-${time}-${random}`;
}

function getMemberRoleState(member) {
  const has = (roleId) => member?.roles?.cache?.has(roleId) || false;

  return {
    isSovereign: has(config.roles.sovereign),
    isDirector: has(config.roles.director),
    isBanker: has(config.roles.banker),
    isEventExecutive: has(config.roles.eventExecutive),
    isCivilian: has(config.roles.civilian),
  };
}

function isHighAuthority(member) {
  const roles = getMemberRoleState(member);
  return roles.isSovereign || roles.isDirector;
}

function isBankStaff(member) {
  const roles = getMemberRoleState(member);
  return roles.isSovereign || roles.isDirector || roles.isBanker;
}

function canUseEventCommands(member) {
  const roles = getMemberRoleState(member);
  return roles.isEventExecutive || roles.isSovereign || roles.isDirector;
}

function assertChannel(interaction, allowedChannelId) {
  return interaction.channelId === allowedChannelId;
}


function staffCommandNames() {
  return new Set([
    "deposit",
    "fee",
    "undofee",
    "create_bank_account",
    "close_account",
    "treasurydonate",
    "addpoints",
    "removepoints",
  ]);
}

function publicCommandNames() {
  return new Set([
    "withdraw",
    "account",
    "balance",
    "help",
  ]);
}

function getOrCreateAccount(data, userId) {
  if (!data.accounts[userId]) {
    data.accounts[userId] = {
      userId,
      status: "inactive",
      balance: 0,
      withdrawableBalance: 0,
      pendingApprovalBalance: 0,
      createdAt: null,
      closedAt: null,
      closedReason: null,
      transactions: [],
      deposits: [],
      monthlyWithdrawals: {},
      boostRewards: [],
    };
  }

  return data.accounts[userId];
}

function hasActiveAccount(data, userId) {
  const account = data.accounts[userId];
  return !!account && account.status === "active";
}

function getOrCreatePoints(data, userId) {
  if (!data.points[userId]) {
    data.points[userId] = {
      total: 0,
      eventsAttended: 0,
      history: [],
    };
  }

  return data.points[userId];
}

function addTransactionToAccount(account, entry) {
  account.transactions.push(entry);
  if (account.transactions.length > 300) {
    account.transactions = account.transactions.slice(-300);
  }
}

function addDepositRecord(account, record) {
  account.deposits.push(record);
  if (account.deposits.length > 300) {
    account.deposits = account.deposits.slice(-300);
  }
}

function addPointsHistory(pointsState, entry) {
  pointsState.history.push(entry);
  if (pointsState.history.length > 300) {
    pointsState.history = pointsState.history.slice(-300);
  }
}

function updateTreasury(data, amount, meta = {}) {
  data.treasury += amount;

  return {
    amount,
    newBalance: data.treasury,
    ...meta,
  };
}

function formatMoney(amount) {
  return `$${Number(amount).toLocaleString()}`;
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString();
}

function getMonthlyKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthlyWithdrawn(account, monthKey = getMonthlyKey()) {
  return Number(account.monthlyWithdrawals?.[monthKey] || 0);
}

function addMonthlyWithdrawn(account, amount, monthKey = getMonthlyKey()) {
  if (!account.monthlyWithdrawals) {
    account.monthlyWithdrawals = {};
  }

  account.monthlyWithdrawals[monthKey] = getMonthlyWithdrawn(account, monthKey) + amount;
}

function daysBetween(startIso, endDate = new Date()) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = new Date(endDate).getTime();
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}

function hasDepositCooldown(data, userId) {
  const last = Number(data.cooldowns?.deposits?.[userId] || 0);
  if (!last) return false;
  return Date.now() - last < config.economy.depositCooldownSeconds * 1000;
}

function getDepositCooldownRemaining(data, userId) {
  const last = Number(data.cooldowns?.deposits?.[userId] || 0);
  const msLeft = (config.economy.depositCooldownSeconds * 1000) - (Date.now() - last);
  return Math.max(0, Math.ceil(msLeft / 1000));
}

function setDepositCooldown(data, userId) {
  if (!data.cooldowns) data.cooldowns = { deposits: {} };
  if (!data.cooldowns.deposits) data.cooldowns.deposits = {};
  data.cooldowns.deposits[userId] = Date.now();
}

function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(config.colors.error)
    .setDescription(`❌ ${message}`);
}

function buildSuccessEmbed(message) {
  return new EmbedBuilder()
    .setColor(config.colors.success)
    .setDescription(`✅ ${message}`);
}

function buildInfoEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle(title)
    .setDescription(description);
}

function getAccountSummary(account) {
  return {
    balance: Number(account.balance || 0),
    withdrawableBalance: Number(account.withdrawableBalance || 0),
    pendingApprovalBalance: Number(account.pendingApprovalBalance || 0),
    status: account.status || "inactive",
    createdAt: account.createdAt,
  };
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

module.exports = {
  loadData,
  saveData,
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
  getMonthlyKey,
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
};