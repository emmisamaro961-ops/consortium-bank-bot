module.exports = {
  roles: {
    sovereign: "1493328626727260360",
    director: "1493819717998215338",
    banker: "1493696647803306114",
    civilian: "1493427427685175327",
    eventExecutive: "1493891574432665690",
  },

  categories: {
    bankerPanel: "1493324696111026266",
    bankDirector: "1493823703321022556",
    merchantHall: "1492869612696502444",
  },

  channels: {
    eventLogging: "1493837915640561694",
    transactionsLogs: "1493703888602402898",
    pendingTransactions: "1493704566091415602",
    bankerCommands: "1493823928018141354",
    staffTransactions: "1493824777012383754",
    accountApplications: "1493847686208557056",
    treasury: "1493833240400629830",
    createAccount: "1493829850950144040",
    consortiumBank: "1493440962104397824",
    loggingCamp: "1492863641278746824",
    pendingWithdrawals: "1493855423755714700",
    bankCommands: "1493860433923407953",
	pointsRegistrar: "1493441566692610199",
  },

  colors: {
    treasury: 0xe24144,
    deposit: 0x2ecc71,
    withdrawal: 0xeacc53,
    error: 0xe24144,
    success: 0x2ecc71,
    info: 0x5865f2,
    neutral: 0xf1c40f,
	boost: 0xf47fff,
  },

  economy: {
    minimumDeposit: 5,
    bankerAutoApprovalMax: 30,
    depositCooldownSeconds: 60,
    depositUnlockDays: 15,
    withdrawMinAccountBalance: 100,
    withdrawMinAccountAgeDays: 30,
    withdrawMonthlyLimit: 250,
    withdrawTaxRate: 0.25,
    depositRecipientRate: 0.75,
    depositTreasuryRateBanker: 0.20,
    depositBankerCutRate: 0.05,
    depositTreasuryRateDirector: 0.25,
    boostRewardUser: 50,
    boostRewardTreasury: 50,
    boostGraceDays: 10,
    eventDepositAttendee: 5,
    eventDepositMvp: 7,
  },

  setup: {
    applicationQuestions: [
      {
        key: "robloxUsername",
        question: "What is your Roblox Username?",
        required: true,
      },
      {
        key: "activity",
        question: "How active are you within the Consortium, and what activities do you usually participate in?",
        required: true,
      },
      {
        key: "understanding",
        question: "Do you understand that deposits may require approval, deposits unlock for withdrawal after 15 days, and withdrawals require a 30 day account age plus at least $100 balance?",
        required: true,
      },
      {
        key: "agreement",
        question: "Do you agree to follow all Consortium Bank rules, avoid fraudulent activity, and understand that abuse may result in account closure?",
        required: true,
      },
      {
        key: "notes",
        question: "Any extra notes you want leadership to know? If none, reply with `None`.",
        required: true,
      },
    ],
  },
};module.exports = {
  roles: {
    sovereign: "1493328626727260360",
    director: "1493819717998215338",
    banker: "1493696647803306114",
    civilian: "1493427427685175327",
    eventExecutive: "1493891574432665690",
  },

  categories: {
    bankerPanel: "1493324696111026266",
    bankDirector: "1493823703321022556",
    merchantHall: "1492869612696502444",
  },

  channels: {
    eventLogging: "1493837915640561694",
    transactionsLogs: "1493703888602402898",
    pendingTransactions: "1493704566091415602",
    bankerCommands: "1493823928018141354",
    staffTransactions: "1493824777012383754",
    accountApplications: "1493847686208557056",
    treasury: "1493833240400629830",
    createAccount: "1493829850950144040",
    consortiumBank: "1493440962104397824",
    loggingCamp: "1492863641278746824",
    pendingWithdrawals: "1493855423755714700",
    bankCommands: "1493860433923407953",
	pointsRegistrar: "1493441566692610199",
  },

  colors: {
    treasury: 0xe24144,
    deposit: 0x2ecc71,
    withdrawal: 0xeacc53,
    error: 0xe24144,
    success: 0x2ecc71,
    info: 0x5865f2,
    neutral: 0xf1c40f,
  },

  economy: {
    minimumDeposit: 5,
    bankerAutoApprovalMax: 30,
    depositCooldownSeconds: 60,
    depositUnlockDays: 15,
    withdrawMinAccountBalance: 100,
    withdrawMinAccountAgeDays: 30,
    withdrawMonthlyLimit: 250,
    withdrawTaxRate: 0.25,
    depositRecipientRate: 0.75,
    depositTreasuryRateBanker: 0.20,
    depositBankerCutRate: 0.05,
    depositTreasuryRateDirector: 0.25,
    boostRewardUser: 50,
    boostRewardTreasury: 50,
    boostGraceDays: 10,
    eventDepositAttendee: 5,
    eventDepositMvp: 7,
  },

  setup: {
    applicationQuestions: [
      {
        key: "robloxUsername",
        question: "What is your Roblox Username?",
        required: true,
      },
      {
        key: "activity",
        question: "How active are you within the Consortium, and what activities do you usually participate in?",
        required: true,
      },
      {
        key: "understanding",
        question: "Do you understand that deposits may require approval, deposits unlock for withdrawal after 15 days, and withdrawals require a 30 day account age plus at least $100 balance?",
        required: true,
      },
      {
        key: "agreement",
        question: "Do you agree to follow all Consortium Bank rules, avoid fraudulent activity, and understand that abuse may result in account closure?",
        required: true,
      },
      {
        key: "notes",
        question: "Any extra notes you want leadership to know? If none, reply with `None`.",
        required: true,
      },
    ],
  },
};
