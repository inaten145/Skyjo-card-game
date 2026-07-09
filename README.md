# Skyjo Card Game

A fully playable Skyjo card game app built with React + Vite.

## Features

- **Pass & Play**: Play locally with up to 4 players on the same device
- **AI Opponent**: Challenge an AI player (2-player mode)
- **Share Link**: Play remotely with friends (up to 4 players) via shared link
- **Turn Notifications**: Audio alerts when it's your turn
- **Score Tracking**: Automatic score calculation and round management

## Game Rules

- Each player has 12 hidden cards
- On your turn: Draw a card or take from discard
- Then: Swap with one of your cards or discard without swapping
- Reveal cards as you swap them
- Round ends when all players have revealed all cards
- Goal: Lowest total score wins

## How to Deploy to Netlify

1. **Connect your GitHub repo** (if you push this code to GitHub)
   - Go to netlify.com
   - Click "New site from Git"
   - Connect your GitHub account and select this repo

2. **Or drag & drop the `dist` folder**
   - Go to netlify.com
   - Drag the `dist` folder to deploy instantly

3. **You'll get a live URL** to share with friends!

## Local Development

```bash
npm install
npm run dev
```

Visit `http://localhost:5173` to play.

## Build for Production

```bash
npm run build
```

Output is in the `dist` folder.
