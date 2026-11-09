require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

// -------------------------
// CLIENT
// -------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------------
// FILES
// -------------------------

const CONFIG_FILE = path.join(__dirname, "config.json");
const PENDING_FILE = path.join(__dirname, "pending.json");

function readFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(fallback, null, 2)
    );
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`ไฟล์ ${path.basename(file)} ไม่ใช่ JSON ที่ถูกต้อง: ${error.message}`);
  }
}

function saveFile(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2)
  );
}

const config = readFile(CONFIG_FILE, {
  ROBLOX_GROUP_ID: 1006968111,
  VERIFY_CHANNEL_ID: "",
  ROLES: {}
});

const pending = readFile(PENDING_FILE, {});

// -------------------------
// RANDOM REWARDS
// -------------------------

const REWARDS_FILE = path.join(__dirname, "rewards.json");

// แก้ไขข้อความรางวัลได้ในไฟล์ rewards.json
const rewards = readFile(REWARDS_FILE, [
  "คุณได้รับยศพลทหาร (ข้อความตัวอย่าง)",
  "คุณได้รับเงินรางวัล 500 บาท (ข้อความตัวอย่าง)",
  "คุณได้รับสิทธิพิเศษ (ข้อความตัวอย่าง)",
  "เสียใจด้วย รอบนี้คุณไม่ได้รับรางวัล"
]);

function makeRandomPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle("🎁 ระบบสุ่มของรางวัล")
    .setDescription(
      "กดปุ่มด้านล่างเพื่อสุ่มรับข้อความรางวัล\n" +
      "สามารถสุ่มได้ไม่จำกัดครั้ง"
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("random_draw")
      .setLabel("สุ่มของรางวัล")
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

// -------------------------
// HTTP SERVER
// -------------------------

app.get("/", (req, res) => {
  res.send("Roblox Verification Bot is running!");
});

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    bot: client.isReady()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP running on ${PORT}`);
});

// -------------------------
// ROBLOX API
// -------------------------

async function robloxRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Roblox API error: ${response.status}`);
  }

  return response.json();
}

async function findRobloxUser(username) {
  const data = await robloxRequest(
    "https://users.roblox.com/v1/usernames/users",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        usernames: [username],
        excludeBannedUsers: true
      })
    }
  );

  return data.data?.[0] || null;
}

async function getRobloxProfile(userId) {
  return robloxRequest(
    `https://users.roblox.com/v1/users/${userId}`
  );
}

async function getGroupRank(userId) {
  const data = await robloxRequest(
    `https://groups.roblox.com/v2/users/${userId}/groups/roles`
  );

  const membership = data.data?.find(
    item =>
      Number(item.group.id) === Number(config.ROBLOX_GROUP_ID)
  );

  if (!membership) return null;

  return membership.role.rank;
}

// -------------------------
// VERIFICATION PANEL
// -------------------------

function makePanel() {
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle("🔐 ระบบยืนยันตัวตน Roblox")
    .setDescription(
      "กดปุ่มด้านล่างเพื่อเริ่มยืนยันตัวตน\n\n" +
      "1. กรอกชื่อ Roblox\n" +
      "2. รับโค้ดยืนยัน\n" +
      "3. นำโค้ดไปใส่ใน About โปรไฟล์ Roblox\n" +
      "4. กลับมากดตรวจสอบ\n\n" +
      "ระบบจะตรวจสอบ Rank ในกลุ่มและมอบยศ Discord อัตโนมัติ"
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_start")
      .setLabel("ยืนยันตัวตน")
      .setEmoji("🔐")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// -------------------------
// ROLE ASSIGNMENT
// -------------------------

const NICKNAME_FORMAT = "{username}";

async function updateNickname(member, robloxUsername) {
  const nickname = NICKNAME_FORMAT
    .replace("{username}", String(robloxUsername))
    .slice(0, 32);

  await member.setNickname(nickname);

  console.log(`เปลี่ยนชื่อ Discord สำเร็จ: ${nickname}`);
}

async function updateRoles(member, rank) {
  const roleIds = config.ROLES[String(rank)];

  if (!Array.isArray(roleIds) || roleIds.length === 0) {
    throw new Error(
      `ยังไม่ได้กำหนดยศสำหรับ Rank ${rank} ใน config.json`
    );
  }

  const rolesToAdd = [...new Set(roleIds.map(String))];

  const allConfiguredRoles = [
    ...new Set(
      Object.values(config.ROLES)
        .flat()
        .map(String)
    )
  ];

  // ตรวจสอบยศทั้งหมดก่อนแก้ไข
  for (const id of rolesToAdd) {
    const role = await member.guild.roles.fetch(id);

    if (!role) {
      throw new Error(`ไม่พบยศ Discord ID: ${id}`);
    }

    if (!role.editable) {
      throw new Error(`บอทไม่มีสิทธิ์จัดการยศ ID: ${id}`);
    }
  }

  // เพิ่มยศใหม่ก่อน เพื่อป้องกันการเสียยศเดิมหากเพิ่มยศไม่ได้
  await member.roles.add(rolesToAdd);

  // ลบเฉพาะยศที่ระบบนี้กำหนดไว้
  const rolesToRemove = allConfiguredRoles.filter(
    id =>
      !rolesToAdd.includes(id) &&
      member.roles.cache.has(id)
  );

  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove);
  }

  console.log(`มอบยศสำเร็จ Rank ${rank}`);
}

// -------------------------
// BOT READY
// -------------------------

client.once(Events.ClientReady, async () => {
  console.log(`Bot online: ${client.user.tag}`);

  const guild = client.guilds.cache.get(
    process.env.GUILD_ID
  );

  if (!guild) {
    console.error("ไม่พบ GUILD_ID ใน Discord");
    return;
  }

  const channel = await guild.channels.fetch(
    config.VERIFY_CHANNEL_ID
  );

  if (!channel || !channel.isTextBased()) {
    console.error("ไม่พบห้องยืนยันตัวตน");
    return;
  }

  console.log("ระบบยืนยันตัวตนพร้อมใช้งาน");
});

// -------------------------
// INTERACTIONS
// -------------------------

client.on(Events.InteractionCreate, async interaction => {
  try {

    // -------------------------
    // RANDOM REWARD PANEL COMMAND
    // -------------------------

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "random-panel"
    ) {
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content: "เฉพาะผู้ดูแลระบบเท่านั้น",
          ephemeral: true
        });
      }

      if (!Array.isArray(rewards) || rewards.length === 0) {
        return interaction.reply({
          content: "ยังไม่มีรายการรางวัล กรุณาตรวจสอบไฟล์ rewards.json",
          ephemeral: true
        });
      }

      await interaction.channel.send(makeRandomPanel());

      return interaction.reply({
        content: "ส่งแผงสุ่มของรางวัลเรียบร้อยแล้ว",
        ephemeral: true
      });
    }

    // -------------------------
    // RANDOM REWARD BUTTON
    // -------------------------

    if (
      interaction.isButton() &&
      interaction.customId === "random_draw"
    ) {
      if (!Array.isArray(rewards) || rewards.length === 0) {
        return interaction.reply({
          content: "ขณะนี้ยังไม่มีรายการรางวัล กรุณาแจ้งผู้ดูแลระบบ",
          ephemeral: true
        });
      }

      const reward = rewards[crypto.randomInt(rewards.length)];

      const rewardEmbed = new EmbedBuilder()
        .setColor(0xD4AF37)
        .setTitle("🎉 ผลการสุ่มของรางวัล")
        .setDescription(`คุณได้รับ:\\n\\n**${String(reward)}**`)
        .setFooter({
          text: `สุ่มโดย ${interaction.user.username}`
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [rewardEmbed],
        ephemeral: true
      });
    }

    // -------------------------
    // SETUP COMMAND
    // -------------------------

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "verify-panel"
    ) {
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content: "เฉพาะผู้ดูแลระบบเท่านั้น",
          ephemeral: true
        });
      }

      await interaction.deferReply({
        ephemeral: true
      });

      const channel = await interaction.guild.channels.fetch(
        config.VERIFY_CHANNEL_ID
      );

      if (!channel || !channel.isTextBased()) {
        return interaction.editReply(
          "ไม่พบห้องยืนยันตัวตน กรุณาตรวจสอบ config.json"
        );
      }

      await channel.send(makePanel());

      return interaction.editReply(
        "ส่งแผงยืนยันตัวตนเรียบร้อยแล้ว"
      );
    }

    // -------------------------
    // START BUTTON
    // -------------------------

    if (
      interaction.isButton() &&
      interaction.customId === "verify_start"
    ) {
      const modal = new ModalBuilder()
        .setCustomId("verify_username")
        .setTitle("Roblox Verification");

      const input = new TextInputBuilder()
        .setCustomId("username")
        .setLabel("ชื่อผู้ใช้ Roblox")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

      modal.addComponents(
        new ActionRowBuilder().addComponents(input)
      );

      return interaction.showModal(modal);
    }

    // -------------------------
    // USERNAME SUBMIT
    // -------------------------

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "verify_username"
    ) {
      await interaction.deferReply({
        ephemeral: true
      });

      const username = interaction.fields
        .getTextInputValue("username")
        .trim();

      const user = await findRobloxUser(username);

      if (!user) {
        return interaction.editReply(
          "ไม่พบบัญชี Roblox นี้"
        );
      }

      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      const code =
        "TH-" +
        crypto.randomBytes(4).toString("hex").toUpperCase();

      if (!pending[guildId]) {
        pending[guildId] = {};
      }

      pending[guildId][userId] = {
        robloxUserId: user.id,
        username: user.name,
        code,
        createdAt: Date.now()
      };

      saveFile(PENDING_FILE, pending);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("verify_check")
          .setLabel("ตรวจสอบบัญชี")
          .setStyle(ButtonStyle.Success)
      );

      return interaction.editReply({
        content:
          `บัญชี Roblox: **${user.name}**\n\n` +
          `โค้ดยืนยัน: \`${code}\`\n\n` +
          "นำโค้ดไปใส่ใน About โปรไฟล์ Roblox แล้วกดตรวจสอบ",
        components: [row]
      });
    }

    // -------------------------
    // CHECK BUTTON
    // -------------------------

    if (
      interaction.isButton() &&
      interaction.customId === "verify_check"
    ) {
      await interaction.deferReply({
        ephemeral: true
      });

      const guildId = interaction.guildId;
      const userId = interaction.user.id;

      const record = pending[guildId]?.[userId];

      if (!record) {
        return interaction.editReply(
          "ไม่พบคำขอยืนยัน กรุณาเริ่มใหม่"
        );
      }

      // ตรวจสอบอายุโค้ด 30 นาที
      if (
        Date.now() - record.createdAt >
        30 * 60 * 1000
      ) {
        delete pending[guildId][userId];
        saveFile(PENDING_FILE, pending);

        return interaction.editReply(
          "โค้ดหมดอายุ กรุณาเริ่มใหม่"
        );
      }

      // ตรวจสอบโค้ดใน About Roblox
      const profile = await getRobloxProfile(
        record.robloxUserId
      );

      if (!profile.description?.includes(record.code)) {
        return interaction.editReply(
          "ยังไม่พบโค้ดใน About Roblox กรุณาตรวจสอบอีกครั้ง"
        );
      }

      // ตรวจสอบ Rank กลุ่ม Roblox
      const rank = await getGroupRank(
        record.robloxUserId
      );

      if (rank === null) {
        return interaction.editReply(
          "บัญชีนี้ไม่ได้เป็นสมาชิกกลุ่ม Roblox ที่กำหนด"
        );
      }

      // ดึงสมาชิก Discord
      const guild = interaction.guild;
      const member = await guild.members.fetch(userId);

      // มอบยศตาม Rank
      await updateRoles(member, rank);

      // แก้ไขชื่อ Discord
      let nicknameSuccess = true;

      try {
        await updateNickname(member, record.username);
      } catch (error) {
        nicknameSuccess = false;
        console.error(
          "เปลี่ยนชื่อ Discord ไม่สำเร็จ:",
          error.message
        );
      }

      // ลบคำขอเมื่อมอบยศสำเร็จ
      delete pending[guildId][userId];
      saveFile(PENDING_FILE, pending);

      return interaction.editReply(
        `ยืนยันสำเร็จ!\n\n` +
        `Roblox: ${record.username}\n` +
        `Group Rank: ${rank}\n` +
        `มอบยศ Discord เรียบร้อยแล้ว\n` +
        (
          nicknameSuccess
            ? "เปลี่ยนชื่อ Discord เรียบร้อยแล้ว"
            : "⚠️ มอบยศสำเร็จ แต่เปลี่ยนชื่อไม่ได้ กรุณาตรวจสอบสิทธิ์บอท"
        )
      );
    }

  } catch (error) {
    console.error("INTERACTION ERROR:", error);

    const message =
      `เกิดข้อผิดพลาด: ${error.message}`;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else if (interaction.isRepliable()) {
      await interaction.reply({
        content: message,
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// -------------------------
// REGISTER COMMAND
// -------------------------

async function registerCommand() {
  const commands = [
    new SlashCommandBuilder()
      .setName("verify-panel")
      .setDescription("ส่งแผงยืนยันตัวตน Roblox")
      .toJSON(),

    new SlashCommandBuilder()
      .setName("random-panel")
      .setDescription("ส่งแผงสุ่มของรางวัล")
      .toJSON()
  ];

  const rest = new REST({
    version: "10"
  }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.CLIENT_ID,
      process.env.GUILD_ID
    ),
    {
      body: commands
    }
  );

  console.log("ลงทะเบียนคำสั่งสำเร็จ");
}

// -------------------------
// START
// -------------------------

async function start() {
  if (
    !process.env.DISCORD_TOKEN ||
    !process.env.CLIENT_ID ||
    !process.env.GUILD_ID
  ) {
    throw new Error(
      "กรุณาตรวจสอบ DISCORD_TOKEN, CLIENT_ID และ GUILD_ID ใน .env"
    );
  }

  if (!config.ROBLOX_GROUP_ID) {
    throw new Error("กรุณากำหนด ROBLOX_GROUP_ID ใน config.json");
  }

  if (!config.VERIFY_CHANNEL_ID) {
    throw new Error("กรุณากำหนด VERIFY_CHANNEL_ID ใน config.json");
  }

  await registerCommand();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error("START ERROR:", error);
  process.exit(1);
});
