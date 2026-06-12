import express from "express";
import {
  Client,
  GatewayIntentBits,
  AuditLogEvent,
  ChannelType,
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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

    console.log(`[Anti-Nuke] ${executor.tag} deleted #${channel.name}`);

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

    const member = await guild.members.fetch(executor.id).catch(() => null);
    if (!member) return;

    const botMember = guild.members.me;
    if (!botMember) return;

    if (member.roles.highest.position >= botMember.roles.highest.position) {
      console.log(`[Anti-Nuke] Cannot ban ${executor.tag} — role too high`);
      return;
    }

    await member.ban({ reason: "Anti-Nuke: Deleted a channel" });
    console.log(`[Anti-Nuke] Banned ${executor.tag}`);
  } catch (err) {
    console.error("[Anti-Nuke] Error:", err.message);
  }
});

client.login(⁠"MTUxNDY4MTk2OTgxODk5Mjg1MA.GpS2nW.udYsv6EA7utB6G61c8sJf3voW8hWKg3vbx6VSU⁠");
