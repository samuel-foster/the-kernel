# The Kernel - WhatsApp Movie & TV Bot

The Kernel is an autonomous WhatsApp bot built with Node.js and `whatsapp-web.js`. It listens to your group chats or direct messages and provides instant movie ratings, TV show details, streaming availability, and YouTube trailers. It also features a fully interactive group watchlist powered by SQLite.

## Features

- 📽️ **Search (`!movie`, `!show`)**: Instantly fetch IMDb ratings, plot summaries, and genres.
- 📡 **Streaming Availability**: Tells you exactly where to watch the title (Netflix, Amazon Prime, Hulu, etc.) via the Watchmode API.
- 🎥 **Automatic Trailers**: Fetches the top official YouTube trailer link automatically.
- 📋 **Interactive Watchlists (`!add`, `!watchlist`, `!pick`)**: Maintain a per-chat to-watch list. If you add a vague title, the bot provides a numbered list of matches for you to choose from!

## Prerequisites

- Node.js v18.0.0 or higher.
- A spare WhatsApp account (to link the bot via QR code).
- PM2 (recommended for keeping the bot running in the background).

## Setup

1. **Clone or Download the Repository:**
   ```bash
   git clone <your-repo-url>
   cd the-kernel
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory (do not commit this file) with your API keys:
   ```env
   OMDB_API_KEY=your_omdb_key
   WATCHMODE_API_KEY=your_watchmode_key
   YOUTUBE_API_KEY=your_youtube_key
   ```
   *Note: OMDb is required. Watchmode and YouTube are optional; if missing, those sections will be skipped.*

4. **Start the Bot:**
   Run the bot normally:
   ```bash
   node index.js
   ```
   Or use PM2 to run it in the background:
   ```bash
   npm install -g pm2
   pm2 start index.js --name "the-kernel"
   pm2 save
   ```

5. **Authenticate:**
   Check the console output (or `pm2 logs the-kernel`) for a QR code. Open your spare WhatsApp account on your phone, go to **Linked Devices**, and scan the code. 
   You will see `[THE KERNEL // SYSTEM_READY] Online and monitoring.` once connected.

## Usage Commands

Send these commands in any chat where the bot is present:

- `!help` or `!commands` — View the command menu.
- `!movie [title]` — Get movie details, streaming sources, and trailer.
- `!show [title]` — Get TV show details, seasons, streaming sources, and trailer.
- `!add [title]` — Search and add a title to the current chat's watchlist.
- `!watchlist` — Display the group's current watchlist.
- `!pick` — Randomly select a title from the watchlist.

## Tech Stack
- `whatsapp-web.js` (WhatsApp Web API)
- `axios` (HTTP requests)
- `better-sqlite3` (Local database for watchlists)
- `dotenv` (Environment variables)
