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

// State management for interactive commands
const COOLDOWN_MS = 5000; 
const lastUsed = new Map();
const pendingAdds = new Map(); // Key: chatId:userId, Value: Array of search results

client.on('qr', (qr) => {
    console.log('[THE KERNEL // AUTH_REQUIRED] Please scan:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('[THE KERNEL // SYSTEM_READY] Online and monitoring.');
});

async function getStreamingSources(imdbID) {
    if (!WATCHMODE_API_KEY || WATCHMODE_API_KEY === 'YOUR_WATCHMODE_KEY') return null;
    try {
        const searchUrl = `https://api.watchmode.com/v1/search/?apiKey=${WATCHMODE_API_KEY.trim()}&search_value=${imdbID}&search_field=imdb_id`;
        const searchRes = await axios.get(searchUrl, { timeout: 8000 });
        if (!searchRes.data.title_results || searchRes.data.title_results.length === 0) return null;
        
        const wmID = searchRes.data.title_results[0].id;
        const sourcesUrl = `https://api.watchmode.com/v1/title/${wmID}/sources/?apiKey=${WATCHMODE_API_KEY.trim()}`;
        const sourcesRes = await axios.get(sourcesUrl, { timeout: 8000 });
        const sources = sourcesRes.data;
        if (!sources || !Array.isArray(sources)) return null;
        
        const uniqueSources = [...new Set(sources
            .filter(s => s.type === 'sub' || s.type === 'free')
            .map(s => s.name))];
            
        return uniqueSources.length > 0 ? uniqueSources.join(', ') : null;
    } catch (err) {
        console.error(`[THE KERNEL // WATCHMODE_ERROR] ${err.message}`);
        return null;
    }
}

async function getTrailer(title, year) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_KEY') return null;
    try {
        const query = encodeURIComponent(`${title} ${year} Official Trailer`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&key=${YOUTUBE_API_KEY.trim()}&maxResults=1&type=video`;
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
    if (lastUsed.has(sender) && (now - lastUsed.get(sender) < COOLDOWN_MS)) return;
    lastUsed.set(sender, now);
    
    try {
        const res = await axios.get(`http://www.omdbapi.com/?t=${query}&type=${type}&apikey=${OMDB_API_KEY.trim()}`, { timeout: 8000 });
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

async function saveToWatchlist(chatId, title, year, type, addedBy) {
    try {
        const stmt = db.prepare('INSERT INTO watchlists (chat_id, title, year, type, added_by) VALUES (?, ?, ?, ?, ?)');
        stmt.run(chatId, title, year, type, addedBy);
        return true;
    } catch (err) {
        console.error('[THE KERNEL // DB_ERROR]', err.message);
        return false;
    }
}

async function handleWatchlist(msg) {
    const chatId = msg.from;
    const authorId = msg.author || msg.from;
    const body = msg.body.trim();
    const userKey = `${chatId}:${authorId}`;

    if (body.startsWith('!add ')) {
        const query = body.split('!add ')[1]?.trim();
        if (!query) return;

        try {
            // Use Search (s=) instead of Title (t=) to find multiple matches
            const res = await axios.get(`http://www.omdbapi.com/?s=${encodeURIComponent(query)}&apikey=${OMDB_API_KEY.trim()}`, { timeout: 8000 });
            
            if (res.data.Response === 'True') {
                const results = res.data.Search.slice(0, 5); // Take top 5
                
                if (results.length === 1) {
                    // Only one match, add immediately
                    const contact = await msg.getContact();
                    await saveToWatchlist(chatId, results[0].Title, results[0].Year, results[0].Type, contact.pushname || contact.number);
                    await client.sendMessage(chatId, `✅ Added *${results[0].Title}* (${results[0].Year}) to the watchlist!`);
                } else {
                    // Multiple matches, ask for selection
                    let menu = `🤔 *Multiple matches found for "${query}"*\nReply with the number to add:\n\n`;
                    results.forEach((item, i) => {
                        const icon = item.Type === 'movie' ? '🎬' : '📺';
                        menu += `${i + 1}. ${icon} ${item.Title} (${item.Year})\n`;
                    });
                    menu += `\n_Type "cancel" to stop._`;
                    
                    pendingAdds.set(userKey, results);
                    await client.sendMessage(chatId, menu);
                }
            } else {
                await client.sendMessage(chatId, `❌ Could not find any movies or shows matching "${query}".`);
            }
        } catch (err) {
            console.error('[THE KERNEL // SEARCH_ERROR]', err.message);
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
            await client.sendMessage(chatId, `📂 The watchlist is empty!`);
        } else {
            const random = rows[Math.floor(Math.random() * rows.length)];
            const icon = random.type === 'movie' ? '🎬' : '📺';
            await client.sendMessage(chatId, `🎲 *The Kernel Picks:* \n\n${icon} *${random.title}* (${random.year})!`);
        }
    }
}

client.on('message_create', async (msg) => {
    if (msg.fromMe) return;

    const chatId = msg.from;
    const authorId = msg.author || msg.from;
    const userKey = `${chatId}:${authorId}`;
    const body = msg.body.trim();
    const lowerBody = body.toLowerCase();

    // Check if user has a pending selection
    if (pendingAdds.has(userKey)) {
        if (lowerBody === 'cancel') {
            pendingAdds.delete(userKey);
            await client.sendMessage(chatId, `👍 Selection cancelled.`);
            return;
        }

        const selection = parseInt(body);
        const results = pendingAdds.get(userKey);

        if (!isNaN(selection) && selection >= 1 && selection <= results.length) {
            const item = results[selection - 1];
            const contact = await msg.getContact();
            await saveToWatchlist(chatId, item.Title, item.Year, item.Type, contact.pushname || contact.number);
            pendingAdds.delete(userKey);
            await client.sendMessage(chatId, `✅ Added *${item.Title}* (${item.Year}) to the watchlist!`);
            return;
        }
    }

    if (lowerBody === '!help' || lowerBody === '!commands') {
        const help = `🤖 *The Kernel // COMMAND_MENU*\n\n` +
                     `📽️ *Search*\n` +
                     `• !movie [title] — Info, Streaming & Trailer\n` +
                     `• !show [title] — TV Series details\n\n` +
                     `📋 *Watchlist*\n` +
                     `• !add [title] — Save to group list\n` +
                     `• !watchlist — View group list\n` +
                     `• !pick — Randomly pick from list\n\n` +
                     `ℹ️ _Type a number to select from lists!_`;
        await client.sendMessage(chatId, help);
    } else if (lowerBody.startsWith('!movie ')) {
        const query = body.split('!movie ')[1]?.trim();
        if (query) await handleOMDbRequest(msg, query, 'movie');
    } else if (lowerBody.startsWith('!show ')) {
        const query = body.split('!show ')[1]?.trim();
        if (query) await handleOMDbRequest(msg, query, 'series');
    } else if (lowerBody.startsWith('!add ') || lowerBody === '!watchlist' || lowerBody === '!pick') {
        await handleWatchlist(msg);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('[THE KERNEL // SYSTEM_ERROR] Unhandled Rejection:', reason);
});

client.initialize();
