import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, RotateCcw, Copy, Check } from 'lucide-react';
import {
  createOnlineGame,
  claimSeat,
  fetchFullGame,
  updateGameRow,
  updateStateRow,
  updatePlayerRow,
  subscribeToGame,
  OPEN_SEAT,
} from './supabaseClient';
import './index.css';

/* ============================================================
   SKYJO — official rules
   Local Pass & Play and vs-AI run fully on-device.
   Online multiplayer syncs through Supabase (realtime + polling).
   ============================================================ */

const COLS = 4;
const ROWS = 3;
const CELLS = COLS * ROWS;
const PAUSE_MS = 1500; // pause after a flip so everyone can see the result

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

// Official Skyjo card colors with gradient pairs for a realistic finish
const cardPalette = (value) => {
  if (value < 0) return { light: '#3D4DB7', base: '#2B3990', dark: '#1F2A6E', text: '#FFFFFF' };
  if (value === 0) return { light: '#8AD4F0', base: '#6BC5E8', dark: '#4FAAD0', text: '#123047' };
  if (value <= 4) return { light: '#92C963', base: '#7AB648', dark: '#5F9634', text: '#FFFFFF' };
  if (value <= 8) return { light: '#F9DE5C', base: '#F5D130', dark: '#D9B516', text: '#4A3B00' };
  return { light: '#E5524E', base: '#D9302C', dark: '#B02320', text: '#FFFFFF' };
};

const sumGrid = (grid) => grid.reduce((s, v) => (v === null ? s : s + v), 0);
const revealedSum = (player) =>
  player.grid.reduce((s, v, i) => (v !== null && player.revealed[i] ? s + v : s), 0);

const isFinished = (grid, revealed) => grid.every((v, i) => v === null || revealed[i]);

const applyColumnRule = (grid, revealed, discard) => {
  const g = [...grid];
  const r = [...revealed];
  let removed = false;
  for (let col = 0; col < COLS; col++) {
    const idxs = [col * ROWS, col * ROWS + 1, col * ROWS + 2];
    const vals = idxs.map((i) => g[i]);
    if (
      vals.every((v) => v !== null) &&
      idxs.every((i) => r[i]) &&
      vals[0] === vals[1] &&
      vals[1] === vals[2]
    ) {
      idxs.forEach((i) => {
        discard.push(g[i]);
        g[i] = null;
      });
      removed = true;
    }
  }
  return { grid: g, revealed: r, removed };
};

const ensureDeck = (deckArr, discardArr) => {
  if (deckArr.length === 0 && discardArr.length > 1) {
    const top = discardArr[discardArr.length - 1];
    const rest = discardArr.slice(0, -1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return { deck: rest, discard: [top] };
  }
  return { deck: deckArr, discard: discardArr };
};

/* ============================================================
   DESIGN SYSTEM — Apple-inspired: white, clean lines, realistic cards
   ============================================================ */

const T = {
  pageBg: '#F5F5F7',
  panel: '#FFFFFF',
  ink: '#1D1D1F',
  gray: '#86868B',
  hairline: '#D2D2D7',
  accent: '#0071E3',
  green: '#34C759',
  font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
};

const pageStyle = {
  backgroundColor: T.pageBg,
  minHeight: '100vh',
  fontFamily: T.font,
  color: T.ink,
};

/* ---------- module-scope components (fixes the one-character input bug) ---------- */

const NameInput = ({ value, onChange, placeholder }) => (
  <input
    type="text"
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    maxLength={16}
    autoComplete="off"
    className="w-full py-3.5 px-4 rounded-xl text-[17px] outline-none transition-shadow"
    style={{
      backgroundColor: '#FFFFFF',
      border: `1px solid ${T.hairline}`,
      color: T.ink,
      fontFamily: T.font,
    }}
    onFocus={(e) => (e.target.style.boxShadow = `0 0 0 3px rgba(0,113,227,0.25)`)}
    onBlur={(e) => (e.target.style.boxShadow = 'none')}
  />
);

const Button = ({ onClick, children, variant = 'primary', disabled }) => {
  const styles = {
    primary: { backgroundColor: T.ink, color: '#FFFFFF', border: '1px solid transparent' },
    secondary: { backgroundColor: '#FFFFFF', color: T.ink, border: `1px solid ${T.hairline}` },
    accent: { backgroundColor: T.accent, color: '#FFFFFF', border: '1px solid transparent' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-[15px] px-6 rounded-full font-semibold text-[17px] transition hover:opacity-85 active:scale-[0.985] disabled:opacity-40"
      style={{ ...styles[variant], fontFamily: T.font }}
    >
      {children}
    </button>
  );
};

const CardFace = ({ value, revealed, removed, onClick, disabled, highlight, size = 'md' }) => {
  const sizes = {
    md: 'w-[54px] h-[76px] md:w-16 md:h-[90px]',
    sm: 'w-5 h-7',
  };
  const numSize = size === 'md' ? 'text-[26px] md:text-3xl' : 'text-[9px]';

  if (removed) {
    return (
      <div
        className={`${sizes[size]} rounded-[10px]`}
        style={{ border: `1.5px dashed ${T.hairline}`, backgroundColor: 'rgba(0,0,0,0.02)' }}
      />
    );
  }

  const realisticShadow =
    size === 'md'
      ? '0 1px 2px rgba(0,0,0,0.14), 0 6px 14px rgba(0,0,0,0.12), 0 12px 28px rgba(0,0,0,0.06)'
      : '0 1px 2px rgba(0,0,0,0.15)';

  if (!revealed) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={`${sizes[size]} rounded-[10px] relative transition-transform ${
          !disabled ? 'hover:-translate-y-0.5 active:scale-95 cursor-pointer' : ''
        }`}
        style={{
          background:
            'linear-gradient(165deg, #FFFFFF 0%, #F4F4F6 60%, #EBEBEF 100%)',
          border: '1px solid #E3E3E8',
          boxShadow: highlight
            ? `0 0 0 3px rgba(0,113,227,0.45), ${realisticShadow}`
            : realisticShadow,
        }}
      >
        {size === 'md' && (
          <span
            className="absolute inset-0 flex items-center justify-center font-bold"
            style={{ color: '#2B3990', fontSize: 18 }}
          >
            ◆
          </span>
        )}
        {/* sheen */}
        <span
          className="absolute inset-0 rounded-[10px] pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0) 35%)',
          }}
        />
      </button>
    );
  }

  const p = cardPalette(value);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${sizes[size]} rounded-[10px] relative transition-transform ${
        !disabled ? 'hover:-translate-y-0.5 active:scale-95 cursor-pointer' : ''
      }`}
      style={{
        background: `linear-gradient(160deg, ${p.light} 0%, ${p.base} 55%, ${p.dark} 100%)`,
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: realisticShadow,
      }}
    >
      {size === 'md' && (
        <span
          className="absolute top-1 left-1.5 font-bold leading-none"
          style={{ color: p.text, fontSize: 11, opacity: 0.85 }}
        >
          {value}
        </span>
      )}
      <span
        className={`absolute inset-0 flex items-center justify-center font-bold ${numSize}`}
        style={{
          color: p.text,
          textShadow: '0 1px 1px rgba(0,0,0,0.15)',
          fontFamily: T.font,
        }}
      >
        {value}
      </span>
      {/* glossy sheen */}
      <span
        className="absolute inset-0 rounded-[10px] pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 40%, rgba(0,0,0,0.04) 100%)',
        }}
      />
    </button>
  );
};

const PlayerGrid = ({ player, interactive, onCellTap, tapMode }) => (
  <div className="flex justify-center gap-2 md:gap-2.5">
    {Array.from({ length: COLS }).map((_, col) => (
      <div key={col} className="flex flex-col gap-2 md:gap-2.5">
        {Array.from({ length: ROWS }).map((_, row) => {
          const idx = col * ROWS + row;
          const removed = player.grid[idx] === null;
          const revealed = player.revealed[idx];
          let disabled = !interactive || removed;
          if (interactive && tapMode === 'reveal' && revealed) disabled = true;
          return (
            <CardFace
              key={idx}
              value={player.grid[idx]}
              revealed={revealed}
              removed={removed}
              disabled={disabled}
              highlight={interactive && tapMode === 'reveal' && !revealed}
              onClick={() => onCellTap && onCellTap(idx)}
            />
          );
        })}
      </div>
    ))}
  </div>
);

const MiniGrid = ({ player, active }) => (
  <div
    className="p-2.5 rounded-2xl"
    style={{
      backgroundColor: T.panel,
      border: `1px solid ${active ? T.accent : '#EBEBEE'}`,
      boxShadow: active
        ? '0 0 0 3px rgba(0,113,227,0.15), 0 2px 8px rgba(0,0,0,0.06)'
        : '0 2px 8px rgba(0,0,0,0.05)',
    }}
  >
    <div className="flex items-center justify-between gap-2 mb-1.5 px-0.5">
      <p className="text-[11px] font-semibold truncate max-w-[80px]" style={{ color: T.ink }}>
        {player.name}
      </p>
      {active && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: T.accent }} />}
    </div>
    <div className="flex gap-0.5 justify-center">
      {Array.from({ length: COLS }).map((_, col) => (
        <div key={col} className="flex flex-col gap-0.5">
          {Array.from({ length: ROWS }).map((_, row) => {
            const idx = col * ROWS + row;
            return (
              <CardFace
                key={idx}
                size="sm"
                value={player.grid[idx]}
                revealed={player.revealed[idx]}
                removed={player.grid[idx] === null}
                disabled
              />
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

// Scoreboard strip: total score + what each player is currently showing
const ScoreBoard = ({ players, currentIdx }) => (
  <div className="flex gap-2 justify-center flex-wrap mb-4">
    {players.map((p, i) => (
      <div
        key={i}
        className="px-3.5 py-2 rounded-xl flex items-center gap-2.5"
        style={{
          backgroundColor: T.panel,
          border: `1px solid ${i === currentIdx ? T.accent : '#EBEBEE'}`,
          boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}
      >
        {i === currentIdx && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: T.accent }} />
        )}
        <span className="text-[13px] font-semibold" style={{ color: T.ink }}>
          {p.name}
        </span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color: T.ink }}>
          {p.score}
          <span className="font-medium" style={{ color: T.gray }}>
            {' '}
            pts
          </span>
        </span>
        <span className="text-[12px] tabular-nums" style={{ color: T.gray }}>
          showing {revealedSum(p)}
        </span>
      </div>
    ))}
  </div>
);

// The table surface the cards sit on
const TableSurface = ({ children }) => (
  <div
    className="rounded-[28px] px-4 py-6 md:px-8 md:py-8"
    style={{
      background: 'linear-gradient(180deg, #FFFFFF 0%, #FAFAFB 100%)',
      border: '1px solid #EBEBEE',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)',
    }}
  >
    {children}
  </div>
);

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

const SkyjoGame = () => {
  const [screen, setScreen] = useState('menu');
  const [playMode, setPlayMode] = useState(null); // 'local' | 'ai' | 'online'
  const [playerCount, setPlayerCount] = useState(2);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [nameInputs, setNameInputs] = useState(['', '', '', '']);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [players, setPlayers] = useState([]);
  const [deck, setDeck] = useState([]);
  const [discard, setDiscard] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [drawn, setDrawn] = useState(null);
  const [mustReveal, setMustReveal] = useState(false);
  const [finisherIdx, setFinisherIdx] = useState(null);
  const [finalTurnsLeft, setFinalTurnsLeft] = useState(0);
  const [message, setMessage] = useState('');
  const [pausing, setPausing] = useState(false);

  const [revealIdx, setRevealIdx] = useState(0);
  const [revealsLeft, setRevealsLeft] = useState(2);

  const [gameId, setGameId] = useState(null);
  const [mySeat, setMySeat] = useState(null);
  const [joinTargetId, setJoinTargetId] = useState(null);
  const [busy, setBusy] = useState(false);

  const aiTimer = useRef(null);
  const pauseTimer = useRef(null);
  const pollTimer = useRef(null);
  const unsubscribe = useRef(null);
  const prevTurnRef = useRef(null);

  const isOnline = playMode === 'online';

  /* ---------- sound ---------- */
  const playSound = useCallback(
    (type) => {
      if (!soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.2, now);
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
        } else {
          osc.frequency.setValueAtTime(500, now);
        }
        osc.start(now);
        osc.stop(now + 0.25);
      } catch (e) {
        /* unsupported */
      }
    },
    [soundEnabled]
  );

  /* ============================================================
     LOCAL ENGINE
     ============================================================ */

  const dealLocalRound = (existingPlayers, round) => {
    const newDeck = createDeck();
    const count = existingPlayers.length || playerCount;
    const newPlayers = [];
    for (let i = 0; i < count; i++) {
      const grid = newDeck.splice(0, CELLS);
      const base =
        existingPlayers[i] || {
          id: i,
          name:
            playMode === 'ai'
              ? i === 0
                ? nameInputs[0].trim() || 'You'
                : `AI ${i}`
              : nameInputs[i].trim() || `Player ${i + 1}`,
          score: 0,
          roundScores: [],
          isAI: playMode === 'ai' && i !== 0,
        };
      newPlayers.push({ ...base, grid, revealed: new Array(CELLS).fill(false) });
    }
    const firstDiscard = newDeck.shift();
    setPlayers(newPlayers);
    setDeck(newDeck);
    setDiscard([firstDiscard]);
    setDrawn(null);
    setMustReveal(false);
    setFinisherIdx(null);
    setFinalTurnsLeft(0);
    setRoundNumber(round);
    setRevealIdx(0);
    setRevealsLeft(2);
    setPausing(false);
    setScreen('initialReveal');
    setMessage(`${newPlayers[0].name}: reveal two cards.`);
  };

  const handleLocalInitialReveal = (cellIdx) => {
    const p = players[revealIdx];
    if (p.revealed[cellIdx]) return;
    const newPlayers = players.map((pl, i) =>
      i === revealIdx
        ? { ...pl, revealed: pl.revealed.map((r, c) => (c === cellIdx ? true : r)) }
        : pl
    );
    setPlayers(newPlayers);
    playSound('flip');
    if (revealsLeft - 1 === 0) advanceLocalInitialReveal(newPlayers);
    else setRevealsLeft(revealsLeft - 1);
  };

  const advanceLocalInitialReveal = (curPlayers) => {
    let next = revealIdx + 1;
    let updated = curPlayers;
    while (next < updated.length && updated[next].isAI) {
      const picks = [];
      while (picks.length < 2) {
        const r = Math.floor(Math.random() * CELLS);
        if (!picks.includes(r)) picks.push(r);
      }
      updated = updated.map((pl, i) =>
        i === next
          ? { ...pl, revealed: pl.revealed.map((rv, c) => (picks.includes(c) ? true : rv)) }
          : pl
      );
      next++;
    }
    setPlayers(updated);

    if (next >= updated.length) {
      let bestIdx = 0;
      let bestSum = -Infinity;
      updated.forEach((pl, i) => {
        const s = pl.grid.reduce((sum, v, c) => (pl.revealed[c] ? sum + v : sum), 0);
        if (s > bestSum) {
          bestSum = s;
          bestIdx = i;
        }
      });
      setCurrentIdx(bestIdx);
      setScreen('playing');
      setMessage(`${updated[bestIdx].name} starts (highest revealed total).`);
      playSound('turn');
      if (updated[bestIdx].isAI) {
        scheduleAI(updated, [...deck], [...discard], bestIdx, null, 0);
      }
    } else {
      setRevealIdx(next);
      setRevealsLeft(2);
      setMessage(`${updated[next].name}: reveal two cards.`);
    }
  };

  const localDraw = () => {
    if (drawn || mustReveal || pausing) return;
    const fixed = ensureDeck([...deck], [...discard]);
    if (fixed.deck.length === 0) return;
    const card = fixed.deck.shift();
    setDeck(fixed.deck);
    setDiscard(fixed.discard);
    setDrawn({ card, source: 'deck' });
    setMessage(`Drew ${card}. Tap a card to swap, or discard it and flip a hidden card.`);
    playSound('flip');
  };

  const localTakeDiscard = () => {
    if (drawn || mustReveal || pausing || discard.length === 0) return;
    const card = discard[discard.length - 1];
    setDiscard(discard.slice(0, -1));
    setDrawn({ card, source: 'discard' });
    setMessage(`Took ${card} from discard. Tap one of your cards to swap it in.`);
    playSound('flip');
  };

  const localDiscardDrawn = () => {
    if (!drawn || drawn.source !== 'deck' || pausing) return;
    setDiscard([...discard, drawn.card]);
    setDrawn(null);
    setMustReveal(true);
    setMessage('Now tap a hidden card to reveal it.');
    playSound('flip');
  };

  const localCellTap = (cellIdx) => {
    if (pausing) return;
    const player = players[currentIdx];
    if (player.isAI || player.grid[cellIdx] === null) return;

    if (mustReveal) {
      if (player.revealed[cellIdx]) return;
      localCompleteMove(cellIdx, null, 'reveal');
    } else if (drawn) {
      localCompleteMove(cellIdx, drawn.card, 'swap');
    }
  };

  const localCompleteMove = (cellIdx, swapCard, kind) => {
    const newPlayers = players.map((p) => ({
      ...p,
      grid: [...p.grid],
      revealed: [...p.revealed],
    }));
    const newDiscard = [...discard];
    let player = newPlayers[currentIdx];
    let flippedValue;

    if (kind === 'swap') {
      newDiscard.push(player.grid[cellIdx]);
      flippedValue = swapCard;
      player.grid[cellIdx] = swapCard;
      player.revealed[cellIdx] = true;
      setDrawn(null);
    } else {
      flippedValue = player.grid[cellIdx];
      player.revealed[cellIdx] = true;
      setMustReveal(false);
    }
    playSound('flip');

    const col = applyColumnRule(player.grid, player.revealed, newDiscard);
    player.grid = col.grid;
    player.revealed = col.revealed;
    if (col.removed) playSound('column');

    setPlayers(newPlayers);
    setDiscard(newDiscard);
    setMessage(
      kind === 'swap'
        ? `${player.name} swapped in a ${flippedValue}.`
        : `${player.name} revealed a ${flippedValue}.` +
            (col.removed ? ' Column of three cleared!' : '')
    );

    // Pause so the flipped card is visible before the turn passes
    setPausing(true);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => {
      setPausing(false);
      localAdvanceTurn(newPlayers, deck, newDiscard, currentIdx);
    }, PAUSE_MS);
  };

  const localAdvanceTurn = (curPlayers, curDeck, curDiscard, justPlayed) => {
    let fIdx = finisherIdx;
    let turns = finalTurnsLeft;

    if (fIdx === null && isFinished(curPlayers[justPlayed].grid, curPlayers[justPlayed].revealed)) {
      fIdx = justPlayed;
      turns = curPlayers.length - 1;
      setFinisherIdx(fIdx);
      setFinalTurnsLeft(turns);
      setMessage(`${curPlayers[justPlayed].name} finished! Everyone else gets one last turn.`);
    } else if (fIdx !== null) {
      turns -= 1;
      setFinalTurnsLeft(turns);
    }

    if (fIdx !== null && turns <= 0) {
      endLocalRound(curPlayers, curDiscard, fIdx);
      return;
    }

    const nextIdx = (justPlayed + 1) % curPlayers.length;
    setCurrentIdx(nextIdx);
    playSound('turn');
    if (fIdx === null || nextIdx !== fIdx) {
      setMessage(`${curPlayers[nextIdx].name}'s turn.`);
    }
    if (curPlayers[nextIdx].isAI) {
      scheduleAI(curPlayers, [...curDeck], [...curDiscard], nextIdx, fIdx, turns);
    }
  };

  const scheduleAI = (p, d, disc, idx, fIdx, turns) => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => runAITurn(p, d, disc, idx, fIdx, turns), 1100);
  };

  const runAITurn = (curPlayers, curDeck, curDiscard, aiIdx, fIdx, turnsLeft) => {
    const newPlayers = curPlayers.map((p) => ({
      ...p,
      grid: [...p.grid],
      revealed: [...p.revealed],
    }));
    let player = newPlayers[aiIdx];
    let newDeck = [...curDeck];
    let newDiscard = [...curDiscard];

    const active = player.grid.map((v, i) => ({ v, i })).filter((c) => c.v !== null);
    const revealedCells = active.filter((c) => player.revealed[c.i]);
    const hiddenCells = active.filter((c) => !player.revealed[c.i]);
    const worst = revealedCells.reduce((b, c) => (b === null || c.v > b.v ? c : b), null);
    const top = newDiscard.length ? newDiscard[newDiscard.length - 1] : null;

    const takeDisc = top !== null && (top <= 3 || (worst && top < worst.v - 2));
    let card;
    let actionMsg;
    if (takeDisc) {
      card = newDiscard.pop();
      actionMsg = `${player.name} took the ${card} from discard`;
    } else {
      const fixed = ensureDeck(newDeck, newDiscard);
      newDeck = fixed.deck;
      newDiscard = fixed.discard;
      if (newDeck.length === 0) {
        endLocalRound(newPlayers, newDiscard, fIdx ?? aiIdx);
        return;
      }
      card = newDeck.shift();
      actionMsg = `${player.name} drew a ${card}`;
    }

    let target = null;
    if (worst && card < worst.v) target = worst.i;
    else if (hiddenCells.length > 0 && card <= 5)
      target = hiddenCells[Math.floor(Math.random() * hiddenCells.length)].i;
    else if (takeDisc)
      target = worst ? worst.i : hiddenCells[Math.floor(Math.random() * hiddenCells.length)].i;

    if (target !== null) {
      newDiscard.push(player.grid[target]);
      player.grid[target] = card;
      player.revealed[target] = true;
      actionMsg += ' and swapped it in.';
    } else {
      newDiscard.push(card);
      const flip = hiddenCells[Math.floor(Math.random() * hiddenCells.length)];
      player.revealed[flip.i] = true;
      actionMsg += ` and discarded it, revealing a ${player.grid[flip.i]}.`;
    }

    const col = applyColumnRule(player.grid, player.revealed, newDiscard);
    player.grid = col.grid;
    player.revealed = col.revealed;
    if (col.removed) {
      playSound('column');
      actionMsg += ' Column of three cleared!';
    }

    setPlayers(newPlayers);
    setDeck(newDeck);
    setDiscard(newDiscard);
    setMessage(actionMsg);
    playSound('flip');

    // Pause so you can see what the AI did before the turn moves on
    setPausing(true);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => {
      setPausing(false);

      let localF = fIdx;
      let localTurns = turnsLeft;
      if (localF === null && isFinished(player.grid, player.revealed)) {
        localF = aiIdx;
        localTurns = newPlayers.length - 1;
        setFinisherIdx(localF);
        setFinalTurnsLeft(localTurns);
        setMessage(`${player.name} finished! Everyone else gets one last turn.`);
      } else if (localF !== null) {
        localTurns -= 1;
        setFinalTurnsLeft(localTurns);
      }

      if (localF !== null && localTurns <= 0) {
        endLocalRound(newPlayers, newDiscard, localF);
        return;
      }

      const nextIdx = (aiIdx + 1) % newPlayers.length;
      setCurrentIdx(nextIdx);
      playSound('turn');
      if (newPlayers[nextIdx].isAI) {
        scheduleAI(newPlayers, newDeck, newDiscard, nextIdx, localF, localTurns);
      }
    }, PAUSE_MS);
  };

  const endLocalRound = (curPlayers, curDiscard, fIdx) => {
    playSound('round');
    const newDiscard = [...curDiscard];
    let finalPlayers = curPlayers.map((p) => {
      let grid = [...p.grid];
      let revealed = grid.map(() => true);
      const col = applyColumnRule(grid, revealed, newDiscard);
      return { ...p, grid: col.grid, revealed: col.revealed };
    });

    const roundScores = finalPlayers.map((p) => sumGrid(p.grid));
    const finScore = roundScores[fIdx];
    const othersMin = Math.min(...roundScores.filter((_, i) => i !== fIdx));
    let doubled = false;
    if (finScore > 0 && othersMin <= finScore) {
      roundScores[fIdx] = finScore * 2;
      doubled = true;
    }

    finalPlayers = finalPlayers.map((p, i) => ({
      ...p,
      roundScores: [...p.roundScores, roundScores[i]],
      score: p.score + roundScores[i],
    }));

    setPlayers(finalPlayers);
    setDiscard(newDiscard);
    setDrawn(null);
    setMustReveal(false);
    setMessage(
      doubled
        ? `${finalPlayers[fIdx].name} finished without the lowest score — points doubled!`
        : `${finalPlayers[fIdx].name} finished the round.`
    );
    setScreen(finalPlayers.some((p) => p.score >= 100) ? 'gameEnd' : 'roundEnd');
  };

  /* ============================================================
     ONLINE ENGINE
     ============================================================ */

  const refreshOnline = useCallback(async (gid) => {
    try {
      const data = await fetchFullGame(gid);
      applyOnlineSnapshot(data);
    } catch (e) {
      /* transient */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyOnlineSnapshot = (data) => {
    const { game, players: dbPlayers, state } = data;
    const mapped = dbPlayers.map((p) => ({
      id: p.id,
      dbId: p.id,
      name: p.name,
      isAI: p.is_ai,
      score: p.score,
      roundScores: p.round_scores || [],
      grid: p.grid,
      revealed: p.revealed,
      claimed: p.name !== OPEN_SEAT,
    }));
    setPlayers(mapped);
    setDeck(state.deck || []);
    setDiscard(state.discard || []);
    setDrawn(
      state.drawn_card !== null && state.drawn_card !== undefined
        ? { card: state.drawn_card, source: state.drawn_source }
        : null
    );
    setMustReveal(state.must_reveal);
    setMessage(state.message || '');
    setCurrentIdx(game.current_player_idx);
    setRoundNumber(game.round_number);
    setFinisherIdx(game.finisher_idx);
    setFinalTurnsLeft(game.final_turns_left);

    const status = game.status;
    if (status === 'lobby') setScreen('lobby');
    else if (status === 'initialReveal') setScreen('initialReveal');
    else if (status === 'playing') setScreen('playing');
    else if (status === 'roundEnd') setScreen('roundEnd');
    else if (status === 'gameEnd') setScreen('gameEnd');
  };

  const startOnlineSync = (gid) => {
    if (unsubscribe.current) unsubscribe.current();
    unsubscribe.current = subscribeToGame(gid, () => refreshOnline(gid));
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(() => refreshOnline(gid), 3500);
  };

  useEffect(() => {
    if (!isOnline || !mySeat) return;
    if (screen === 'playing' && currentIdx === mySeat.idx && prevTurnRef.current !== currentIdx) {
      playSound('turn');
      if (navigator.vibrate) navigator.vibrate(200);
      document.title = '🔵 Your turn — Skyjo';
    } else if (screen === 'playing') {
      document.title = 'Skyjo';
    }
    prevTurnRef.current = currentIdx;
  }, [currentIdx, screen, isOnline, mySeat, playSound]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join');
    if (join) {
      setPlayMode('online');
      setJoinTargetId(join);
      const saved = localStorage.getItem(`skyjo_seat_${join}`);
      if (saved) {
        const seat = JSON.parse(saved);
        setMySeat(seat);
        setGameId(join);
        refreshOnline(join).then(() => startOnlineSync(join));
      } else {
        setScreen('join');
      }
    }
    return () => {
      if (unsubscribe.current) unsubscribe.current();
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (aiTimer.current) clearTimeout(aiTimer.current);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hostOnlineGame = async () => {
    const hostName = nameInputs[0].trim();
    if (!hostName) {
      setErrorMsg('Enter your name first.');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    try {
      const { gameId: gid, mySeat: seat } = await createOnlineGame(hostName, playerCount);
      localStorage.setItem(`skyjo_seat_${gid}`, JSON.stringify(seat));
      setGameId(gid);
      setMySeat(seat);
      await refreshOnline(gid);
      startOnlineSync(gid);
    } catch (e) {
      setErrorMsg('Could not create game: ' + e.message);
    }
    setBusy(false);
  };

  const joinOnlineGame = async () => {
    const name = nameInputs[0].trim();
    if (!name) {
      setErrorMsg('Enter your name first.');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    try {
      const seat = await claimSeat(joinTargetId, name);
      localStorage.setItem(`skyjo_seat_${joinTargetId}`, JSON.stringify(seat));
      setGameId(joinTargetId);
      setMySeat(seat);

      const data = await fetchFullGame(joinTargetId);
      const stillOpen = data.players.some((p) => p.name === OPEN_SEAT);
      if (!stillOpen && data.game.status === 'lobby') {
        await updateGameRow(joinTargetId, { status: 'initialReveal' });
        await updateStateRow(joinTargetId, {
          message: 'All players joined! Everyone reveal two cards.',
        });
      }
      await refreshOnline(joinTargetId);
      startOnlineSync(joinTargetId);
    } catch (e) {
      setErrorMsg(e.message);
    }
    setBusy(false);
  };

  const onlineInitialReveal = async (cellIdx) => {
    const me = players[mySeat.idx];
    const myRevealedCount = me.revealed.filter(Boolean).length;
    if (myRevealedCount >= 2 || me.revealed[cellIdx]) return;

    const newRevealed = me.revealed.map((r, i) => (i === cellIdx ? true : r));
    playSound('flip');
    await updatePlayerRow(me.dbId, { revealed: newRevealed });

    const data = await fetchFullGame(gameId);
    const allReady = data.players.every((p) => p.revealed.filter(Boolean).length >= 2);
    if (allReady && data.game.status === 'initialReveal') {
      let bestIdx = 0;
      let bestSum = -Infinity;
      data.players.forEach((p, i) => {
        const s = p.grid.reduce((sum, v, c) => (p.revealed[c] ? sum + v : sum), 0);
        if (s > bestSum) {
          bestSum = s;
          bestIdx = i;
        }
      });
      await updateGameRow(gameId, { status: 'playing', current_player_idx: bestIdx });
      await updateStateRow(gameId, {
        message: `${data.players[bestIdx].name} starts (highest revealed total).`,
      });
    }
    refreshOnline(gameId);
  };

  const onlineDraw = async () => {
    if (drawn || mustReveal || pausing || currentIdx !== mySeat.idx) return;
    const fixed = ensureDeck([...deck], [...discard]);
    if (fixed.deck.length === 0) return;
    const card = fixed.deck.shift();
    playSound('flip');
    await updateStateRow(gameId, {
      deck: fixed.deck,
      discard: fixed.discard,
      drawn_card: card,
      drawn_source: 'deck',
      message: `${players[mySeat.idx].name} drew a card…`,
    });
    refreshOnline(gameId);
  };

  const onlineTakeDiscard = async () => {
    if (drawn || mustReveal || pausing || currentIdx !== mySeat.idx || discard.length === 0) return;
    const newDiscard = [...discard];
    const card = newDiscard.pop();
    playSound('flip');
    await updateStateRow(gameId, {
      discard: newDiscard,
      drawn_card: card,
      drawn_source: 'discard',
      message: `${players[mySeat.idx].name} took ${card} from the discard pile…`,
    });
    refreshOnline(gameId);
  };

  const onlineDiscardDrawn = async () => {
    if (!drawn || drawn.source !== 'deck' || pausing || currentIdx !== mySeat.idx) return;
    playSound('flip');
    await updateStateRow(gameId, {
      discard: [...discard, drawn.card],
      drawn_card: null,
      drawn_source: null,
      must_reveal: true,
      message: `${players[mySeat.idx].name} discarded and must reveal a card.`,
    });
    refreshOnline(gameId);
  };

  const onlineCellTap = async (cellIdx) => {
    if (pausing || currentIdx !== mySeat.idx) return;
    const me = players[mySeat.idx];
    if (me.grid[cellIdx] === null) return;

    let grid = [...me.grid];
    let revealed = [...me.revealed];
    let newDiscard = [...discard];
    let stateFields = {};
    let flippedValue;

    if (mustReveal) {
      if (revealed[cellIdx]) return;
      flippedValue = grid[cellIdx];
      revealed[cellIdx] = true;
      stateFields = { must_reveal: false };
    } else if (drawn) {
      newDiscard.push(grid[cellIdx]);
      flippedValue = drawn.card;
      grid[cellIdx] = drawn.card;
      revealed[cellIdx] = true;
      stateFields = { drawn_card: null, drawn_source: null };
    } else {
      return;
    }
    playSound('flip');

    const col = applyColumnRule(grid, revealed, newDiscard);
    grid = col.grid;
    revealed = col.revealed;
    if (col.removed) playSound('column');

    // Write the flip immediately so everyone sees it, but hold the turn
    // for a moment before advancing so the result is visible.
    await updatePlayerRow(me.dbId, { grid, revealed });
    await updateStateRow(gameId, {
      ...stateFields,
      discard: newDiscard,
      message:
        `${me.name} ${mustReveal ? 'revealed' : 'played'} a ${flippedValue}.` +
        (col.removed ? ' Column of three cleared!' : ''),
    });

    setPausing(true);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    setPausing(false);

    let fIdx = finisherIdx;
    let turns = finalTurnsLeft;
    let msg;
    if (fIdx === null && isFinished(grid, revealed)) {
      fIdx = mySeat.idx;
      turns = players.length - 1;
      msg = `${me.name} finished! Everyone else gets one last turn.`;
    } else if (fIdx !== null) {
      turns -= 1;
    }

    if (fIdx !== null && turns <= 0) {
      await endOnlineRound(grid, revealed, newDiscard, fIdx, {});
      return;
    }

    const nextIdx = (mySeat.idx + 1) % players.length;
    msg = msg || `${players[nextIdx].name}'s turn.`;
    await updateStateRow(gameId, { message: msg });
    await updateGameRow(gameId, {
      current_player_idx: nextIdx,
      finisher_idx: fIdx,
      final_turns_left: turns,
    });
    refreshOnline(gameId);
  };

  const endOnlineRound = async (myGrid, myRevealed, curDiscard, fIdx, extraStateFields) => {
    playSound('round');
    const data = await fetchFullGame(gameId);
    const newDiscard = [...curDiscard];

    let finals = data.players.map((p) => {
      const grid = p.player_idx === mySeat.idx ? [...myGrid] : [...p.grid];
      let revealed = grid.map(() => true);
      const col = applyColumnRule(grid, revealed, newDiscard);
      return { ...p, grid: col.grid, revealed: col.revealed };
    });

    const roundScores = finals.map((p) => sumGrid(p.grid));
    const finScore = roundScores[fIdx];
    const othersMin = Math.min(...roundScores.filter((_, i) => i !== fIdx));
    let doubled = false;
    if (finScore > 0 && othersMin <= finScore) {
      roundScores[fIdx] = finScore * 2;
      doubled = true;
    }

    for (let i = 0; i < finals.length; i++) {
      await updatePlayerRow(finals[i].id, {
        grid: finals[i].grid,
        revealed: finals[i].revealed,
        round_scores: [...(finals[i].round_scores || []), roundScores[i]],
        score: finals[i].score + roundScores[i],
      });
    }

    const anyOver = finals.some((p, i) => p.score + roundScores[i] >= 100);
    await updateStateRow(gameId, {
      ...extraStateFields,
      discard: newDiscard,
      drawn_card: null,
      drawn_source: null,
      must_reveal: false,
      message: doubled
        ? `${finals[fIdx].name} finished without the lowest score — points doubled!`
        : `${finals[fIdx].name} finished the round.`,
    });
    await updateGameRow(gameId, { status: anyOver ? 'gameEnd' : 'roundEnd' });
    refreshOnline(gameId);
  };

  const startNextOnlineRound = async () => {
    setBusy(true);
    try {
      const data = await fetchFullGame(gameId);
      const newDeck = createDeck();
      let deckIdx = 0;
      for (const p of data.players) {
        const grid = newDeck.slice(deckIdx, deckIdx + CELLS);
        deckIdx += CELLS;
        await updatePlayerRow(p.id, { grid, revealed: new Array(CELLS).fill(false) });
      }
      const firstDiscard = newDeck[deckIdx];
      await updateStateRow(gameId, {
        deck: newDeck.slice(deckIdx + 1),
        discard: [firstDiscard],
        drawn_card: null,
        drawn_source: null,
        must_reveal: false,
        message: 'New round! Everyone reveal two cards.',
      });
      await updateGameRow(gameId, {
        status: 'initialReveal',
        round_number: data.game.round_number + 1,
        finisher_idx: null,
        final_turns_left: 0,
        current_player_idx: 0,
      });
      refreshOnline(gameId);
    } catch (e) {
      setErrorMsg(e.message);
    }
    setBusy(false);
  };

  /* ---------- shared handlers ---------- */
  const handleDraw = () => (isOnline ? onlineDraw() : localDraw());
  const handleTakeDiscard = () => (isOnline ? onlineTakeDiscard() : localTakeDiscard());
  const handleDiscardDrawn = () => (isOnline ? onlineDiscardDrawn() : localDiscardDrawn());
  const handleCellTap = (i) => (isOnline ? onlineCellTap(i) : localCellTap(i));

  const copyGameLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?join=${gameId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetGame = () => {
    if (unsubscribe.current) unsubscribe.current();
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (aiTimer.current) clearTimeout(aiTimer.current);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    window.history.replaceState({}, '', window.location.pathname);
    document.title = 'Skyjo Card Game';
    setScreen('menu');
    setPlayMode(null);
    setPlayers([]);
    setDeck([]);
    setDiscard([]);
    setDrawn(null);
    setMustReveal(false);
    setPausing(false);
    setRoundNumber(1);
    setFinisherIdx(null);
    setGameId(null);
    setMySeat(null);
    setJoinTargetId(null);
    setErrorMsg('');
  };

  /* ============================================================
     SCREENS
     ============================================================ */

  /* ---------- MENU ---------- */
  if (screen === 'menu') {
    return (
      <div style={pageStyle} className="flex items-center justify-center p-6">
        <div className="text-center max-w-sm w-full">
          <div className="flex justify-center mb-8" style={{ perspective: 600 }}>
            {[7, -1, 11, 3].map((v, i) => {
              const p = cardPalette(v);
              return (
                <div
                  key={i}
                  className="w-12 h-[68px] rounded-[10px] flex items-center justify-center font-bold text-xl -ml-3 first:ml-0"
                  style={{
                    background: `linear-gradient(160deg, ${p.light}, ${p.base} 55%, ${p.dark})`,
                    color: p.text,
                    transform: `rotate(${(i - 1.5) * 9}deg) translateY(${Math.abs(i - 1.5) * 4}px)`,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15), 0 10px 24px rgba(0,0,0,0.15)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    zIndex: i,
                  }}
                >
                  {v}
                </div>
              );
            })}
          </div>
          <h1 className="text-5xl font-semibold tracking-tight mb-2" style={{ color: T.ink }}>
            Skyjo
          </h1>
          <p className="text-[17px] mb-10" style={{ color: T.gray }}>
            Lowest score wins. Game ends at 100.
          </p>

          <div className="space-y-3">
            <Button
              onClick={() => {
                setPlayMode('local');
                setScreen('setup');
              }}
            >
              Pass & Play
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPlayMode('ai');
                setScreen('setup');
              }}
            >
              Play vs AI
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPlayMode('online');
                setScreen('setup');
              }}
            >
              Online Multiplayer
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- SETUP ---------- */
  if (screen === 'setup') {
    const isAIMode = playMode === 'ai';
    const isOnlineMode = playMode === 'online';
    return (
      <div style={pageStyle} className="flex items-center justify-center p-6">
        <div className="max-w-sm w-full">
          <h2 className="text-3xl font-semibold tracking-tight text-center mb-1" style={{ color: T.ink }}>
            {isAIMode ? 'Play vs AI' : isOnlineMode ? 'Host a Game' : 'Pass & Play'}
          </h2>
          <p className="text-center text-[15px] mb-8" style={{ color: T.gray }}>
            {isAIMode
              ? 'You against computer opponents.'
              : isOnlineMode
              ? 'Invite friends with a link.'
              : 'Take turns on this device.'}
          </p>

          <p className="text-[13px] font-semibold uppercase tracking-wide mb-2" style={{ color: T.gray }}>
            Players
          </p>
          <div className="flex gap-2 mb-7">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setPlayerCount(n)}
                className="flex-1 py-3 rounded-xl font-semibold text-[17px] transition"
                style={{
                  backgroundColor: playerCount === n ? T.ink : '#FFFFFF',
                  color: playerCount === n ? '#FFFFFF' : T.ink,
                  border: `1px solid ${playerCount === n ? T.ink : T.hairline}`,
                }}
              >
                {n}
              </button>
            ))}
          </div>

          <p className="text-[13px] font-semibold uppercase tracking-wide mb-2" style={{ color: T.gray }}>
            {isAIMode || isOnlineMode ? 'Your name' : 'Names'}
          </p>
          <div className="space-y-2.5 mb-8">
            {isAIMode || isOnlineMode ? (
              <NameInput
                value={nameInputs[0]}
                onChange={(e) => {
                  const arr = [...nameInputs];
                  arr[0] = e.target.value;
                  setNameInputs(arr);
                }}
                placeholder="Your name"
              />
            ) : (
              Array.from({ length: playerCount }).map((_, i) => (
                <NameInput
                  key={i}
                  value={nameInputs[i]}
                  onChange={(e) => {
                    const arr = [...nameInputs];
                    arr[i] = e.target.value;
                    setNameInputs(arr);
                  }}
                  placeholder={`Player ${i + 1}`}
                />
              ))
            )}
          </div>

          {errorMsg && (
            <p className="mb-4 text-sm font-medium text-center" style={{ color: '#D9302C' }}>
              {errorMsg}
            </p>
          )}

          <Button
            disabled={busy}
            onClick={() => {
              if (isOnlineMode) hostOnlineGame();
              else dealLocalRound([], 1);
            }}
          >
            {busy ? 'Setting up…' : isOnlineMode ? 'Create Game' : 'Deal Cards'}
          </Button>
          <button
            onClick={resetGame}
            className="mt-5 w-full text-[15px] font-medium"
            style={{ color: T.accent }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  /* ---------- JOIN ---------- */
  if (screen === 'join') {
    return (
      <div style={pageStyle} className="flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <h2 className="text-3xl font-semibold tracking-tight mb-1" style={{ color: T.ink }}>
            Join Game
          </h2>
          <p className="text-[15px] mb-8" style={{ color: T.gray }}>
            You've been invited to play Skyjo.
          </p>
          <div className="mb-6">
            <NameInput
              value={nameInputs[0]}
              onChange={(e) => {
                const arr = [...nameInputs];
                arr[0] = e.target.value;
                setNameInputs(arr);
              }}
              placeholder="Your name"
            />
          </div>
          {errorMsg && (
            <p className="mb-4 text-sm font-medium" style={{ color: '#D9302C' }}>
              {errorMsg}
            </p>
          )}
          <Button disabled={busy} onClick={joinOnlineGame}>
            {busy ? 'Joining…' : 'Join Game'}
          </Button>
        </div>
      </div>
    );
  }

  /* ---------- LOBBY ---------- */
  if (screen === 'lobby' && players.length > 0) {
    return (
      <div style={pageStyle} className="flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <h2 className="text-3xl font-semibold tracking-tight mb-1" style={{ color: T.ink }}>
            Lobby
          </h2>
          <p className="text-[15px] mb-8" style={{ color: T.gray }}>
            The game starts when every seat is filled.
          </p>

          <div
            className="rounded-2xl overflow-hidden mb-6"
            style={{ backgroundColor: T.panel, border: `1px solid #EBEBEE` }}
          >
            {players.map((p, i) => (
              <div
                key={i}
                className="px-5 py-4 flex items-center justify-between"
                style={{ borderTop: i > 0 ? `1px solid #F0F0F2` : 'none' }}
              >
                <span
                  className="text-[16px] font-medium"
                  style={{ color: p.claimed ? T.ink : T.gray }}
                >
                  {p.claimed ? p.name : 'Waiting for player…'}
                  {mySeat && i === mySeat.idx ? '  (you)' : ''}
                </span>
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: p.claimed ? T.green : '#E5E5EA' }}
                />
              </div>
            ))}
          </div>

          <Button variant="accent" onClick={copyGameLink}>
            <span className="inline-flex items-center gap-2">
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Link Copied' : 'Copy Invite Link'}
            </span>
          </Button>
          <button
            onClick={resetGame}
            className="mt-5 text-[15px] font-medium"
            style={{ color: T.gray }}
          >
            Leave
          </button>
        </div>
      </div>
    );
  }

  /* ---------- INITIAL REVEAL ---------- */
  if (screen === 'initialReveal' && players.length > 0) {
    if (isOnline && mySeat) {
      const me = players[mySeat.idx];
      const myCount = me.revealed.filter(Boolean).length;
      const waiting = myCount >= 2;
      return (
        <div style={pageStyle} className="p-5 flex flex-col items-center justify-center min-h-screen">
          <h2 className="text-2xl font-semibold tracking-tight mb-1" style={{ color: T.ink }}>
            {me.name}
          </h2>
          <p className="mb-7 text-[15px]" style={{ color: T.gray }}>
            {waiting
              ? 'Waiting for the other players…'
              : `Tap ${2 - myCount} card${2 - myCount > 1 ? 's' : ''} to reveal`}
          </p>
          <TableSurface>
            <PlayerGrid
              player={me}
              interactive={!waiting}
              tapMode="reveal"
              onCellTap={onlineInitialReveal}
            />
          </TableSurface>
          <div className="flex flex-wrap justify-center gap-2 mt-7">
            {players.map(
              (p, i) => i !== mySeat.idx && <MiniGrid key={i} player={p} active={false} />
            )}
          </div>
        </div>
      );
    }

    const p = players[revealIdx];
    return (
      <div style={pageStyle} className="p-5 flex flex-col items-center justify-center min-h-screen">
        <h2 className="text-2xl font-semibold tracking-tight mb-1" style={{ color: T.ink }}>
          {p.name}
        </h2>
        <p className="mb-7 text-[15px]" style={{ color: T.gray }}>
          Tap {revealsLeft} card{revealsLeft > 1 ? 's' : ''} to reveal
        </p>
        <TableSurface>
          <PlayerGrid
            player={p}
            interactive={!p.isAI}
            tapMode="reveal"
            onCellTap={handleLocalInitialReveal}
          />
        </TableSurface>
        <p className="mt-7 text-[13px]" style={{ color: T.gray }}>
          Highest revealed total starts the round.
        </p>
      </div>
    );
  }

  /* ---------- PLAYING ---------- */
  if (screen === 'playing' && players.length > 0) {
    const activePlayer = players[currentIdx];
    const viewIdx = isOnline && mySeat ? mySeat.idx : currentIdx;
    const viewPlayer = players[viewIdx];
    const isMyTurn = isOnline ? mySeat && currentIdx === mySeat.idx : !activePlayer.isAI;
    const canPickPile = isMyTurn && !drawn && !mustReveal && !pausing;
    const canInteractGrid = isMyTurn && !pausing && (drawn !== null || mustReveal);
    const tapMode = mustReveal ? 'reveal' : drawn ? 'swap' : null;

    return (
      <div style={pageStyle} className="p-4 md:p-6 pb-10">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-5">
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: T.ink }}>
              Skyjo{' '}
              <span className="font-normal" style={{ color: T.gray }}>
                Round {roundNumber}
              </span>
            </h1>
            <div className="flex gap-2">
              {isOnline && (
                <button
                  onClick={copyGameLink}
                  className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#FFFFFF', border: `1px solid ${T.hairline}`, color: T.ink }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              )}
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#FFFFFF', border: `1px solid ${T.hairline}`, color: T.ink }}
              >
                {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button
                onClick={resetGame}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ backgroundColor: '#FFFFFF', border: `1px solid ${T.hairline}`, color: T.ink }}
              >
                <RotateCcw size={16} />
              </button>
            </div>
          </div>

          {/* Scoreboard */}
          <ScoreBoard players={players} currentIdx={currentIdx} />

          {/* Turn status */}
          <div className="flex justify-center mb-5">
            <div
              className="px-5 py-2 rounded-full text-[15px] font-semibold inline-flex items-center gap-2"
              style={{
                backgroundColor: isMyTurn ? T.accent : '#FFFFFF',
                color: isMyTurn ? '#FFFFFF' : T.ink,
                border: isMyTurn ? '1px solid transparent' : `1px solid ${T.hairline}`,
                boxShadow: isMyTurn ? '0 4px 14px rgba(0,113,227,0.3)' : 'none',
              }}
            >
              {!isMyTurn && (
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: T.green }} />
              )}
              {isMyTurn ? `${activePlayer.name} — your turn` : `${activePlayer.name} is playing…`}
            </div>
          </div>
          {finisherIdx !== null && (
            <p className="text-center text-[13px] font-medium -mt-3 mb-4" style={{ color: '#D9302C' }}>
              Final turns — {players[finisherIdx].name} has finished
            </p>
          )}

          {/* Table */}
          <TableSurface>
            {/* Piles */}
            <div className="flex justify-center items-start gap-7 md:gap-10 mb-7">
              <div className="text-center">
                <button
                  onClick={handleDraw}
                  disabled={!canPickPile}
                  className={`w-[58px] h-[82px] rounded-[10px] relative transition ${
                    canPickPile ? 'hover:-translate-y-0.5 cursor-pointer' : 'opacity-50'
                  }`}
                  style={{
                    background: 'linear-gradient(165deg, #FFFFFF 0%, #F4F4F6 60%, #EBEBEF 100%)',
                    border: '1px solid #E3E3E8',
                    boxShadow:
                      '0 1px 2px rgba(0,0,0,0.14), 0 6px 14px rgba(0,0,0,0.12), 2px 2px 0 #fff, 3px 3px 0 #ECECEF, 4px 4px 0 #fff',
                  }}
                >
                  <span className="absolute inset-0 flex items-center justify-center font-bold" style={{ color: '#2B3990', fontSize: 18 }}>
                    ◆
                  </span>
                </button>
                <p className="text-[12px] mt-2 font-medium tabular-nums" style={{ color: T.gray }}>
                  Draw · {deck.length}
                </p>
              </div>

              {drawn && (
                <div className="text-center">
                  <div
                    className="w-[58px] h-[82px] rounded-[10px] relative flex items-center justify-center font-bold text-3xl"
                    style={{
                      background: `linear-gradient(160deg, ${cardPalette(drawn.card).light}, ${cardPalette(drawn.card).base} 55%, ${cardPalette(drawn.card).dark})`,
                      color: cardPalette(drawn.card).text,
                      border: '1px solid rgba(0,0,0,0.08)',
                      boxShadow: `0 0 0 3px rgba(0,113,227,0.4), 0 8px 20px rgba(0,0,0,0.18)`,
                      textShadow: '0 1px 1px rgba(0,0,0,0.15)',
                    }}
                  >
                    {drawn.card}
                  </div>
                  <p className="text-[12px] mt-2 font-semibold" style={{ color: T.accent }}>
                    In hand
                  </p>
                  {drawn.source === 'deck' && isMyTurn && !pausing && (
                    <button
                      onClick={handleDiscardDrawn}
                      className="mt-1 px-3.5 py-1.5 rounded-full text-[12px] font-semibold"
                      style={{ backgroundColor: T.ink, color: '#FFFFFF' }}
                    >
                      Discard it
                    </button>
                  )}
                </div>
              )}

              <div className="text-center">
                <button
                  onClick={handleTakeDiscard}
                  disabled={!canPickPile || discard.length === 0}
                  className={`w-[58px] h-[82px] rounded-[10px] relative flex items-center justify-center font-bold text-3xl transition ${
                    canPickPile && discard.length > 0
                      ? 'hover:-translate-y-0.5 cursor-pointer'
                      : 'opacity-50'
                  }`}
                  style={
                    discard.length > 0
                      ? {
                          background: `linear-gradient(160deg, ${cardPalette(discard[discard.length - 1]).light}, ${cardPalette(discard[discard.length - 1]).base} 55%, ${cardPalette(discard[discard.length - 1]).dark})`,
                          color: cardPalette(discard[discard.length - 1]).text,
                          border: '1px solid rgba(0,0,0,0.08)',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.14), 0 6px 14px rgba(0,0,0,0.12)',
                          textShadow: '0 1px 1px rgba(0,0,0,0.15)',
                        }
                      : {
                          backgroundColor: 'rgba(0,0,0,0.02)',
                          color: T.hairline,
                          border: `1.5px dashed ${T.hairline}`,
                        }
                  }
                >
                  {discard.length > 0 ? discard[discard.length - 1] : ''}
                </button>
                <p className="text-[12px] mt-2 font-medium" style={{ color: T.gray }}>
                  Discard
                </p>
              </div>
            </div>

            {/* Main grid */}
            <p className="text-center text-[13px] font-semibold mb-3" style={{ color: T.ink }}>
              {viewPlayer.name}
              {isOnline ? ' (you)' : ''}
              <span className="font-medium" style={{ color: T.gray }}>
                {' '}
                · showing {revealedSum(viewPlayer)}
              </span>
            </p>
            <PlayerGrid
              player={viewPlayer}
              interactive={canInteractGrid && viewIdx === currentIdx}
              tapMode={tapMode}
              onCellTap={handleCellTap}
            />
          </TableSurface>

          {/* Message */}
          <p className="mt-5 text-center text-[14px] font-medium min-h-[20px]" style={{ color: T.gray }}>
            {message || (canPickPile ? 'Draw from the pile or take the discard.' : '')}
          </p>
        </div>
      </div>
    );
  }

  /* ---------- ROUND END / GAME END ---------- */
  if ((screen === 'roundEnd' || screen === 'gameEnd') && players.length > 0) {
    const gameOver = screen === 'gameEnd';
    const sorted = [...players].sort((a, b) => a.score - b.score);
    return (
      <div style={pageStyle} className="flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <h2 className="text-3xl font-semibold tracking-tight mb-1" style={{ color: T.ink }}>
            {gameOver ? `${sorted[0].name} wins` : `Round ${roundNumber} complete`}
          </h2>
          <p className="text-[15px] mb-8" style={{ color: T.gray }}>
            {message}
          </p>

          <div
            className="rounded-2xl overflow-hidden mb-8 text-left"
            style={{ backgroundColor: T.panel, border: '1px solid #EBEBEE' }}
          >
            {sorted.map((p, rank) => (
              <div
                key={rank}
                className="px-5 py-4 flex items-center justify-between"
                style={{ borderTop: rank > 0 ? '1px solid #F0F0F2' : 'none' }}
              >
                <span className="text-[16px] font-medium flex items-center gap-2" style={{ color: T.ink }}>
                  {gameOver && rank === 0 && '🏆'}
                  {p.name}
                </span>
                <span className="text-[16px] font-semibold tabular-nums" style={{ color: T.ink }}>
                  {p.roundScores.length > 0 && (
                    <span className="text-[13px] font-medium mr-2" style={{ color: T.gray }}>
                      +{p.roundScores[p.roundScores.length - 1]}
                    </span>
                  )}
                  {p.score}
                </span>
              </div>
            ))}
          </div>

          {!gameOver && (
            <div className="mb-3">
              <Button
                disabled={busy}
                onClick={() =>
                  isOnline ? startNextOnlineRound() : dealLocalRound(players, roundNumber + 1)
                }
              >
                {busy ? 'Dealing…' : 'Next Round'}
              </Button>
            </div>
          )}
          <Button variant={gameOver ? 'primary' : 'secondary'} onClick={resetGame}>
            {gameOver ? 'Play Again' : 'End Game'}
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default SkyjoGame;
