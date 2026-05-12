require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');

// API Keys from .env
const {
    OMDB_API_KEY,
    WATCHMODE_API_KEY,
    YOUTUBE_API_KEY
} = process.env;

// Database Initialization
const db = new Database(path.join(__dirname, 'kernel.db'));
db.prepare(`
    CREATE TABLE IF NOT EXISTS watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT,
        title TEXT,
        year TEXT,
        type TEXT,
        added_by TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        handleSIGINT: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ],
    }
});

// Rate limiting setup
const COOLDOWN_MS = 5000; 
const lastUsed = new Map();

client.on('qr', (qr) => {
    console.log('[THE KERNEL // AUTH_REQUIRED] Please scan:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('[THE KERNEL // SYSTEM_READY] Online and monitoring.');
});

client.on('auth_failure', (msg) => {
    console.error('[THE KERNEL // AUTH_FAILURE]', msg);
});

async function getStreamingSources(imdbID) {
    if (!WATCHMODE_API_KEY || WATCHMODE_API_KEY === 'YOUR_WATCHMODE_KEY') return null;
    try {
        const url = `https://api.watchmode.com/v1/title/${imdbID}/sources/?apiKey=${WATCHMODE_API_KEY}&regions=US`;
        const res = await axios.get(url, { timeout: 8000 });
        const sources = res.data;
        if (!sources || !Array.isArray(sources)) return null;
        
        const uniqueSources = [...new Set(sources
            .filter(s => s.type === 'sub')
            .map(s => s.name))];
            
        return uniqueSources.length > 0 ? uniqueSources.join(', ') : null;
    } catch (err) {
        console.error('[THE KERNEL // WATCHMODE_ERROR]', err.message);
        return null;
    }
}

async function getTrailer(title, year) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_KEY') return null;
    try {
        const query = encodeURIComponent(`${title} ${year} Official Trailer`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&key=${YOUTUBE_API_KEY}&maxResults=1&type=video`;
        const res = await axios.get(url, { timeout: 8000 });
        if (res.data.items && res.data.items.length > 0) {
            return `https://www.youtube.com/watch?v=${res.data.items[0].id.videoId}`;
        }
        return null;
    } catch (err) {
        console.error('[THE KERNEL // YOUTUBE_ERROR]', err.message);
        return null;
    }
}

async function handleOMDbRequest(msg, query, type) {
    const now = Date.now();
    const sender = msg.from;
    
    if (lastUsed.has(sender) && (now - lastUsed.get(sender) < COOLDOWN_MS)) {
        return; 
    }
    lastUsed.set(sender, now);
    
    console.log(`[THE KERNEL // API_QUERY] Fetching ${type}: "${query}"`);
    
    try {
        const res = await axios.get(`http://www.omdbapi.com/?t=${query}&type=${type}&apikey=${OMDB_API_KEY}`, { timeout: 8000 });
        const data = res.data;

        if (data.Response === 'True') {
            const isMovie = data.Type === 'movie';
            const icon = isMovie ? '🎬' : '📺';
            
            const [streaming, trailer] = await Promise.all([
                getStreamingSources(data.imdbID),
                getTrailer(data.Title, data.Year)
            ]);

            let output = `${icon} *${data.Title}* (${data.Year})\n\n` +
                         `⭐ *Rating:* ${data.imdbRating}/10\n` +
                         (isMovie ? `` : `🔢 *Seasons:* ${data.totalSeasons}\n`) +
                         `🎭 *Genre:* ${data.Genre}\n` +
                         (streaming ? `📡 *Streaming:* ${streaming}\n` : ``) +
                         `📝 *Plot:* ${data.Plot}\n\n` +
                         (trailer ? `🎥 *Trailer:* ${trailer}\n` : ``) +
                         `🔗 *IMDb:* https://www.imdb.com/title/${data.imdbID}`;
            
            await client.sendMessage(msg.from, output);
            console.log(`[THE KERNEL // SUCCESS] Sent details for "${data.Title}"`);
        } else {
            await client.sendMessage(msg.from, `❌ *Error:* ${type === 'movie' ? 'Movie' : 'Show'} "${query}" not found.`);
        }
    } catch (err) {
        console.error('[THE KERNEL // ERROR]', err.message);
    }
}

async function handleWatchlist(msg) {
    const chatId = msg.from;
    const body = msg.body.trim();

    if (body.startsWith('!add ')) {
        const titleQuery = body.split('!add ')[1]?.trim();
        if (!titleQuery) return;

        try {
            const res = await axios.get(`http://www.omdbapi.com/?t=${titleQuery}&apikey=${OMDB_API_KEY}`, { timeout: 8000 });
            const data = res.data;

            if (data.Response === 'True') {
                const stmt = db.prepare('INSERT INTO watchlists (chat_id, title, year, type, added_by) VALUES (?, ?, ?, ?, ?)');
                const contact = await msg.getContact();
                stmt.run(chatId, data.Title, data.Year, data.Type, contact.pushname || contact.number);
                
                await client.sendMessage(chatId, `✅ Added *${data.Title}* (${data.Year}) to the watchlist!`);
            } else {
                await client.sendMessage(chatId, `❌ Could not find "${titleQuery}" to add.`);
            }
        } catch (err) {
            console.error('[THE KERNEL // DB_ERROR]', err.message);
        }
    } else if (body === '!watchlist') {
        const rows = db.prepare('SELECT title, year, type FROM watchlists WHERE chat_id = ? ORDER BY timestamp DESC').all(chatId);
        
        if (rows.length === 0) {
            await client.sendMessage(chatId, `📂 The watchlist is currently empty.`);
        } else {
            let list = `📋 *Group Watchlist*\n\n`;
            rows.forEach((row, i) => {
                const icon = row.type === 'movie' ? '🎬' : '📺';
                list += `${i + 1}. ${icon} ${row.title} (${row.year})\n`;
            });
            await client.sendMessage(chatId, list);
        }
    } else if (body === '!pick') {
        const rows = db.prepare('SELECT title, year, type FROM watchlists WHERE chat_id = ?').all(chatId);
        
        if (rows.length === 0) {
            await client.sendMessage(chatId, `📂 The watchlist is empty, nothing to pick!`);
        } else {
            const random = rows[Math.floor(Math.random() * rows.length)];
            const icon = random.type === 'movie' ? '🎬' : '📺';
            await client.sendMessage(chatId, `🎲 *The Kernel Picks:* \n\n${icon} *${random.title}* (${random.year})!`);
        }
    }
}

client.on('message_create', async (msg) => {
    if (msg.fromMe) return;

    const body = msg.body.toLowerCase();

    if (body.startsWith('!movie ')) {
        const query = msg.body.split('!movie ')[1]?.trim();
        if (query) await handleOMDbRequest(msg, query, 'movie');
    } else if (body.startsWith('!show ')) {
        const query = msg.body.split('!show ')[1]?.trim();
        if (query) await handleOMDbRequest(msg, query, 'series');
    } else if (body.startsWith('!add ') || body === '!watchlist' || body === '!pick') {
        await handleWatchlist(msg);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[THE KERNEL // SYSTEM_ERROR] Unhandled Rejection:', reason);
});

console.log('[THE KERNEL // STARTUP] Initializing...');
client.initialize();
