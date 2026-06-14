import express from "express";
import {
  Client,
  GatewayIntentBits,
  AuditLogEvent,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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

// הגדרת רולים ספציפיים לתארים בהודעות
const OWNER_ROLE_ID = "1496911471941259292";
const CO_OWNER_ROLE_ID = "1496911471941259290";
const HIGH_STAFF_ROLE_ID = "1496911471928410218";
const STAFF_ROLE_ID = "1496911471915962555";

// כל הרולים שמורשים לענות לקריאות ולצפות בטיקטים
const ALL_STAFF_IDS = [
  OWNER_ROLE_ID,
  CO_OWNER_ROLE_ID,
  HIGH_STAFF_ROLE_ID,
  STAFF_ROLE_ID
];

// מזהה קטגוריית הטיקטים שנתת לי
const TICKET_CATEGORY_ID = "1496911473392222231";

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

async function shouldBypass(guild, executorId) {
  if (executorId === guild.ownerId || executorId === client.user.id) return true;
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return false;
  return member.roles.cache.has(ALLOWED_DELETE_ROLE_ID);
}

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

// פקודות טקסט
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // 1. פקודת פאנל האימות
  if (message.content === "verify.panel") {
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
    return;
  }

  // 2. פקודת פאנל הטיקטים (ticket.panl / ticket.panel)
  if (message.content === "ticket.panl" || message.content === "ticket.panel") {
    try {
      await message.delete().catch(() => null);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_open_init")
          .setLabel("📩 לחץ כאן לפתיחת טיקט")
          .setStyle(ButtonStyle.Primary)
      );

      const embed = new EmbedBuilder()
        .setTitle("מערכת הטיקטים והתמיכה")
        .setDescription("צריך עזרה, רוצה להגיש תלונה או להציע שיתוף פעולה? לחץ על הכפתור למטה ובחר את נושא הפנייה שלך.")
        .setColor("#2f3136");

      await message.channel.send({ embeds: [embed], components: [row] });
    } catch (err) { console.error("[Ticket Panel Error]", err.message); }
    return;
  }

  // 3. פקודת מערכת העזרה (!h)
  if (message.content.startsWith("!h")) {
    try {
      const args = message.content.slice(2).trim();
      const reason = args.length > 0 ? args : "לא צוינה סיבה";

      await message.delete().catch(() => null);

      const embed = new EmbedBuilder()
        .setTitle("🚨 קריאת עזרה חדשה!")
        .setDescription(`המשתמש ${message.author} זקוק לעזרה של איש צוות במיידי.`)
        .addFields({ name: "📝 הסיבה לפנייה:", value: `\`\`\`${reason}\`\`\`` })
        .setColor("#ff0000")
        .setTimestamp()
        .setFooter({ text: `מזהה משתמש: ${message.author.id}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`help_claim_${message.author.id}`)
          .setLabel("🔒 קח אחריות על הקריאה")
          .setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
    } catch (err) { console.error("[Help Command Error]", err.message); }
  }
});

// אינטראקציות של כפתורים ותפריטים
client.on("interactionCreate", async (interaction) => {
  
  // א. טיפול בבחירת נושא הטיקט מתוך התפריט הנפתח (Select Menu)
  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_type_select") {
    try {
      await interaction.deferReply({ ephemeral: true });
      const choice = interaction.values[0]; // הנושא שנבחר
      const guild = interaction.guild;

      // יצירת מערך הרשאות לחדר הטיקט (רק הפותח והצוות יכולים לראות)
      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel], // חסימה לכולם
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], // אישור לפותח הטיקט
        }
      ];

      // הוספת הרשאות לכל אחד מרולי הצוות שהגדרת
      ALL_STAFF_IDS.forEach(roleId => {
        permissionOverwrites.push({
          id: roleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      });

      // יצירת ערוץ הטיקט תחת הקטגוריה המבוקשת
      const ticketChannel = await guild.channels.create({
        name: `🎫-${choice}-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: permissionOverwrites
      });

      // הודעת פתיחה יפה בתוך הטיקט
      const ticketEmbed = new EmbedBuilder()
        .setTitle(`טיקט בנושא: ${choice}`)
        .setDescription(`שלום ${interaction.user}, צוות השרת קיבל את פנייתך בנושא **${choice}**.\nאנא פרט את סיבת הפנייה כאן ונציג יתפנה אליך בהקדם.`)
        .setColor("#00ffea")
        .setTimestamp();

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("🔒 סגור טיקט")
          .setStyle(ButtonStyle.Danger)
      );

      // תיוג של פותח הטיקט והצוות כדי שיקבלו התראה
      const staffMentions = ALL_STAFF_IDS.map(id => `<@&${id}>`).join(" ");
      await ticketChannel.send({
        content: `${interaction.user} ${staffMentions}`,
        embeds: [ticketEmbed],
        components: [closeRow]
      });

      await interaction.editReply({ content: `✅ הטיקט שלך נפתח בהצלחה בחדר: ${ticketChannel}` });

    } catch (err) {
      console.error("[Create Ticket Error]", err.message);
      await interaction.editReply({ content: "❌ אירעה שגיאה ביצירת הטיקט, ודא שהגדרת את ה-ID של הקטגוריה נכון ושלבוט יש הרשאות ניהול חדרים." });
    }
    return;
  }

  if (!interaction.isButton()) return;

  // ב. לחיצה ראשונית על כפתור "פתיחת טיקט" (שולח את תפריט הבחירה)
  if (interaction.customId === "ticket_open_init") {
    try {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("ticket_type_select")
        .setPlaceholder("🎯 בחר את נושא הפנייה שלך...")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("בחינה לצוות").setValue("בחינה-לצוות").setDescription("הגשת מועמדות או בירור לגבי כניסה לצוות"),
          new StringSelectMenuOptionBuilder().setLabel("עזרה").setValue("עזרה").setDescription("תמיכה כללית או בעיה בשרת"),
          new StringSelectMenuOptionBuilder().setLabel("שת\"פ (שותפות)").setValue("שתפ").setDescription("סגירת שותפויות או פרויקטים"),
          new StringSelectMenuOptionBuilder().setLabel("תלונה").setValue("תלונה").setDescription("הגשת תלונה על משתמש או איש צוות")
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({
        content: "אנא בחר מהתפריט הבא את הנושא המתאים ביותר לפנייה שלך:",
        components: [row],
        ephemeral: true // נסתר לעיני המשתמש בלבד
      });
    } catch (err) { console.error(err); }
    return;
  }

  // ג. סגירת טיקט ומחיקת החדר
  if (interaction.customId === "ticket_close") {
    try {
      const member = interaction.member;
      const isStaff = ALL_STAFF_IDS.some(roleId => member.roles.cache.has(roleId)) || interaction.user.id === interaction.guild.ownerId;
      
      if (!isStaff) {
        return await interaction.reply({ content: "❌ רק צוות השרת מורשה לסגור את הטיקט!", ephemeral: true });
      }

      await interaction.reply({ content: "🔒 הטיקט ייסגר ויימחק בעוד כ-5 שניות..." });
      
      setTimeout(async () => {
        await interaction.channel.delete().catch(() => null);
      }, 5000);

    } catch (err) { console.error(err); }
    return;
  }

  // ד. כפתור האימות הישן והטוב
  if (interaction.customId === "verify_button") {
    try {
      const member = interaction.member;
      if (member.roles.cache.has(VERIFY_ROLE_ID)) {
        return await interaction.reply({ content: "אתה כבר מאומת בשרת!", ephemeral: true });
      }
      await member.roles.add(VERIFY_ROLE_ID);
      await interaction.reply({ content: "אוממת בהצלחה קיבלת גישה לחדרים", ephemeral: true });
    } catch (err) { console.error(err); }
    return;
  }

  // ה. כפתור מענה לקריאת עזרה (!h)
  if (interaction.customId.startsWith("help_claim_")) {
    try {
      const member = interaction.member;
      
      const hasPermission = ALL_STAFF_IDS.some(roleId => member.roles.cache.has(roleId)) || interaction.user.id === interaction.guild.ownerId;
      if (!hasPermission) {
        return await interaction.reply({
          content: "❌ אינך מורשה לטפל בקריאות עזרה. כפתור זה מיועד לצוות הניהול בלבד!",
          ephemeral: true
        });
      }

      let titlePrefix = "הצוות";
      if (member.roles.cache.has(OWNER_ROLE_ID) || interaction.user.id === interaction.guild.ownerId) {
        titlePrefix = "האוונר";
      } else if (member.roles.cache.has(CO_OWNER_ROLE_ID)) {
        titlePrefix = "הקו-אוונר";
      }

      const requesterId = interaction.customId.split("_")[2];
      
      const oldEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(oldEmbed)
        .setColor("#f1c40f") 
        .addFields({ name: "🤝 סטטוס טיפול:", value: `הקריאה נלקחה לטיפול על ידי ${titlePrefix} ${interaction.user}` });

      await interaction.update({
        embeds: [updatedEmbed],
        components: [] 
      });

      await interaction.channel.send({
        content: `👋 <@${requesterId}>, ${titlePrefix} ${interaction.user} איתך עכשיו ומטפל בפנייה שלך!`
      });

    } catch (err) { console.error("[Help Interaction Error]", err.message); }
  }
});

// ─── Anti-Nuke System Events ──────────────────────────────────────────────────

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
  // מניעת שחזור אוטומטי אם חדר הטיקט עצמו נמחק על ידי הצוות בצורה מסודרת
  if (channel.parentId === TICKET_CATEGORY_ID) return;
  
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

client.on("channelCreate", async (channel) => {
  if (!channel.guild) return;
  // התעלמות מיצירת חדרים המתרחשת בתוך קטגוריית הטיקטים כדי לא להפעיל את ה-Anti-Nuke בטעות
  if (channel.parentId === TICKET_CATEGORY_ID) return;

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
