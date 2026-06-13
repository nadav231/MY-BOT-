import express from "express";
import {
  Client,
  GatewayIntentBits,
  AuditLogEvent,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";

// ─── Express Server ──────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("I'm alive!");
});

app.get("/api/healthz", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ─── Discord Bot ─────────────────────────────────────────────────────────────

if (process.env.DISCORD_BOT_ENABLED === "false") {
  console.log("Discord bot is disabled (DISCORD_BOT_ENABLED=false)");
  process.exit(0);
}

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.warn("DISCORD_TOKEN not set — bot will not start");
  process.exit(1);
}

const rolePrefixes = {
  "1496911471941259285": "MG",
  "1496911471928410222": "AR",
  "1496911471928410221": "SA",
  "1496911471928410220": "AD",
  "1496911471928410219": "IN",
  "1496911471928410217": "SMD",
  "1496911471928410216": "MOD",
  "1496911471928410215": "GR",
  "1496911471928410214": "SH",
  "1496911471915962558": "HR",
  "1496911471915962554": "RS",
  "1496911471915962557": "VIP",
};

const rolePriority = [
  "1496911471941259285",
  "1496911471928410222",
  "1496911471928410221",
  "1496911471928410220",
  "1496911471928410219",
  "1496911471928410217",
  "1496911471928410216",
  "1496911471928410215",
  "1496911471928410214",
  "1496911471915962558",
  "1496911471915962554",
  "1496911471915962557",
];

// ─── Constants & Configurations ──────────────────────────────────────────────
const ALLOWED_DELETE_ROLE_ID = "1515409287676035228"; // הרול שעוקף את כל הגנות ה-Anti-Nuke
const VERIFY_ROLE_ID = "1496911471915962552";        // רול ממבר (💸 Members)

const MAX_ACTIONS_ALLOWED = 3; 
const ACTION_RESET_TIME = 10000; 

const userActionLog = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
  ],
});

// ─── Helper Functions ────────────────────────────────────────────────────────

// פונקציה שבודקת האם המשתמש עוקף את ההגנות (בעלים, בוט, או בעל הרול המיוחד)
async function shouldBypass(guild, executorId) {
  if (executorId === guild.ownerId || executorId === client.user.id) return true;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return false;

  // אם יש לו את הרול המורשה - הוא יכול לעקוף הכל
  return member.roles.cache.has(ALLOWED_DELETE_ROLE_ID);
}

// פונקציית ענישה אוטומטית
async function punishUser(guild, executorId, reason) {
  try {
    if (executorId === guild.ownerId) return;
    
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member) return;

    const botMember = guild.members.me;
    if (member.roles.highest.position >= botMember.roles.highest.position) {
      console.log(`[Anti-Nuke] Cannot punish ${member.user.tag} — Role too high.`);
      return;
    }

    await member.roles.set([]).catch(() => null);
    await member.ban({ reason: `Anti-Nuke Triggered: ${reason}` });
    console.log(`[💥 Anti-Nuke BAN] Banned ${member.user.tag}. Reason: ${reason}`);
  } catch (err) {
    console.error("[Anti-Nuke Punishment] Error:", err.message);
  }
}

// בדיקת הצפות
function isMassActionTriggered(userId, actionType) {
  const key = `${userId}_${actionType}`;
  const now = Date.now();

  if (!userActionLog.has(key)) {
    userActionLog.set(key, []);
  }

  const timestamps = userActionLog.get(key);
  const validTimestamps = timestamps.filter(time => now - time < ACTION_RESET_TIME);
  
  validTimestamps.push(now);
  userActionLog.set(key, validTimestamps);

  return validTimestamps.length > MAX_ACTIONS_ALLOWED;
}

// ניקוי ועדכון כינויים
async function updateMemberNickname(member) {
  let prefix = null;
  for (const roleId of rolePriority) {
    if (member.roles.cache.has(roleId)) {
      prefix = rolePrefixes[roleId];
      break;
    }
  }
  if (!prefix) {
    if (member.nickname) await member.setNickname(null).catch(() => null);
    return;
  }
  const baseName = member.displayName.replace(/^(MG|AR|SA|AD|IN|SMD|MOD|GR|SH|HR|RS|VIP)\s\|\s/i, "");
  const newNickname = `${prefix} | ${baseName}`;
  if (member.nickname !== newNickname) {
    await member.setNickname(newNickname).catch(() => null);
  }
}

async function syncAllMembers() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  await guild.members.fetch().catch(() => null);
  for (const member of guild.members.cache.values()) {
    await updateMemberNickname(member).catch(() => null);
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);
  await syncAllMembers();
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  await updateMemberNickname(newMember).catch(() => null);
});

// פקודת פאנל האימות
client.on("messageCreate", async (message) => {
  if (message.author.bot || message.content !== "verify.panel") return;
  try {
    await message.delete().catch(() => null);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("verify_button").setLabel("אימות").setStyle(ButtonStyle.Success)
    );
    const embed = new EmbedBuilder()
      .setTitle("מערכת אימות השרת")
      .setDescription("לחץ על הכפתור למטה כדי לפתוח את החדרים בשרת ולקבל גישה!")
      .setColor("#00ff00");

    await message.channel.send({ embeds: [embed], components: [row] });
  } catch (err) { console.error(err); }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || interaction.customId !== "verify_button") return;
  try {
    const member = interaction.member;
    if (member.roles.cache.has(VERIFY_ROLE_ID)) {
      return await interaction.reply({ content: "אתה כבר מאומת בשרת!", ephemeral: true });
    }
    await member.roles.add(VERIFY_ROLE_ID);
    await interaction.reply({ content: "אוממת בהצלחה קיבלת גישה לחדרים", ephemeral: true });
  } catch (err) { console.error(err); }
});

// 1. הגנה מפני מחיקת חדרים / קטגוריות
client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
    const logEntry = logs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (await shouldBypass(channel.guild, executor.id)) return;

    await channel.guild.channels.create({
      name: channel.name,
      type: channel.type,
      parent: channel.parentId ?? undefined,
      topic: channel.topic ?? undefined,
      nsfw: channel.nsfw ?? false,
      permissionOverwrites: channel.permissionOverwrites?.cache.map((o) => ({
        id: o.id,
        allow: o.allow.bitfield,
        deny: o.deny.bitfield,
      })) ?? [],
    });

    await punishUser(channel.guild, executor.id, `Deleted channel/category without permission: #${channel.name}`);
  } catch (err) { console.error(err.message); }
});

// 2. הגנה מפני יצירת חדרים המונית
client.on("channelCreate", async (channel) => {
  if (!channel.guild) return;
  try {
    const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate });
    const logEntry = logs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (await shouldBypass(channel.guild, executor.id)) return;

    if (isMassActionTriggered(executor.id, "channel_create")) {
      await channel.delete().catch(() => null);
      await punishUser(channel.guild, executor.id, "Mass channel creation spam");
    }
  } catch (err) { console.error(err.message); }
});

// 3. הגנה מפני מחיקת רולים
client.on("roleDelete", async (role) => {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete });
    const logEntry = logs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (await shouldBypass(role.guild, executor.id)) return;

    await role.guild.roles.create({
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      permissions: role.permissions,
      mentionable: role.mentionable,
      position: role.position,
    });

    await punishUser(role.guild, executor.id, `Deleted server role: ${role.name}`);
  } catch (err) { console.error(err.message); }
});

// 4. הגנה מפני יצירת רולים המונית
client.on("roleCreate", async (role) => {
  try {
    const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate });
    const logEntry = logs.entries.first();
    if (!logEntry) return;

    const { executor } = logEntry;
    if (await shouldBypass(role.guild, executor.id)) return;

    if (isMassActionTriggered(executor.id, "role_create")) {
      await role.delete().catch(() => null);
      await punishUser(role.guild, executor.id, "Mass role creation spam");
    }
  } catch (err) { console.error(err.message); }
});

// 5. הגנות מתקדמות מבוססות Audit Log (הכוללות בדיקת מעקף של הרול)
client.on("guildAuditLogEntryCreate", async (auditLogEntry, guild) => {
  try {
    const { action, executorId } = auditLogEntry;
    if (!executorId) return;
    if (await shouldBypass(guild, executorId)) return;

    if (action === AuditLogEvent.EmojiDelete) {
      await punishUser(guild, executorId, "Deleted a server emoji");
    }

    if (action === AuditLogEvent.WebhookCreate || action === AuditLogEvent.WebhookDelete) {
      await punishUser(guild, executorId, "Unauthorized Webhook manipulation");
    }

    if (action === AuditLogEvent.GuildUpdate) {
      await punishUser(guild, executorId, "Attempted to modify crucial server settings (Name/Icon)");
    }

    if (action === AuditLogEvent.RoleUpdate) {
      const logs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate });
      const entry = logs.entries.first();
      if (entry) {
        const hasAdminUpdate = entry.changes.some(c => c.key === "permissions" && (BigInt(c.new) & PermissionFlagsBits.Administrator));
        if (hasAdminUpdate) {
          await punishUser(guild, executorId, "Granted dangerous Administrator permissions to a role");
        }
      }
    }

    if (action === AuditLogEvent.MemberBanAdd) {
      if (isMassActionTriggered(executorId, "mass_ban")) {
        await punishUser(guild, executorId, "Mass banning users (Nuke attempt)");
      }
    }

    if (action === AuditLogEvent.MemberKick) {
      if (isMassActionTriggered(executorId, "mass_kick")) {
        await punishUser(guild, executorId, "Mass kicking users (Nuke attempt)");
      }
    }

  } catch (err) { console.error(err.message); }
});

client.login(process.env.DISCORD_TOKEN);
