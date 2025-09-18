require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const cors = require('cors');
const puppeteer = require('puppeteer');
const NodeCache = require('node-cache');

const app = express();
app.use(cors());

const imageCache = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function encodeToBase62(num) { if (num === 0n) return BASE62_CHARS[0]; let result = ''; while (num > 0n) { const remainder = num % 62n; result = BASE62_CHARS[Number(remainder)] + result; num = num / 62n; } return result; }
function decodeFromBase62(str) { let result = 0n; for (let i = 0; i < str.length; i++) { const char = str[i]; const index = BigInt(BASE62_CHARS.indexOf(char)); if (index === -1n) { throw new Error("Invalid Base62 string"); } result = result * 62n + index; } return result; }

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).send());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) { return res.status(400).json({ success: false, error: '画像ファイルがありません。' }); }
    try {
        const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        const message = await channel.send({ files: [{ attachment: req.file.buffer, name: req.file.originalname }] });
        const shortId = encodeToBase62(BigInt(message.id));
        const newProxyUrl = `https://pic.yexe.xyz/${shortId}`;
        res.status(200).json({ success: true, url: newProxyUrl, fileName: req.file.originalname });
    } catch (error) {
        console.error(`[Upload] アップロードエラー: ${error.message}`);
        res.status(500).json({ success: false, error: 'サーバー内部でエラーが発生しました。' });
    }
});

app.get('/:shortId', async (req, res) => {
    const { shortId } = req.params;
    
    const cachedImage = imageCache.get(shortId);
    if (cachedImage) {
        res.setHeader('Content-Type', cachedImage.contentType);
        return res.send(cachedImage.buffer);
    }

    let browser = null;
    try {
        const messageId = decodeFromBase62(shortId).toString();
        if (!/^\d+$/.test(messageId)) { return res.status(400).send('無効なID形式です。'); }

        const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        const message = await channel.messages.fetch(messageId);
        const attachment = message.attachments.first();
        if (!attachment) { throw new Error('添付ファイルが見つかりません。'); }

        const discordCdnUrl = attachment.url;
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
        
        const response = await page.goto(discordCdnUrl, { waitUntil: 'networkidle0' });
        if (!response.ok()) { throw new Error(`画像データの取得に失敗しました: ${response.status()}`); }
        
        const imageBuffer = await response.buffer();
        const contentType = response.headers()['content-type'];

        imageCache.set(shortId, { buffer: imageBuffer, contentType: contentType });

        res.setHeader('Content-Type', contentType);
        res.send(imageBuffer);

    } catch (error) {
        console.error(`[Proxy] プロキシエラー: shortId='${shortId}' - ${error.message}`);
        if (error.code === 10008) {
             res.status(404).send('指定された画像は見つかりませんでした。');
        } else {
             res.status(404).send('画像が見つかりません。');
        }
    } finally {
        if (browser) { await browser.close(); }
    }
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
});
client.login(process.env.DISCORD_BOT_TOKEN);
client.once('ready', () => console.log(` [${client.user.tag}] としてログイン`));

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`URL: http://localhost:${PORT}`);
});
