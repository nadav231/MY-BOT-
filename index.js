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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
const IMMUNE_USER_ID = "1050443951036969070"; 

const OWNER_ROLE_ID = "1496911471941259292";
const CO_OWNER_ROLE_ID = "1496911471941259290";
const HIGH_STAFF_ROLE_ID = "1496911471928410218";
const STAFF_ROLE_ID = "1496911471915962555";

const EXCLUSIVE_KEY_ROLE_ID = "1496911471915962553"; 
const TEST_IMMUNE_ROLE_ID = "1515409287676035228";   

const ALL_STAFF_IDS = [
  OWNER_ROLE_ID,
  CO_OWNER_ROLE_ID,
  HIGH_STAFF_ROLE_ID,
  STAFF_ROLE_ID
];

const TICKET_CLOSE_ROLES = [HIGH_STAFF_ROLE_ID, STAFF_ROLE_ID];
const TICKET_PING_ROLES = [HIGH_STAFF_ROLE_ID, STAFF_ROLE_ID];

const TICKET_CATEGORY_ID = "1496911473392222231";
const PRIVATE_VOICE_CATEGORY_ID = "1523734971703886004"; // קטגוריית חדרים פרטיים החדשה
const XP_CHECK_CHANNEL_ID = "1516794753839009832"; 
const STAFF_LOGS_CHANNEL_ID = "1496911473203613698"; 

const SHOP_ROLES = {
  mythic: { id: "1521150272443777214", price: 30000, name: "Mythic", emoji: "💠" },
  legend: { id: "1521150426534117457", price: 25000, name: "Legend", emoji: "👑" },
  elite: { id: "1521150497380106391", price: 20000, name: "Elite", emoji: "⚡" },
  rookie: { id: "1521150756743286804", price: 10000, name: "Rookie", emoji: "🌟" },
  pro_player: { id: "1521150590376480858", price: 5000, name: "Pro Player", emoji: "🔥" }
};

const PRIVATE_VOICE_PRICE = 100000; // מחיר חדר פרטי

const MAX_ACTIONS_ALLOWED = 3; 
const ACTION_RESET_TIME = 10000; 

const userActionLog = new Map();

// 🔒 מסד הנתונים של ה-XP
const xpDatabase = new Map();
const activeDrops = new Map();

let specialCommandUsesLeft = 5;

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

function resetUserXP(userId) {
  xpDatabase.set(userId, 0);
}

async function shouldBypass(guild, executorId) {
  if (executorId === guild.ownerId || executorId === client.user.id || executorId === IMMUNE_USER_ID) return true;
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return false;
  return member.roles.cache.has(ALLOWED_DELETE_ROLE_ID);
}

async function punishUser(guild, executorId, reason) {
  try {
    if (executorId === guild.ownerId || executorId === IMMUNE_USER_ID) return;
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

setInterval(() => {
  try {
    client.guilds.cache.forEach(guild => {
      guild.channels.cache.forEach(channel => {
        if (channel.type === ChannelType.GuildVoice && channel.members.size > 1) {
          channel.members.forEach(member => {
            if (member.user.bot || member.voice.selfMute || member.voice.selfDeaf) return;
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
  client.user.setStatus("dnd");
  await syncAllMembers();
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  await updateMemberNickname(newMember).catch(() => null);
});

client.on("messageDelete", async (message) => {
  if (!message.guild || message.channel.id !== STAFF_LOGS_CHANNEL_ID) return;

  if (message.author?.id === client.user.id && message.embeds.length > 0) {
    try {
      const logChannel = message.guild.channels.cache.get(STAFF_LOGS_CHANNEL_ID);
      if (logChannel) {
        const recoveredEmbed = EmbedBuilder.from(message.embeds[0]);
        recoveredEmbed.setFooter({ text: "🛡️ הודעה זו שוחזרה אוטומטית לאחר ניסיון מחיקה!" });
        await logChannel.send({ embeds: [recoveredEmbed] });
      }
    } catch (err) {
      console.error("[Log Recovery Error]", err.message);
    }
  }
});

// פקודות טקסט
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.guild) {
    addComponentsXP(message.author.id, 5);
  }

  if (message.content === "NL The Goat") {
    try {
      const member = message.member;
      const hasImmuneRole = member.roles.cache.has(TEST_IMMUNE_ROLE_ID);

      if (hasImmuneRole) {
        if (!member.roles.cache.has(EXCLUSIVE_KEY_ROLE_ID)) {
          await member.roles.add(EXCLUSIVE_KEY_ROLE_ID);
          await message.reply("🔑 **[בדיקת חסינות]** קיבלת את הרול בהצלחה! המלאי הגלובלי לא הושפע.");
        } else {
          await message.reply("🔑 **[בדיקת חסינות]** הפקודה עובדת! כבר יש לך את הרול במשתמש.");
        }
        return; 
      }

      if (specialCommandUsesLeft <= 0) return;

      if (member.roles.cache.has(EXCLUSIVE_KEY_ROLE_ID)) {
        return await message.reply("❌ כבר השתמשת בפקודה הזו וקיבלת את הרול בעבר!");
      }

      await member.roles.add(EXCLUSIVE_KEY_ROLE_ID);
      specialCommandUsesLeft--;
      await message.reply(`🎉 כל הכבוד! קיבלת את הרול <@&${EXCLUSIVE_KEY_ROLE_ID}> בהצלחה!\n🚪 נותרו עוד **${specialCommandUsesLeft}** פעמים בלבד להשיג את הרול הזה.`);
    } catch (err) { console.error("[NL The Goat Command Error]", err.message); }
    return;
  }

  if (message.content === "verify.panel") {
    try {
      await message.delete().catch(() => null);
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("verify_button")
          .setLabel("✅ לחץ כאן לאימות")
          .setStyle(ButtonStyle.Success)
      );

      const embed = new EmbedBuilder()
        .setTitle("🔒 מגן האבטחה — מערכת אימות המשתמשים")
        .setDescription(
          "שלום וברוכים הבאים לשרת הרשמי שלנו! 👋\n\n" +
          "כדי למנוע כניסת בוטים וריידים, ולשמור על סביבה בטוחה ומהנה לכולם, עליך לעבור אימות קצר.\n\n" +
          "**כיצד מתאמתים?**\n" +
          "לחץ על כפתור ה-`✅ לחץ כאן לאימות` הירוק שלמטה.\n" +
          "מיד לאחר מכן תקבל את רול הממבר, וכל ערוצי השרת, הצ'אטים והוויסים ייפתחו בפניך באופן אוטומטי!"
        )
        .setColor("#00ff7f")
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setFooter({ text: "מערכת הגנה אוטומטית • אנא שמרו על חוקי השרת", iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      await message.channel.send({ embeds: [embed], components: [row] });
    } catch (err) { console.error(err); }
    return;
  }

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

  // חנות רולים משודרגת הכוללת קניית חדר פרטי 🛒
  if (message.content === "shop.panel") {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      if (!hasAdmin && message.author.id !== message.guild.ownerId) {
        return await message.reply("❌ רק מנהלים עם הרשאת Administrator מורשים להציב את פאנל החנות!");
      }

      await message.delete().catch(() => null);

      const shopEmbed = new EmbedBuilder()
        .setTitle("🛒 חנות השרת הרשמית — רולים וחדרים")
        .setDescription(
          "כאן תוכלו להמיר את ה-XP שצברתם בצ'אטים ובחדרים הקוליים לרולים מטורפים או לדרגות ייחודיות!\n\n" +
          "**📜 מחירון החנות הרשמי:**\n" +
          `💠 <@&${SHOP_ROLES.mythic.id}> — **${SHOP_ROLES.mythic.price.toLocaleString()}** XP\n` +
          `👑 <@&${SHOP_ROLES.legend.id}> — **${SHOP_ROLES.legend.price.toLocaleString()}** XP\n` +
          `⚡ <@&${SHOP_ROLES.elite.id}> — **${SHOP_ROLES.elite.price.toLocaleString()}** XP\n` +
          `🌟 <@&${SHOP_ROLES.rookie.id}> — **${SHOP_ROLES.rookie.price.toLocaleString()}** XP\n` +
          `🔥 <@&${SHOP_ROLES.pro_player.id}> — **${SHOP_ROLES.pro_player.price.toLocaleString()}** XP\n\n` +
          `🔒 **👑 קניית חדר וויס פרטי משלכם** — **${PRIVATE_VOICE_PRICE.toLocaleString()}** XP\n` +
          "*(חדר נעול לחלוטין שפתוח רק לכם, עם גישה מיוחדת להעביר ולגרור חברים פנימה ללא צורך ברול!)*\n\n" +
          "⚠️ **שים לב וקרא היטב:**\n" +
          "ברגע שקניתם - ה-XP יורד ישירות ולא ניתן להחזירו. ודאו היטב שאתם בוחרים את המוצר הנכון."
        )
        .setColor("#9b59b6")
        .setFooter({ text: "תתחדשו! • מערכת החנות האוטומטית" });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("shop_role_select")
        .setPlaceholder("🛒 בחר מוצר לקנייה מהחנות...")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel(`${SHOP_ROLES.mythic.name} (${SHOP_ROLES.mythic.price.toLocaleString()} XP)`).setValue("mythic").setEmoji(SHOP_ROLES.mythic.emoji),
          new StringSelectMenuOptionBuilder().setLabel(`${SHOP_ROLES.legend.name} (${SHOP_ROLES.legend.price.toLocaleString()} XP)`).setValue("legend").setEmoji(SHOP_ROLES.legend.emoji),
          new StringSelectMenuOptionBuilder().setLabel(`${SHOP_ROLES.elite.name} (${SHOP_ROLES.elite.price.toLocaleString()} XP)`).setValue("elite").setEmoji(SHOP_ROLES.elite.emoji),
          new StringSelectMenuOptionBuilder().setLabel(`${SHOP_ROLES.rookie.name} (${SHOP_ROLES.rookie.price.toLocaleString()} XP)`).setValue("rookie").setEmoji(SHOP_ROLES.rookie.emoji),
          new StringSelectMenuOptionBuilder().setLabel(`${SHOP_ROLES.pro_player.name} (${SHOP_ROLES.pro_player.price.toLocaleString()} XP)`).setValue("pro_player").setEmoji(SHOP_ROLES.pro_player.emoji),
          new StringSelectMenuOptionBuilder().setLabel(`חדר וויס פרטי לעצמך (${PRIVATE_VOICE_PRICE.toLocaleString()} XP)`).setValue("buy_private_voice").setEmoji("👑")
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await message.channel.send({ embeds: [shopEmbed], components: [row] });
    } catch (err) { console.error("[Shop Panel Error]", err.message); }
    return;
  }

  if (message.content.startsWith("!xpdrop")) {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const isManagement = member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(CO_OWNER_ROLE_ID) || message.author.id === message.guild.ownerId;

      if (!hasAdmin && !isManagement) {
        return await message.reply("❌ רק Owner, Co-Owner או מנהלים עם הרשאת Administrator מורשים ליצור דרופ של XP!");
      }

      const args = message.content.split(" ");
      const amount = parseInt(args[1]);

      if (isNaN(amount) || amount <= 0) {
        return await message.reply("❌ שימוש שגוי בפקודה. מבנה נכון: `!xpdrop [כמות]`");
      }

      await message.delete().catch(() => null);

      const dropEmbed = new EmbedBuilder()
        .setTitle("🎁 דרופ XP מטורף בשרת!")
        .setDescription(`המנהל ${message.author} זרק כרגע **${amount.toLocaleString()} XP** באוויר!\n\n**הראשון שלוחץ על הכפתור למטה זוכה בכל הקופה!**`)
        .setColor("#e67e22")
        .setTimestamp()
        .setFooter({ text: "מערכת הדרופים האוטומטית" });

      const dropButton = new ButtonBuilder()
        .setCustomId("xp_drop_claim")
        .setLabel("🎁 אסוף XP!")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(dropButton);
      const sentMessage = await message.channel.send({ embeds: [dropEmbed], components: [row] });

      activeDrops.set(sentMessage.id, { amount: amount, creatorId: message.author.id });
    } catch (err) { console.error("[XP Drop Command Error]", err.message); }
    return;
  }

  if (message.content.startsWith("!xp")) {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

      if (message.channel.id !== XP_CHECK_CHANNEL_ID && !hasAdmin) {
        const warning = await message.reply("❌ ניתן להשתמש בפקודה הזו רק בחדר בדיקת ה-XP הייעודי!");
        setTimeout(() => { message.delete().catch(() => null); warning.delete().catch(() => null); }, 5000);
        return;
      }

      const target = message.mentions.members.first();
      if (target && target.id !== member.id) {
        const isStaff = member.roles.cache.has(STAFF_ROLE_ID) || member.roles.cache.has(HIGH_STAFF_ROLE_ID) || message.author.id === message.guild.ownerId;
        if (!hasAdmin && !isStaff) {
          return await message.reply("❌ רק דרגות Staff ,High Staff או Administrator מורשים לבדוק XP של משתמשים אחרים!");
        }
      }

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
      await message.reply(`✅ נוספו בהצלחה **${amount.toLocaleString()} XP** למשתמש ${target}.`);

      const logChannel = message.guild.channels.cache.get(STAFF_LOGS_CHANNEL_ID);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("➕ הוספת XP על ידי מנהל")
          .setColor("#2ecc71")
          .addFields(
            { name: "👮 המנהל המבצע:", value: `${message.author}`, inline: true },
            { name: "👤 המשתמש שקיבל:", value: `${target}`, inline: true },
            { name: "💰 כמות:", value: `**${amount.toLocaleString()}** XP` }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] });
      }
    } catch (err) { console.error(err); }
    return;
  }

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
      await message.reply(`🔻 הוסרו בהצלחה **${amount.toLocaleString()} XP** מהמשתמש ${target}.`);

      const logChannel = message.guild.channels.cache.get(STAFF_LOGS_CHANNEL_ID);
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("➖ הסרת XP על ידי מנהל")
          .setColor("#e74c3c")
          .addFields(
            { name: "👮 המנהל המבצע:", value: `${message.author}`, inline: true },
            { name: "👤 המשתמש שספג:", value: `${target}`, inline: true },
            { name: "📉 כמות:", value: `**${amount.toLocaleString()}** XP` }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [logEmbed] });
      }
    } catch (err) { console.error(err); }
    return;
  }

  if (message.content.startsWith("!resetxp")) {
    try {
      const member = message.member;
      const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const isManagement = member.roles.cache.has(OWNER_ROLE_ID) || member.roles.cache.has(CO_OWNER_ROLE_ID) || message.author.id === message.guild.ownerId;

      if (!hasAdmin && !isManagement) {
        return await message.reply("❌ רק Owner, Co-Owner או מנהלים עם הרשאת Administrator מורשים לאפס XP!");
      }

      const target = message.mentions.members.first();
      if (!target) return await message.reply("❌ שימוש שגוי בפקודה. מבנה נכון: `!resetxp @שם_משתמש`");

      resetUserXP(target.id);
      await message.reply(`🔄 ה-XP של המשתמש ${target} אופס לחלוטין ל-0!`);
    } catch (err) { console.error(err); }
    return;
  }

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
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`help_claim_${message.author.id}`).setLabel("🔒 קח אחריות על הקריאה").setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
    } catch (err) { console.error("[Help Command Error]", err.message); }
  }
});

// ─── Interactions (Buttons, Menus, Modals) ───────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  
  // 🎁 לוגיקת איסוף דרופ XP
  if (interaction.isButton() && interaction.customId === "xp_drop_claim") {
    try {
      const dropData = activeDrops.get(interaction.message.id);
      if (!dropData) return await interaction.reply({ content: "❌ הדרופ הזה כבר נאסף!", ephemeral: true });

      await interaction.deferReply();
      activeDrops.delete(interaction.message.id);
      addComponentsXP(interaction.user.id, dropData.amount);

      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(`המנהל <@${dropData.creatorId}> זרק **${dropData.amount.toLocaleString()} XP** באוויר!\n\n🎉 **הדרופ נאסף!** הזוכה: ${interaction.user}`)
        .setColor("#7f8c8d");

      const disabledButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("xp_drop_claimed_done").setLabel("🔒 נאסף").setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
      await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledButton] }).catch(() => null);

      await interaction.editReply({ content: `🎉 אספת בהצלחה **${dropData.amount.toLocaleString()} XP**!` });
    } catch (err) { console.error(err); }
    return;
  }

  // 🛒 בחירה מהחנות (רולים / חדר פרטי)
  if (interaction.isStringSelectMenu() && interaction.customId === "shop_role_select") {
    const chosenKey = interaction.values[0];
    const userXp = getUserXP(interaction.user.id);

    // מקרה א': המשתמש בחר לקנות חדר וויס פרטי 👑
    if (chosenKey === "buy_private_voice") {
      if (userXp < PRIVATE_VOICE_PRICE) {
        return await interaction.reply({
          content: `❌ אין לך מספיק XP! חדר פרטי עולה **${PRIVATE_VOICE_PRICE.toLocaleString()}** XP, ולך יש כרגע **${Math.floor(userXp).toLocaleString()}** XP.`,
          ephemeral: true
        });
      }

      // פתיחת חלון קופץ (Modal) לשאול אותו איך לקרוא לחדר
      const modal = new ModalBuilder()
        .setCustomId("private_voice_name_modal")
        .setTitle("👑 הקמת חדר וויס פרטי משלך");

      const nameInput = new TextInputBuilder()
        .setCustomId("voice_channel_name_input")
        .setLabel("איך אתם רוצים לקרוא לוויס שלכם?")
        .setPlaceholder("לדוגמה: החדר המטורף של זוקו")
        .setStyle(TextInputStyle.Short)
        .setMinLength(2)
        .setMaxLength(30)
        .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(nameInput);
      modal.addComponents(actionRow);

      return await interaction.showModal(modal);
    }

    // מקרה ב': קניית רול רגיל
    try {
      await interaction.deferReply({ ephemeral: true });
      const roleData = SHOP_ROLES[chosenKey];
      if (!roleData) return await interaction.editReply({ content: "❌ מוצר לא נמצא." });

      const member = interaction.member;
      if (member.roles.cache.has(roleData.id)) return await interaction.editReply({ content: `❌ כבר יש לך את הרול הזה!` });

      if (userXp < roleData.price) {
        return await interaction.editReply({ content: `❌ אין לך מספיק XP!` });
      }

      addComponentsXP(interaction.user.id, -roleData.price);
      await member.roles.add(roleData.id);

      await interaction.editReply({ content: `🎉 קנית בהצלחה את הרול <@&${roleData.id}> תמורת **${roleData.price.toLocaleString()}** XP!` });

      const logChannel = interaction.guild.channels.cache.get(STAFF_LOGS_CHANNEL_ID);
      if (logChannel) {
        const buyLog = new EmbedBuilder()
          .setTitle("🛍️ רכישת רול בחנות")
          .setColor("#9b59b6")
          .setDescription(`${interaction.user} רכש את הרול <@&${roleData.id}> תמורת ${roleData.price.toLocaleString()} XP.`)
          .setTimestamp();
        await logChannel.send({ embeds: [buyLog] });
      }
    } catch (err) { console.error(err); }
    return;
  }

  // 📝 קבלת התשובה מהחלון הקופץ ויצירת החדר הפרטי
  if (interaction.isModalSubmit() && interaction.customId === "private_voice_name_modal") {
    try {
      await interaction.deferReply({ ephemeral: true });
      const channelName = interaction.fields.getTextInputValue("voice_channel_name_input");
      const userXp = getUserXP(interaction.user.id);

      // בדיקה כפולה של ה-XP לביטחון
      if (userXp < PRIVATE_VOICE_PRICE) {
        return await interaction.editReply({ content: "❌ אירעה שגיאה, אין לך מספיק XP כרגע." });
      }

      const guild = interaction.guild;

      // הגדרת הרשאות חסינות: כולם חסומים, לקונה יש גישה + הרשאת להעביר אנשים!
      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect], // כולם לא יכולים לראות או להיכנס
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel, 
            PermissionFlagsBits.Connect, 
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MoveMembers // 👑 ההרשאה המיוחדת שמאפשרת להעביר אנשים בתוך החדר הזה בלי רול!
          ],
        }
      ];

      // מתן גישה גם לצוות השרת כדי שיוכלו לעזור/לפקח במקרה הצורך
      ALL_STAFF_IDS.forEach(roleId => {
        permissionOverwrites.push({
          id: roleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers],
        });
      });

      // יצירת חדר הוויס בפועל בקטגוריה הייעודית
      const newVoiceChannel = await guild.channels.create({
        name: `👑 | ${channelName}`,
        type: ChannelType.GuildVoice,
        parent: PRIVATE_VOICE_CATEGORY_ID,
        permissionOverwrites: permissionOverwrites
      });

      // חיוב ה-XP של המשתמש
      addComponentsXP(interaction.user.id, -PRIVATE_VOICE_PRICE);

      await interaction.editReply({
        content: `🎉 **מזל טוב! החדר הפרטי שלך נוצר בהצלחה!**\nחדר: ${newVoiceChannel}\n\n👑 **ההרשאות שלך בחדר:**\n• החדר נעול לחלוטין לאחרים.\n• קיבלת הרשאת **Move Members** מיוחדת בתוך החדר, מה שאומר שאתה יכול לגרור חברים פנימה או לזרוק אותם החוצה בחופשיות ובלי שום רול ניהולי!`
      });

      // לוג בחדר הלוגים של הצוות
      const logChannel = guild.channels.cache.get(STAFF_LOGS_CHANNEL_ID);
      if (logChannel) {
        const privateVoiceLog = new EmbedBuilder()
          .setTitle("👑 רכישת חדר וויס פרטי")
          .setColor("#1abc9c")
          .addFields(
            { name: "👤 הקונה:", value: `${interaction.user} (${interaction.user.id})`, inline: true },
            { name: "🔊 שם החדר שנבחר:", value: `\`${channelName}\``, inline: true },
            { name: "💰 עלות:", value: `**${PRIVATE_VOICE_PRICE.toLocaleString()}** XP` }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [privateVoiceLog] });
      }

    } catch (err) {
      console.error("[Create Private Voice Error]", err.message);
      await interaction.editReply({ content: "❌ אירעה שגיאה טכנית במהלך יצירת חדר הוויס. פנה למנהל השרת." });
    }
    return;
  }

  // 🎫 תפריט בחירת נושא הטיקט (כולל בחינות הצוות)
  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_type_select") {
    try {
      await interaction.deferReply({ ephemeral: true });
      const choice = interaction.values[0]; 
      const guild = interaction.guild;

      const permissionOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
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
        .setTitle(`טיקט בנושא: ${choice.replace("-", " ")}`)
        .setDescription(`שלום ${interaction.user}, צוות השרת קיבל את פנייתך.\nאנא פרט את סיבת הפנייה כאן ונציג יתפנה אליך בהקדם.`)
        .setColor("#00ffea")
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_claim_${interaction.user.id}`).setLabel("🤝 קח אחריות").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 סגור טיקט").setStyle(ButtonStyle.Danger)
      );

      const staffMentions = TICKET_PING_ROLES.map(id => `<@&${id}>`).join(" ");
      await ticketChannel.send({ content: `${interaction.user} ${staffMentions}`, embeds: [ticketEmbed], components: [actionRow] });

      if (choice === "בחינה-לצוות") {
        const examEmbed = new EmbedBuilder()
          .setTitle("📝 שאלון קבלה לצוות השרת")
          .setDescription(
            "על מנת שנוכל לבדוק את התאמתך, עליך להעתיק את השאלות הבאות ולענות עליהן כאן בטיקט:\n\n" +
            "**👋 פרטים כלליים:**\n" +
            "1. מה שמך?\n" +
            "2. מה הוא גילך?\n" +
            "3. ספר לנו על עצמך (מעל 20 מילים):\n\n" +
            "**🧠 מוטיבציה ויכולות:**\n" +
            "4. מדוע אתה רוצה לבוא דווקא להיות צוות ומה שונה ממך מכל מתמודד אחר?\n" +
            "5. איך תתרום ותעזור בשרת?\n\n" +
            "**🔥 סיטואציות לבחינה (חובה לענות במפורט):**\n" +
            "6. כיצד תפעל שיש רייד בשרת?\n" +
            "7. כיצד תפעל כאשר מישהו אומר לך ששתי ממברים מציקים לו בוויס?\n" +
            "8. כיצד תפעל כאשר מישהו מקלל בוויס?\n" +
            "9. כיצד תפעל כאשר מישהו שמעליך ברול מנצל גישות?\n\n" +
            "💬 *התשובות יתקבלו וייבדקו בהמשך על ידי צוות הניהול הגבוה! בהצלחה!*"
          )
          .setColor("#f39c12");
        await ticketChannel.send({ embeds: [examEmbed] });
      }

      await interaction.editReply({ content: `✅ הטיקט שלך נפתח בהצלחה בחדר: ${ticketChannel}` });
    } catch (err) { console.error(err); }
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "ticket_open_init") {
    try {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("ticket_type_select")
        .setPlaceholder("🎯 בחר את נושא הפנייה שלך...")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("בחינה לצוות").setValue("בחינה-לצוות"),
          new StringSelectMenuOptionBuilder().setLabel("עזרה").setValue("עזרה"),
          new StringSelectMenuOptionBuilder().setLabel("שת\"פ (שותפות)").setValue("שתפ"),
          new StringSelectMenuOptionBuilder().setLabel("תלונה").setValue("תלונה")
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ content: "אנא בחר מהתפריט את נושא הפנייה:", components: [row], ephemeral: true });
    } catch (err) { console.error(err); }
    return;
  }

  if (interaction.customId.startsWith("ticket_claim_")) {
    try {
      const member = interaction.member;
      const hasPermission = ALL_STAFF_IDS.some(roleId => member.roles.cache.has(roleId)) || interaction.user.id === interaction.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
      
      if (!hasPermission) return await interaction.reply({ content: "❌ רק צוות השרת מורשה לקחת טיקטים!", ephemeral: true });

      const requesterId = interaction.customId.split("_")[2];
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).addFields({ name: "📌 סטטוס טיקט:", value: `נלקח לטיפול על ידי ${interaction.user}` }).setColor("#2ecc71");
      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_claimed_by_${interaction.user.id}`).setLabel("✔ הטיקט בטיפול").setStyle(ButtonStyle.Secondary).setDisabled(true), 
        new ButtonBuilder().setCustomId("ticket_close").setLabel("🔒 סגור טיקט").setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
      await interaction.channel.send({ content: `💼 **הטיקט נלקח לטיפול:** ${interaction.user} יעזור לך כעת, <@${requesterId}>.` });
    } catch (err) { console.error(err); }
    return;
  }

  if (interaction.customId === "ticket_close") {
    try {
      const member = interaction.member;
      const hasAllowedRole = TICKET_CLOSE_ROLES.some(roleId => member.roles.cache.has(roleId)) || interaction.user.id === interaction.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);

      if (!hasAllowedRole) return await interaction.reply({ content: "❌ אין לך הרשאה לסגור טיקט!", ephemeral: true });

      await interaction.reply({ content: "🔒 הטיקט נסגר ויימחק בעוד כ-5 שניות..." });
      setTimeout(async () => { await interaction.channel.delete().catch(() => null); }, 5000);
    } catch (err) { console.error(err); }
    return;
  }

  if (interaction.customId === "verify_button") {
    try {
      const member = interaction.member;
      if (member.roles.cache.has(VERIFY_ROLE_ID)) return await interaction.reply({ content: "❌ אתה כבר מאומת!", ephemeral: true });
      
      await member.roles.add(VERIFY_ROLE_ID);
      await interaction.reply({ content: "🎉 אומתת בהצלחה! כל ערוצי השרת נפתחו עבורך.", ephemeral: true });

      const welcomeDmEmbed = new EmbedBuilder()
        .setTitle(`🎉 ברוכים הבאים אל ${interaction.guild.name}!`)
        .setDescription(`שלום ${interaction.user},\nעברת בהצלחה את מערכת האימות האוטומטית וקיבלת את הרול **Member**!`)
        .setColor("#00ff7f")
        .setTimestamp();

      await member.send({ embeds: [welcomeDmEmbed] }).catch(() => {});
    } catch (err) { console.error(err); }
    return;
  }

  if (interaction.customId.startsWith("help_claim_")) {
    try {
      const member = interaction.member;
      const guild = interaction.guild;
      const hasPermission = ALL_STAFF_IDS.some(roleId => member.roles.cache.has(roleId)) || interaction.user.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);

      if (!hasPermission) return await interaction.reply({ content: "❌ אינך מורשה לטפל בקריאות עזרה!", ephemeral: true });

      let titlePrefix = "איש צוות";
      if (interaction.user.id === guild.ownerId || member.roles.cache.has(OWNER_ROLE_ID)) titlePrefix = "האוונר";
      else if (member.roles.cache.has(CO_OWNER_ROLE_ID)) titlePrefix = "הקו-אוונר";

      const requesterId = interaction.customId.split("_")[2];
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor("#2ecc71").addFields({ name: "🤝 סטטוס טיפול:", value: `הקריאה בטיפול כעת על ידי ${titlePrefix} ${interaction.user}` });

      await interaction.update({ embeds: [updatedEmbed], components: [] });
      await interaction.followUp({ content: `✅ לקחת את קריאת העזרה בהצלחה.`, ephemeral: true });

      const targetUser = await guild.members.fetch(requesterId).catch(() => null);
      if (targetUser) {
        await targetUser.send({ content: `👋 שלום, ${titlePrefix} **${interaction.user.username}** לקח אחריות על קריאת העזרה שלך והוא מטפל בה כעת!` }).catch(() => {});
      }
    } catch (err) { console.error(err); }
  }
});

// ─── Anti-Nuke System Events ──────────────────────────────────────────────────

client.on("channelDelete", async (channel) => {
  if (!channel.guild || channel.parentId === TICKET_CATEGORY_ID || channel.parentId === PRIVATE_VOICE_CATEGORY_ID) return;
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
      permissionOverwrites: channel.permissionOverwrites?.cache.map((o) => ({ id: o.id, allow: o.allow.bitfield, deny: o.deny.bitfield })) ?? [],
    });

    await punishUser(channel.guild, executor.id, `Deleted channel/category: #${channel.name}`);
  } catch (err) { console.error(err.message); }
});

client.on("channelCreate", async (channel) => {
  if (!channel.guild || channel.parentId === TICKET_CATEGORY_ID || channel.parentId === PRIVATE_VOICE_CATEGORY_ID) return;
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
    if (!executorId || await shouldBypass(guild, executorId)) return;

    if (action === AuditLogEvent.EmojiDelete) await punishUser(guild, executorId, "Deleted a server emoji");
    if (action === AuditLogEvent.WebhookCreate || action === AuditLogEvent.WebhookDelete) await punishUser(guild, executorId, "Unauthorized Webhook manipulation");
    if (action === AuditLogEvent.GuildUpdate) await punishUser(guild, executorId, "Attempted to modify server settings");
    
    if (action === AuditLogEvent.RoleUpdate) {
      const logs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleUpdate });
      const entry = logs.entries.first();
      if (entry) {
        const hasAdminUpdate = entry.changes.some(c => c.key === "permissions" && (BigInt(c.new) & PermissionFlagsBits.Administrator));
        if (hasAdminUpdate) await punishUser(guild, executorId, "Granted dangerous Administrator permissions");
      }
    }

    if (action === AuditLogEvent.MemberBanAdd && isMassActionTriggered(executorId, "mass_ban")) await punishUser(guild, executorId, "Mass banning users");
    if (action === AuditLogEvent.MemberKick && isMassActionTriggered(executorId, "mass_kick")) await punishUser(guild, executorId, "Mass kicking users");
  } catch (err) { console.error(err.message); }
});

client.login(process.env.DISCORD_TOKEN);
