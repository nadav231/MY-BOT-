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

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_DELETE_ROLE_ID = "1515409287676035228"; // רול מחיקת חדרים
const VERIFY_ROLE_ID = "1496911471915962552";        // רול ממבר (💸 Members)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, // דרוש כדי לקרוא את פקודת הפאנל
    GatewayIntentBits.MessageContent // דרוש כדי לזהות את הטקסט של הפקודה
  ],
});

// ─── Nickname Helper ──────────────────────────────────────────────────────────

async function updateMemberNickname(member) {
  let prefix = null;

  for (const roleId of rolePriority) {
    if (member.roles.cache.has(roleId)) {
      prefix = rolePrefixes[roleId];
      break;
    }
  }

  if (!prefix) {
    if (member.nickname) {
      await member.setNickname(null);
      console.log(`[Nickname] Reset: ${member.user.tag}`);
    }
    return;
  }

  const baseName = member.displayName.replace(
    /^(MG|AR|SA|AD|IN|SMD|MOD|GR|SH|HR|RS|VIP)\s\|\s/i,
    ""
  );

  const newNickname = `${prefix} | ${baseName}`;

  if (member.nickname !== newNickname) {
    await member.setNickname(newNickname);
    console.log(`[Nickname] ${member.user.tag} → ${newNickname}`);
  }
}

// ─── Bulk Sync ────────────────────────────────────────────────────────────────

async function syncAllMembers() {
  console.log("[Sync] Starting bulk nickname sync...");

  const guild = client.guilds.cache.first();
  if (!guild) {
    console.warn("[Sync] No guild found");
    return;
  }

  await guild.members.fetch();

  let count = 0;
  for (const member of guild.members.cache.values()) {
    try {
      await updateMemberNickname(member);
      count++;
    } catch (err) {
      console.error(`[Sync] Error for ${member.user.tag}:`, err.message);
    }
  }

  console.log(`[Sync] Done — ${count} members processed`);
}

// ─── Events ───────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`[Bot] Online as ${client.user.tag}`);
  await syncAllMembers();
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    await updateMemberNickname(newMember);
  } catch (err) {
    console.error("[Nickname] Error:", err.message);
  }
});

// פקודה ליצירת פאנל האימות
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // פקודה ליצירת פאנל (מומלץ שרק מנהלים ישתמשו בה)
  if (message.content === "verify.panel") {
    try {
      // מוחק את הודעת הפקודה המקורית כדי שהצ'אט יישאר נקי
      await message.delete().catch(() => null);

      // יצירת הכפתור
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("verify_button")
          .setLabel("אימות")
          .setStyle(ButtonStyle.Success) // כפתור ירוק
      );

      // עיצוב הודעת הפאנל
      const embed = new EmbedBuilder()
        .setTitle("מערכת אימות השרת")
        .setDescription("לחץ על הכפתור למטה כדי לפתוח את החדרים בשרת ולקבל גישה!")
        .setColor("#00ff00");

      await message.channel.send({ embeds: [embed], components: [row] });
      console.log(`[Verify] Panel deployed in #${message.channel.name}`);
    } catch (err) {
      console.error("[Verify Command] Error:", err.message);
    }
  }
});

// טיפול בלחיצה על כפתור האימות
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "verify_button") {
    try {
      const member = interaction.member;

      // בדיקה אם למשתמש כבר יש את הרול
      if (member.roles.cache.has(VERIFY_ROLE_ID)) {
        return await interaction.reply({
          content: "אתה כבר מאומת בשרת!",
          ephemeral: true, // הודעה נסתרת שרק הוא רואה
        });
      }

      // נתינת הרול למשתמש
      await member.roles.add(VERIFY_ROLE_ID);

      // שליחת הודעת הצלחה נסתרת למשתמש
      await interaction.reply({
        content: "אוממת בהצלחה קיבלת גישה לחדרים",
        ephemeral: true,
      });

      console.log(`[Verify] ${member.user.tag} has verified successfully.`);
    } catch (err) {
      console.error("[Verify Interaction] Error:", err.message);
      await interaction.reply({
        content: "אירעה שגיאה בזמן הניסיון להעניק לך רול. ודא כי הרול של הבוט נמצא מעל הרול של הממברס.",
        ephemeral: true,
      }).catch(() => null);
    }
  }
});

client.on("channelDelete", async (channel) => {
  try {
    if (!channel.guild) return;

    const guild = channel.guild;

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const fetchedLogs = await guild.fetchAuditLogs({
      limit: 1,
      type: AuditLogEvent.ChannelDelete,
    });

    const deletionLog = fetchedLogs.entries.first();
    if (!deletionLog) return;

    const { executor } = deletionLog;
    if (!executor) return;

    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (!member) return;

    if (member.roles.cache.has(ALLOWED_DELETE_ROLE_ID)) {
      console.log(`[Anti-Nuke] ${executor.tag} deleted #${channel.name} safely (has bypass role).`);
      return;
    }

    console.log(`[Anti-Nuke] ${executor.tag} deleted #${channel.name} without permission! Recreating and banning...`);

    const newChannel = await guild.channels.create({
      name: channel.name,
      type: channel.type,
      parent: channel.parentId ?? undefined,
      topic: channel.topic ?? undefined,
      nsfw: channel.nsfw ?? false,
      rateLimitPerUser: channel.rateLimitPerUser ?? undefined,
      permissionOverwrites: channel.permissionOverwrites?.cache.map((o) => ({
        id: o.id,
        allow: o.allow.bitfield,
        deny: o.deny.bitfield,
      })) ?? [],
    });

    console.log(`[Anti-Nuke] Recreated #${newChannel.name}`);

    if (executor.id === guild.ownerId) return;

    const botMember = guild.members.me;
    if (!botMember) return;

    if (member.roles.highest.position >= botMember.roles.highest.position) {
      console.log(`[Anti-Nuke] Cannot ban ${executor.tag} — role too high`);
      return;
    }

    await member.ban({ reason: "Anti-Nuke: Deleted a channel without permission" });
    console.log(`[Anti-Nuke] Banned ${executor.tag}`);
  } catch (err) {
    console.error("[Anti-Nuke] Error:", err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
