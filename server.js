
require("dotenv").config();

const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`บอทออนไลน์แล้ว: ${client.user.tag}`);
});

client.on("error", (error) => {
  console.error("Discord Error:", error);
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("เข้าสู่ระบบ Discord ไม่สำเร็จ:", error);
});
