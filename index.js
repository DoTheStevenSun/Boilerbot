const { token } = require('./config.json');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const trello = require('./trello');

// ── Slash command definitions ──────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Manage tasks on the Trello board')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new task')
      .addStringOption(o => o.setName('title').setDescription('Task title').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Task description').setRequired(false))
      .addStringOption(o => o.setName('due').setDescription('Due date (YYYY-MM-DD)').setRequired(false))
    )
    .addSubcommand(sub => sub
      .setName('assign')
      .setDescription('Assign a team member to a task')
      .addStringOption(o => o.setName('task').setDescription('Task name (partial ok)').setRequired(true))
      .addStringOption(o => o.setName('member').setDescription('Trello member username').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Move a task to a different status')
      .addStringOption(o => o.setName('task').setDescription('Task name (partial ok)').setRequired(true))
      .addStringOption(o => o.setName('status').setDescription('New status').setRequired(true)
        .addChoices(
          { name: 'To Do', value: 'todo' },
          { name: 'In Progress', value: 'inprogress' },
          { name: 'Done', value: 'done' }
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all tasks on the board')
      .addStringOption(o => o.setName('filter').setDescription('Filter by status').setRequired(false)
        .addChoices(
          { name: 'To Do', value: 'todo' },
          { name: 'In Progress', value: 'inprogress' },
          { name: 'Done', value: 'done' },
          { name: 'All', value: 'all' }
        )
      )
    )
    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('Get details on a specific task')
      .addStringOption(o => o.setName('task').setDescription('Task name (partial ok)').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('due')
      .setDescription('Set or update a due date on a task')
      .addStringOption(o => o.setName('task').setDescription('Task name (partial ok)').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('Due date (YYYY-MM-DD)').setRequired(true))
    )
].map(c => c.toJSON());

// ── Client setup ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages]
});

// ── Register slash commands on ready ──────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    console.log('Registering slash commands...');
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commands });
    }
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }

  // Start deadline checker (runs every day at 9am)
  startDeadlineChecker();
});

// ── Helper: find list ID by keyword ───────────────────────────────────────
async function findListId(keyword) {
  const lists = await trello.getLists();
  const map = { todo: ['to do', 'todo', 'backlog'], inprogress: ['in progress', 'doing', 'active'], done: ['done', 'complete', 'finished'] };
  const aliases = map[keyword] || [keyword.toLowerCase()];
  const match = lists.find(l => aliases.some(a => l.name.toLowerCase().includes(a)));
  return match ? match.id : lists[0].id;
}

// ── Helper: resolve card by partial name ──────────────────────────────────
async function resolveCard(query) {
  const results = await trello.searchCards(query);
  if (results.length === 0) return null;
  return results[0];
}

// ── Helper: resolve Trello member by username ─────────────────────────────
async function resolveMember(username) {
  const members = await trello.getMembers();
  return members.find(m => m.username.toLowerCase() === username.toLowerCase() || m.fullName.toLowerCase().includes(username.toLowerCase()));
}

// ── Helper: status label from list name ───────────────────────────────────
function statusEmoji(listName) {
  const n = listName.toLowerCase();
  if (n.includes('done') || n.includes('complete')) return '✅';
  if (n.includes('progress') || n.includes('doing')) return '🔄';
  return '📋';
}

// ── Interaction handler ────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'task') return;

  await interaction.deferReply();
  const sub = interaction.options.getSubcommand();

  try {
    // ── /task create ──────────────────────────────────────────────────────
    if (sub === 'create') {
      const title = interaction.options.getString('title');
      const desc = interaction.options.getString('description') || '';
      const dueInput = interaction.options.getString('due');
      const listId = await findListId('todo');
      const due = dueInput ? new Date(dueInput).toISOString() : null;
      const card = await trello.createCard(title, desc, listId, due);

      const embed = new EmbedBuilder()
        .setColor(0x0079BF)
        .setTitle('📋 Task Created')
        .addFields(
          { name: 'Title', value: card.name },
          { name: 'Status', value: 'To Do' },
          { name: 'Due', value: due ? dueInput : 'Not set' },
          { name: 'Trello Link', value: card.shortUrl }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /task assign ─────────────────────────────────────────────────────
    if (sub === 'assign') {
      const query = interaction.options.getString('task');
      const memberQuery = interaction.options.getString('member');
      const card = await resolveCard(query);
      if (!card) return interaction.editReply(`❌ No task found matching "${query}"`);
      const member = await resolveMember(memberQuery);
      if (!member) return interaction.editReply(`❌ No Trello member found matching "${memberQuery}". Make sure they are on the board.`);
      await trello.assignMember(card.id, member.id);

      const embed = new EmbedBuilder()
        .setColor(0x61BD4F)
        .setTitle('👤 Member Assigned')
        .addFields(
          { name: 'Task', value: card.name },
          { name: 'Assigned To', value: member.fullName || member.username },
          { name: 'Trello Link', value: card.shortUrl }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /task status ─────────────────────────────────────────────────────
    if (sub === 'status') {
      const query = interaction.options.getString('task');
      const statusKey = interaction.options.getString('status');
      const card = await resolveCard(query);
      if (!card) return interaction.editReply(`❌ No task found matching "${query}"`);
      const listId = await findListId(statusKey);
      await trello.moveCard(card.id, listId);
      const statusLabel = { todo: 'To Do', inprogress: 'In Progress', done: 'Done' }[statusKey];

      const embed = new EmbedBuilder()
        .setColor(0xF2D600)
        .setTitle('🔄 Status Updated')
        .addFields(
          { name: 'Task', value: card.name },
          { name: 'New Status', value: statusLabel },
          { name: 'Trello Link', value: card.shortUrl }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /task list ────────────────────────────────────────────────────────
    if (sub === 'list') {
      const filter = interaction.options.getString('filter') || 'all';
      const [cards, lists] = await Promise.all([trello.getCards(), trello.getLists()]);
      const listMap = Object.fromEntries(lists.map(l => [l.id, l.name]));

      let filtered = cards;
      if (filter !== 'all') {
        const listId = await findListId(filter);
        filtered = cards.filter(c => c.idList === listId);
      }

      if (filtered.length === 0) return interaction.editReply('📭 No tasks found.');

      const embed = new EmbedBuilder()
        .setColor(0x0079BF)
        .setTitle('📋 Task Board')
        .setDescription(filtered.map(c => {
          const list = listMap[c.idList] || 'Unknown';
          const due = c.due ? `⏰ ${new Date(c.due).toLocaleDateString()}` : '';
          return `${statusEmoji(list)} **${c.name}** — *${list}* ${due}`;
        }).join('\n'));

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /task info ────────────────────────────────────────────────────────
    if (sub === 'info') {
      const query = interaction.options.getString('task');
      const card = await resolveCard(query);
      if (!card) return interaction.editReply(`❌ No task found matching "${query}"`);
      const lists = await trello.getLists();
      const list = lists.find(l => l.id === card.idList);
      const members = card.members?.map(m => m.fullName || m.username).join(', ') || 'Unassigned';

      const embed = new EmbedBuilder()
        .setColor(0x0079BF)
        .setTitle(`🔍 ${card.name}`)
        .addFields(
          { name: 'Status', value: list?.name || 'Unknown' },
          { name: 'Assigned To', value: members },
          { name: 'Due Date', value: card.due ? new Date(card.due).toLocaleDateString() : 'Not set' },
          { name: 'Description', value: card.desc || 'None' },
          { name: 'Trello Link', value: card.shortUrl }
        );
      return interaction.editReply({ embeds: [embed] });
    }

    // ── /task due ─────────────────────────────────────────────────────────
    if (sub === 'due') {
      const query = interaction.options.getString('task');
      const dateInput = interaction.options.getString('date');
      const card = await resolveCard(query);
      if (!card) return interaction.editReply(`❌ No task found matching "${query}"`);
      const due = new Date(dateInput).toISOString();
      await trello.setDueDate(card.id, due);

      const embed = new EmbedBuilder()
        .setColor(0xFF9F1A)
        .setTitle('⏰ Due Date Set')
        .addFields(
          { name: 'Task', value: card.name },
          { name: 'Due Date', value: dateInput },
          { name: 'Trello Link', value: card.shortUrl }
        );
      return interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(err);
    interaction.editReply(`❌ Something went wrong: ${err.message}`);
  }
});

// ── Deadline checker ───────────────────────────────────────────────────────
// Runs every day at 9:00 AM, posts in any channel named "tasks" or "general"
function startDeadlineChecker() {
  cron.schedule('0 9 * * *', async () => {
    console.log('Running deadline check...');
    try {
      const cards = await trello.getCards();
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const dueSoon = cards.filter(c => {
        if (!c.due || c.dueComplete) return false;
        const due = new Date(c.due);
        return due <= tomorrow && due >= now;
      });

      if (dueSoon.length === 0) return;

      const message = dueSoon.map(c =>
        `⏰ **${c.name}** is due on ${new Date(c.due).toLocaleDateString()} — ${c.shortUrl}`
      ).join('\n');

      for (const guild of client.guilds.cache.values()) {
        const channel = guild.channels.cache.find(
          ch => ch.isTextBased() && ['tasks', 'general', 'bot'].some(n => ch.name.includes(n))
        );
        if (channel) {
          channel.send(`🔔 **Upcoming Deadlines:**\n${message}`);
        }
      }
    } catch (err) {
      console.error('Deadline check failed:', err);
    }
  });
}

client.login(token);