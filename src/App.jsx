import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, RotateCcw, Share2, Copy, Check } from 'lucide-react';
import { createGame, joinGame, subscribeToGame, updateGameState, updateGame, updatePlayer } from './supabaseClient';
import './index.css';

const COLS = 4;
const ROWS = 3;
const CELLS = COLS * ROWS;

const createDeck = () => {
  const deck = [];
  for (let i = 0; i < 5; i++) deck.push(-2);
  for (let i = 0; i < 10; i++) deck.push(-1);
  for (let i = 0; i < 15; i++) deck.push(0);
  for (let v = 1; v <= 12; v++) {
    for (let i = 0; i < 10; i++) deck.push(v);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const cardStyle = (value) => {
  if (value === null) return {};
  if (value < 0) return { backgroundColor: '#39466B', color: '#FCFBF9' };
  if (value === 0) return { backgroundColor: '#8FB4C9', color: '#212D19' };
  if (value <= 4) return { backgroundColor: '#688666', color: '#FCFBF9' };
  if (value <= 8) return { backgroundColor: '#C79057', color: '#212D19' };
  return { backgroundColor: '#9C3F22', color: '#FCFBF9' };
};

const sumGrid = (grid) => grid.reduce((sum, v, i) => (v === null ? sum : sum + v), 0);

const SkyjoGame = () => {
  const [screen, setScreen] = useState('menu');
  const [playMode, setPlayMode] = useState(null);
  const [playerCount, setPlayerCount] = useState(2);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [gameId, setGameId] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [gameState, setGameState] = useState(null);
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
  const [revealIdx, setRevealIdx] = useState(0);
  const [revealsLeft, setRevealsLeft] = useState(2);
  const [message, setMessage] = useState('');

  const unsubscribeRef = useRef(null);
  const aiTimerRef = useRef(null);

  /* ---------- Sound ---------- */
  const playSound = (type) => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      if (type === 'turn') {
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.linearRampToValueAtTime(820, now + 0.12);
      } else if (type === 'flip') {
        osc.frequency.setValueAtTime(480, now);
      } else if (type === 'column') {
        osc.frequency.setValueAtTime(900, now);
        osc.frequency.linearRampToValueAtTime(500, now + 0.2);
      } else if (type === 'round') {
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(400, now + 0.3);
      }
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      /* audio unsupported */
    }
  };

  /* ---------- Game Setup ---------- */
  const startNewGame = async () => {
    try {
      const newGameId = await createGame(playMode === 'ai' ? 2 : playerCount, playMode);
      setGameId(newGameId);
      setJoinCode(newGameId);
      await loadGame(newGameId);
    } catch (err) {
      setMessage('Error creating game: ' + err.message);
    }
  };

  const loadGame = async (gid) => {
    try {
      const data = await joinGame(gid);
      setGame(data.game);
      setPlayers(data.players);
      setGameState(data.state);
      setCurrentPlayerIdx(data.game.current_player_idx);
      setScreen('playing');

      if (unsubscribeRef.current) unsubscribeRef.current();
      unsubscribeRef.current = subscribeToGame(gid, handleGameUpdate);
    } catch (err) {
      setMessage('Error loading game: ' + err.message);
    }
  };

  const handleGameUpdate = (update) => {
    if (update.type === 'game') setGame(update.data);
    if (update.type === 'players') {
      setPlayers((prev) =>
        prev.map((p) => (p.id === update.data.id ? update.data : p))
      );
    }
    if (update.type === 'state') setGameState(update.data);
  };

  /* ---------- Turn Actions ---------- */
  const drawCard = async () => {
    if (!gameState || gameState.drawn_card !== null) return;
    const newDeck = [...gameState.deck];
    if (newDeck.length === 0) {
      endRound();
      return;
    }
    const card = newDeck.shift();
    await updateGameState(gameId, {
      drawn_card: card,
      drawn_source: 'deck',
      deck: newDeck,
      message: `Drew ${card}. Swap it into your grid, or discard it.`,
    });
    playSound('flip');
  };

  const takeDiscard = async () => {
    if (!gameState || gameState.drawn_card !== null || gameState.discard.length === 0) return;
    const newDiscard = [...gameState.discard];
    const card = newDiscard.pop();
    await updateGameState(gameId, {
      drawn_card: card,
      drawn_source: 'discard',
      discard: newDiscard,
      message: `Took ${card} from discard. Must swap it into your grid.`,
    });
    playSound('flip');
  };

  const swapCard = async (cellIdx) => {
    if (!gameState?.drawn_card) return;
    const player = players[currentPlayerIdx];
    const newGrid = [...player.grid];
    const newRevealed = [...player.revealed];
    const oldCard = newGrid[cellIdx];

    newGrid[cellIdx] = gameState.drawn_card;
    newRevealed[cellIdx] = true;

    const newDiscard = [...gameState.discard, oldCard];

    await updatePlayer(player.id, {
      grid: newGrid,
      revealed: newRevealed,
    });

    const finished = newRevealed.every((r) => r);

    await updateGameState(gameId, {
      drawn_card: null,
      drawn_source: null,
      discard: newDiscard,
      message: finished
        ? `${player.name} revealed everything! Everyone else gets one last turn.`
        : `${players[(currentPlayerIdx + 1) % players.length].name}'s turn.`,
    });

    playSound('flip');

    if (finished) {
      await updateGame(gameId, {
        finisher_idx: currentPlayerIdx,
        final_turns_left: players.length - 1,
      });
    } else {
      const nextIdx = (currentPlayerIdx + 1) % players.length;
      await updateGame(gameId, { current_player_idx: nextIdx });
      setCurrentPlayerIdx(nextIdx);
    }
  };

  const discardCard = async () => {
    if (!gameState?.drawn_card || gameState.drawn_source !== 'deck') return;
    const newDiscard = [...gameState.discard, gameState.drawn_card];
    await updateGameState(gameId, {
      drawn_card: null,
      drawn_source: null,
      discard: newDiscard,
      must_reveal: true,
      message: 'Now reveal one of your hidden cards.',
    });
    playSound('flip');
  };

  const revealCard = async (cellIdx) => {
    const player = players[currentPlayerIdx];
    if (player.revealed[cellIdx]) return;
    const newRevealed = [...player.revealed];
    newRevealed[cellIdx] = true;

    await updatePlayer(player.id, {
      revealed: newRevealed,
    });

    const finished = newRevealed.every((r) => r);

    const nextIdx = (currentPlayerIdx + 1) % players.length;
    await updateGame(gameId, { current_player_idx: nextIdx });
    await updateGameState(gameId, {
      must_reveal: false,
      message: finished
        ? `${player.name} revealed everything!`
        : `${players[nextIdx].name}'s turn.`,
    });

    setCurrentPlayerIdx(nextIdx);
    playSound('flip');

    if (finished) {
      await updateGame(gameId, {
        finisher_idx: currentPlayerIdx,
        final_turns_left: players.length - 1,
      });
    }
  };

  const endRound = async () => {
    playSound('round');
    // Score calculation and round end logic
    const newPlayers = players.map((p) => {
      const roundScore = sumGrid(p.grid);
      return {
        ...p,
        roundScores: [...(p.round_scores || []), roundScore],
        score: p.score + roundScore,
      };
    });

    setPlayers(newPlayers);
    setMessage('Round complete!');

    if (newPlayers.some((p) => p.score >= 100)) {
      setScreen('gameEnd');
    } else {
      setScreen('roundEnd');
    }
  };

  const copyGameLink = () => {
    const url = `${window.location.origin}?join=${gameId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetGame = () => {
    if (unsubscribeRef.current) unsubscribeRef.current();
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    setScreen('menu');
    setGameId(null);
    setGame(null);
    setPlayers([]);
    setGameState(null);
  };

  /* ---------- UI Components ---------- */
  const feltBg = {
    background:
      'radial-gradient(ellipse at 50% 30%, #2E3D24 0%, #212D19 60%, #17200F 100%)',
    minHeight: '100vh',
  };

  const CardFace = ({ value, revealed, removed, onClick, disabled, size = 'md' }) => {
    const sizes = {
      md: 'w-14 h-20 md:w-16 md:h-24 text-2xl md:text-3xl',
      sm: 'w-5 h-7 text-[9px]',
    };
    if (removed) {
      return (
        <div
          className={`${sizes[size]} rounded-lg border border-dashed opacity-30`}
          style={{ borderColor: '#E5DACB' }}
        />
      );
    }
    if (!revealed) {
      return (
        <button
          onClick={onClick}
          disabled={disabled}
          className={`${sizes[size]} rounded-lg font-bold flex items-center justify-center transition-transform shadow-lg ${
            !disabled ? 'hover:scale-105 active:scale-95 cursor-pointer' : ''
          }`}
          style={{
            backgroundColor: '#E5DACB',
            color: '#9C3F22',
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(156,63,34,0.12) 6px, rgba(156,63,34,0.12) 12px)',
            boxShadow: '0 3px 6px rgba(0,0,0,0.4)',
          }}
        >
          {size === 'md' ? '✦' : ''}
        </button>
      );
    }
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${sizes[size]} rounded-lg font-extrabold flex items-center justify-center transition-transform shadow-lg ${
          !disabled ? 'hover:scale-105 active:scale-95' : ''
        }`}
        style={{
          ...cardStyle(value),
          boxShadow: '0 3px 6px rgba(0,0,0,0.4)',
          fontFamily: "'Grandstander', system-ui, sans-serif",
        }}
      >
        {value}
      </button>
    );
  };

  const PlayerGrid = ({ player, interactive, onCellTap, tapMode }) => (
    <div className="flex justify-center gap-2 md:gap-3">
      {Array.from({ length: COLS }).map((_, col) => (
        <div key={col} className="flex flex-col gap-2 md:gap-3">
          {Array.from({ length: ROWS }).map((_, row) => {
            const idx = col * ROWS + row;
            const removed = player.grid[idx] === null;
            const revealed = player.revealed[idx];
            return (
              <CardFace
                key={idx}
                value={player.grid[idx]}
                revealed={revealed}
                removed={removed}
                disabled={!interactive || removed}
                onClick={() => interactive && onCellTap && onCellTap(idx)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );

  const BrandButton = ({ onClick, children, color = '#9C3F22', textColor = '#FCFBF9', disabled }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-4 px-6 rounded-xl font-bold text-lg transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40 shadow-lg"
      style={{
        backgroundColor: color,
        color: textColor,
        fontFamily: "'Grandstander', system-ui, sans-serif",
      }}
    >
      {children}
    </button>
  );

  /* ---------- SCREENS ---------- */
  if (screen === 'menu') {
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h1
            className="text-7xl font-black mb-2 tracking-tight"
            style={{ color: '#E5DACB', fontFamily: "'Grandstander', system-ui, sans-serif", textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
          >
            SKYJO
          </h1>
          <div className="flex justify-center gap-1.5 mb-10">
            {[-1, 3, 7, 11].map((v) => (
              <div
                key={v}
                className="w-8 h-11 rounded-md font-extrabold text-sm flex items-center justify-center shadow-md"
                style={{ ...cardStyle(v), transform: `rotate(${(v % 5) * 3 - 4}deg)` }}
              >
                {v}
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <BrandButton
              color="#9C3F22"
              onClick={() => {
                setPlayMode('local');
                setScreen('setup');
              }}
            >
              Pass & Play
            </BrandButton>
            <BrandButton
              color="#688666"
              onClick={() => {
                setPlayMode('ai');
                setScreen('setup');
              }}
            >
              Play vs AI
            </BrandButton>
            <BrandButton
              color="#C79057"
              onClick={() => {
                setPlayMode('multiplayer');
                setScreen('setup');
              }}
            >
              Online Multiplayer
            </BrandButton>
          </div>
          <p className="mt-8 text-sm" style={{ color: '#688666' }}>
            Lowest score wins · Game ends at 100 points
          </p>
        </div>
      </div>
    );
  }

  if (screen === 'setup') {
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h2
            className="text-3xl font-bold mb-8"
            style={{ color: '#E5DACB', fontFamily: "'Grandstander', system-ui, sans-serif" }}
          >
            {playMode === 'ai'
              ? 'You vs AI'
              : playMode === 'multiplayer'
              ? 'Online Multiplayer'
              : 'Pass & Play'}
          </h2>

          <div className="mb-10">
            <label className="block text-lg font-semibold mb-4" style={{ color: '#E5DACB' }}>
              {playMode === 'ai'
                ? 'Players: You + 1 AI'
                : playMode === 'multiplayer'
                ? `Players: ${playerCount}`
                : `Players: ${playerCount}`}
            </label>
            {playMode !== 'ai' && (
              <div className="flex justify-center gap-3">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPlayerCount(n)}
                    className="w-16 h-16 rounded-xl font-black text-2xl transition shadow-lg"
                    style={{
                      backgroundColor: playerCount === n ? '#C79057' : 'rgba(252,251,249,0.1)',
                      color: playerCount === n ? '#212D19' : '#E5DACB',
                      fontFamily: "'Grandstander', system-ui, sans-serif",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>

          <BrandButton color="#9C3F22" onClick={startNewGame}>
            Deal Cards
          </BrandButton>
          <button
            onClick={resetGame}
            className="mt-4 text-sm font-semibold underline"
            style={{ color: '#688666' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'playing' && players.length > 0) {
    const player = players[currentPlayerIdx];
    const isCurrentPlayer = true; // Simplified for demo

    return (
      <div style={feltBg} className="p-3 md:p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1
              className="text-2xl md:text-3xl font-black"
              style={{ color: '#E5DACB', fontFamily: "'Grandstander', system-ui, sans-serif" }}
            >
              SKYJO
            </h1>
            {playMode === 'multiplayer' && gameId && (
              <button
                onClick={copyGameLink}
                className="p-2 rounded-lg flex items-center gap-2"
                style={{ backgroundColor: '#C79057', color: '#212D19' }}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            )}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-lg"
              style={{ backgroundColor: 'rgba(252,251,249,0.1)', color: '#E5DACB' }}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>

          {message && (
            <div
              className="text-center mb-4 py-2.5 px-4 rounded-xl font-bold"
              style={{ backgroundColor: '#C79057', color: '#212D19' }}
            >
              {message}
            </div>
          )}

          <PlayerGrid
            player={player}
            interactive={isCurrentPlayer && gameState?.drawn_card}
            tapMode={gameState?.drawn_card ? 'swap' : null}
            onCellTap={(idx) => swapCard(idx)}
          />

          <div className="flex justify-center gap-4 mt-8">
            <button
              onClick={drawCard}
              disabled={!gameState || gameState.drawn_card !== null}
              className="px-6 py-3 rounded-lg font-bold text-white"
              style={{ backgroundColor: '#9C3F22' }}
            >
              Draw ({gameState?.deck.length || 0})
            </button>
            <button
              onClick={takeDiscard}
              disabled={!gameState || gameState.drawn_card !== null}
              className="px-6 py-3 rounded-lg font-bold text-white"
              style={{ backgroundColor: '#688666' }}
            >
              Discard ({gameState?.discard.length || 0})
            </button>
          </div>

          <button
            onClick={resetGame}
            className="mt-8 w-full py-3 px-6 rounded-lg font-semibold"
            style={{ backgroundColor: '#3E4A38', color: '#E5DACB' }}
          >
            Quit
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default SkyjoGame;
