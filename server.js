
const express = require("express");

const {
  Client,
  GatewayIntentBits
} = require("discord.js");

// HTTP Server
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Discord Bot is running!");
});

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    bot: client.isReady()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP Server running on port ${PORT}`);
});

// Discord Bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("clientReady", () => {
  console.log(`บอทออนไลน์แล้ว: ${client.user.tag}`);
});

client.on("error", (error) => {
  console.error("Discord Error:", error);
});

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("เข้าสู่ระบบ Discord ไม่สำเร็จ:", error);
});
