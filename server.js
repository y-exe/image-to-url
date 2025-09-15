require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fetch = require('node-fetch');
const cors = require('cors');
const app = express();
app.use(cors());

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function encodeToBase62(num) {
    if (num === 0n) return BASE62_CHARS[0];
    let result = '';
    while (num > 0n) {
        const remainder = num % 62n;
        result = BASE62_CHARS[Number(remainder)] + result;
        num = num / 62n;
    }
    return result;
}
function decodeFromBase62(str) {
    let result = 0n;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const index = BigInt(BASE62_CHARS.indexOf(char));
        if (index === -1n) {
             throw new Error("Invalid Base62 string");
        }
        result = result * 62n + index;
    }
    return result;
}


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: '画像ファイルがありません。' });
    try {
        const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        const message = await channel.send({ files: [{ attachment: req.file.buffer, name: req.file.originalname }] });
        
        const shortId = encodeToBase62(BigInt(message.id));
        const newProxyUrl = `https://pic.yexe.xyz/${shortId}`;
        
        res.status(200).json({ success: true, url: newProxyUrl });

    } catch (error) {
        console.error(`[Upload] アップロードエラー: ${error.message}`);
        res.status(500).json({ success: false, error: 'サーバー内部でエラーが発生しました。' });
    }
});


app.get('/:shortId', async (req, res) => {
    const { shortId } = req.params;
    try {
        const messageId = decodeFromBase62(shortId).toString();

        if (!/^\d+$/.test(messageId)) {
            return res.status(400).send('無効なID形式です。');
        }

        const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        const message = await channel.messages.fetch(messageId);
        const attachment = message.attachments.first();

        if (!attachment) { throw new Error('添付ファイルが見つかりません。'); }

        const discordCdnUrl = attachment.url;
        const imageResponse = await fetch(discordCdnUrl);

        if (!imageResponse.ok) { throw new Error(`画像の取得に失敗しました: ${imageResponse.statusText}`); }
        
        const imageBuffer = await imageResponse.buffer();
        const contentType = imageResponse.headers.get('content-type');

        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        res.send(imageBuffer);

    } catch (error) {
        console.error(`[Proxy] プロキシエラー: shortId='${shortId}' - ${error.message}`);
        if (error.code === 10008) {
             res.status(404).send('指定された画像は見つかりませんでした。');
        } else {
             res.status(404).send('画像が見つかりません。');
        }
    }
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
});
client.login(process.env.DISCORD_BOT_TOKEN);
client.once('ready', () => console.log(`✅ Discord Bot [${client.user.tag}] としてログインしました。`));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✅ 完全自己完結型サーバーがポート ${PORT} で起動しました。`);
    console.log(`   テスト用URL: http://localhost:${PORT}`);
});
