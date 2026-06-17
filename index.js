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
const ALLOWED_DELETE_ROLE_ID = "1515409287676035228"; 
const VERIFY_ROLE_ID = "1496911471915962552";        

// הגדרת רולים ספציפיים לתארים בהודעות
const OWNER_ROLE_ID = "1496911471941259292";
const CO_OWNER_ROLE_ID = "1496911471941259290";
const HIGH_STAFF_ROLE_ID = "1496911471928410218";
const STAFF_ROLE_ID = "1496911471915962555";

// כל הרולים שמורשים קבוע לראות את חדרי הטיקטים
const ALL_STAFF_IDS = [
  OWNER_ROLE_ID,
  CO_OWNER_ROLE_ID,
  HIGH_STAFF_ROLE_ID,
  STAFF_ROLE_ID
];

// רולים שמורשים לסגור טיקטים (בנוסף לאדמיניסטרטורים)
const TICKET_CLOSE_ROLES = [HIGH_STAFF_ROLE_ID, STAFF_ROLE_ID];

// רולים שמקבלים תיוג (Ping) בפתיחת טיקט חדש (רק High Staff ו-Staff!)
const TICKET_PING_ROLES = [HIGH_STAFF_ROLE_ID, STAFF_ROLE_ID];

// מזהי חדרים וקטגוריות
const TICKET_CATEGORY_ID = "1496911473392222231";
const WELCOME_CHANNEL_ID = "1496911473392222230"; 
const XP_CHECK_CHANNEL_ID = "1516794753839009832"; // החדר היחיד המורשה לבדיקה

const MAX_ACTIONS_ALLOWED = 3; 
const ACTION_RESET_TIME = 10000; 

const userActionLog = new Map();

// בסיס נתונים זמני בזיכרון עבור מערכת ה-XP
const xpDatabase = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ─── Helper Functions ────────────────────────────────────────────────────────

function getUserXP(userId) {
  if (!xpDatabase.has(userId)) {
    xpDatabase.set(userId, 0);
  }
  return xpDatabase.get(userId);
}

function addComponentsXP(userId, amount) {
  const currentXp = getUserXP(userId);
  xpDatabase.set(userId, Math.max(0, currentXp + amount));
}

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

// ─── Loops / Timers ──────────────────────────────────────────────────────────

// מערכת XP קולית - טיימר הרץ כל 60 שניות (דקה אחת)
setInterval(() => {
  try {
    client.guilds.cache.forEach(guild => {
      guild.channels.cache.forEach(channel => {
        if (channel.type === ChannelType.GuildVoice && channel.members.size > 1) {
          channel.members.forEach(member => {
            if (member.user.bot || member.voice.selfMute || member.voice.selfDeaf) return;

            // 3 דקות = 100 XP, לכן דקה 1 = 33.33 XP
            const xpPerMinute = 100 / 3;
            addComponentsXP(member.id, xpPerMinute);
          });
        }
      });
    });
  } catch (err) {
    console.error("[Voice XP Loop Error]", err.message);
  }
}, 60000);

// ─── Events ───────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);
  await syncAllMembers();
});

// מערכת וולקום - כניסת משתמש חדש לשרת
client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) return;

    const memberCount = member.guild.memberCount;

    const welcomeEmbed = new EmbedBuilder()
      .setTitle("👋 ברוך הבא לשרת!")
      .setDescription(`ברוכה הבאה לשרת לשרת שלנו מקווים שתהנה בשרת **PrimeZone** אתה המספר בשרת **${memberCount}** ואז השם שלו ${member}`)
      .setColor("#00ffea")
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [welcomeEmbed] });
  } catch (err) {
    console.error("[Welcome System Error]", err.message);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  await updateMemberNickname(newMember).catch(() => null);
});

// פקודות טקסט ומערכת הודעות XP
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // הוספת 5 XP על כל הודעה שנשלחת בצורה אוטומטית
  if (message.guild) {
    addComponentsXP(message.author.id, 5);
  }

  // פקודת !h לבדיקת אקס פי לעצמי או לאחרים
  if (message.content.startsWith("!h")) {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

      // הגבלת חדר קשוחה: לא מאפשר לאף אחד חוץ מאדמיניסטרטורים להשתמש מחוץ לחדר ה-XP
      if (message.channel.id !== XP_CHECK_CHANNEL_ID && !hasAdmin) {
        const warning = await message.reply("❌ ניתן להשתמש בפקודה הזו רק בחדר בדיקת ה-XP הייעודי!");
        setTimeout(() => { message.delete().catch(() => null); warning.delete().catch(() => null); }, 5000);
        return;
      }

      const target = message.mentions.members.first();

      // אם יש תיוג של מישהו אחר (!h @user), מוודאים שרק צוות יכול לבדוק
      if (target && target.id !== member.id) {
        const isStaff = member.roles.cache.has(STAFF_ROLE_ID) || member.roles.cache.has(HIGH_STAFF_ROLE_ID) || message.author.id === message.guild.ownerId;
        if (!hasAdmin && !isStaff) {
          return await message.reply("❌ רק דרגות Staff ,High Staff או Administrator מורשים לבדוק XP של משתמשים אחרים!");
        }
      }

      // אם לא תויג אף אחד, הבדיקה היא לעצמו (!h)
      const finalTarget = target || member;
      const totalXp = Math.floor(getUserXP(finalTarget.id));

      const xpEmbed = new EmbedBuilder()
        .setTitle("📊 סטטיסטיקת XP")
        .setDescription(finalTarget.id === member.id 
          ? `יש לך כעת **${totalXp.toLocaleString()} XP** בשרת.`
          : `המשתמש ${finalTarget} מחזיק כעת ב-**${totalXp.toLocaleString()} XP** בשרת.`
        )
        .setColor("#f1c40f")
        .setTimestamp();

      await message.channel.send({ embeds: [xpEmbed] });
    } catch (err) { console.error(err); }
    return;
  }

  // פקודת !addxp @user [כמות] (הנהלה בלבד)
  if (message.content.startsWith("!addxp")) {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const isManagement = member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(CO_OWNER_ROLE_ID) || message.author.id === message.guild.ownerId;

      if (!hasAdmin && !isManagement) {
        return await message.reply("❌ רק Owner, Co-Owner או מנהלים עם הרשאת Administrator מורשים להוסיף XP!");
      }

      const args = message.content.split(" ");
      const target = message.mentions.members.first();
      const amount = parseInt(args[2]);

      if (!target || isNaN(amount) || amount <= 0) {
        return await message.reply("❌ שימוש שגוי בפקודה. מבנה נכון: `!addxp @שם_משתמש [כמות]`");
      }

      addComponentsXP(target.id, amount);
      await message.reply(`✅ נוספו בהצלחה **${amount.toLocaleString()} XP** למשתמש ${target}. סך הכל כעת: **${Math.floor(getUserXP(target.id)).toLocaleString()} XP**.`);
    } catch (err) { console.error(err); }
    return;
  }

  // פקודת !removexp @user [כמות] (הנהלה בלבד)
  if (message.content.startsWith("!removexp")) {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const isManagement = member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(CO_OWNER_ROLE_ID) || message.author.id === message.guild.ownerId;

      if (!hasAdmin && !isManagement) {
        return await message.reply("❌ רק Owner, Co-Owner או מנהלים עם הרשאת Administrator מורשים להוריד XP!");
      }

      const args = message.content.split(" ");
      const target = message.mentions.members.first();
      const amount = parseInt(args[2]);

      if (!target || isNaN(amount) || amount <= 0) {
        return await message.reply("❌ שימוש שגוי בפקודה. מבנה נכון: `!removexp @שם_משתמש [כמות]`");
      }

      addComponentsXP(target.id, -amount);
      await message.reply(`🔻 הוסרו בהצלחה **${amount.toLocaleString()} XP** מהמשתמש ${target}. סך הכל כעת: **${Math.floor(getUserXP(target.id)).toLocaleString()} XP**.`);
    } catch (err) { console.error(err); }
    return;
  }

  // פאנל אימות (Verify)
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

  // פאנל טיקטים (Ticket)
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
});

// אינטראקציות (Buttons / Select Menus)
client.on("interactionCreate", async (interaction) => {
  
  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_type_select") {
    try {
      await interaction.deferReply({ ephemeral: true });
      const choice = interaction.values[0]; 
      const guild = interaction.guild;

      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel], 
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory], 
        }
      ];

      ALL_STAFF_IDS.forEach(roleId => {
        permissionOverwrites.push({
          id: roleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      });

      const ticketChannel = await guild.channels.create({
        name: `🎫-${choice}-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: permissionOverwrites
      });

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`טיקט בנושא: ${choice}`)
        .setDescription(`שלום ${interaction.user}, צוות השרת קיבל את פנייתך בנושא **${choice}**.\nאנא פרט את סיבת הפנייה כאן ונציג יתפנה אליך בהקדם.`)
        .setColor("#00ffea")
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_claim_${interaction.user.id}`)
          .setLabel("🤝 קח אחריות על הטיקט")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("🔒 סגור טיקט")
          .setStyle(ButtonStyle.Danger)
      );

      const staffMentions = TICKET_PING_ROLES.map(id => `<@&${id}>`).join(" ");
      
      await ticketChannel.send({
        content: `${interaction.user} ${staffMentions}`,
        embeds: [ticketEmbed],
        components: [actionRow]
      });

      await interaction.editReply({ content: `✅ הטיקט שלך נפתח בהצלחה בחדר: ${ticketChannel}` });

    } catch (err) {
      console.error("[Create Ticket Error]", err.message);
      await interaction.editReply({ content: "❌ אירעה שגיאה ביצירת הטיקט." });
    }
    return;
  }

  if (!interaction.isButton()) return;

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
        ephemeral: true 
      });
    } catch (err) { console.error(err); }
    return;
  }

  if (interaction.customId.startsWith("ticket_claim_")) {
    try {
      const member = interaction.member;
      
      const hasPermission = 
        ALL_STAFF_IDS.some(roleId => member.roles.cache.has(roleId)) || 
        interaction.user.id === interaction.guild.ownerId ||
        member.permissions.has(PermissionFlagsBits.Administrator);
      
      if (!hasPermission) {
        return await interaction.reply({ content: "❌ רק צוות השרת או משתמשים עם הרשאת Administrator מורשים לקחת אחריות על טיקטים!", ephemeral: true });
      }

      const requesterId = interaction.customId.split("_")[2];
      const oldEmbed = interaction.message.embeds[0];

      const updatedEmbed = EmbedBuilder.from(oldEmbed)
        .addFields({ name: "📌 סטטוס טיקט:", value: `הטיקט נלקח לטיפול על ידי המנהל/איש הצוות ${interaction.user}` })
        .setColor("#2ecc71");

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_claimed_by_${interaction.user.id}`)
          .setLabel("✔ הטיקט בטיפול")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true), 
        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("🔒 סגור טיקט")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
      await interaction.channel.send({ content: `💼 **הטיקט נלקח לטיפול:** ${interaction.user} יעזור לך כעת, <@${requesterId}>.` });

    } catch (err) { console.error(err); }
    return;
  }

  if (interaction.customId === "ticket_close") {
    try {
      const member = interaction.member;
      
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const hasAllowedRole = TICKET_CLOSE_ROLES.some(roleId => member.roles.cache.has(roleId)) || interaction.user.id === interaction.guild.ownerId;

      if (!hasAdmin && !hasAllowedRole) {
        return await interaction.reply({ content: "❌ רק דרגות High Staff ,Staff או משתמשים עם הרשאת Administrator מורשים לסגור את הטיקט!", ephemeral: true });
      }

      await interaction.reply({ content: "🔒 הטיקט נסגר על ידי הצוות ויימחק לצמיתות בעוד כ-5 שניות..." });
      
      setTimeout(async () => {
        await interaction.channel.delete().catch(() => null);
      }, 5000);

    } catch (err) { console.error(err); }
    return;
  }

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
});

// ─── Anti-Nuke System Events ──────────────────────────────────────────────────

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;
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
