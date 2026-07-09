import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, RotateCcw } from 'lucide-react';
import './index.css';

/* ============================================================
   SKYJO — Official rules implementation
   Deck: 150 cards — 5x(-2), 10x(-1), 15x(0), 10x each 1..12
   Grid: 4 columns x 3 rows per player
   Column rule: 3 identical revealed cards in a column -> discarded
   Round end: finisher triggers one final turn for everyone else
   Doubling: finisher's positive round score doubles if not strictly lowest
   Game ends at 100+ points; lowest total wins
   ============================================================ */

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
  // Fisher–Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

// Card color by value, mapped to brand palette
const cardStyle = (value) => {
  if (value === null) return {};
  if (value < 0) return { backgroundColor: '#39466B', color: '#FCFBF9' }; // deep indigo
  if (value === 0) return { backgroundColor: '#8FB4C9', color: '#212D19' }; // light blue
  if (value <= 4) return { backgroundColor: '#688666', color: '#FCFBF9' }; // sage green
  if (value <= 8) return { backgroundColor: '#C79057', color: '#212D19' }; // gold
  return { backgroundColor: '#9C3F22', color: '#FCFBF9' }; // rust red
};

const sumGrid = (player) =>
  player.grid.reduce((sum, v, i) => (v === null ? sum : sum + v), 0);

const SkyjoGame = () => {
  const [screen, setScreen] = useState('menu'); // menu | setup | initialReveal | playing | roundEnd | gameEnd
  const [playMode, setPlayMode] = useState(null); // 'local' | 'ai'
  const [playerCount, setPlayerCount] = useState(2);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [players, setPlayers] = useState([]);
  const [deck, setDeck] = useState([]);
  const [discard, setDiscard] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [message, setMessage] = useState('');

  // Turn state
  const [drawn, setDrawn] = useState(null); // { card, source: 'deck' | 'discard' }
  const [mustReveal, setMustReveal] = useState(false);

  // Initial reveal state
  const [revealIdx, setRevealIdx] = useState(0);
  const [revealsLeft, setRevealsLeft] = useState(2);

  // Round-end tracking
  const [finisherIdx, setFinisherIdx] = useState(null);
  const [finalTurnsLeft, setFinalTurnsLeft] = useState(0);

  const aiTimer = useRef(null);

  /* ---------- sound ---------- */
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
      } else {
        osc.frequency.setValueAtTime(500, now);
        osc.frequency.linearRampToValueAtTime(700, now + 0.1);
      }
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      /* audio unsupported */
    }
  };

  /* ---------- game setup ---------- */
  const startNewGame = () => {
    dealRound([], 1);
  };

  const dealRound = (existingPlayers, round) => {
    const newDeck = createDeck();
    const count = existingPlayers.length || playerCount;
    const newPlayers = [];

    for (let i = 0; i < count; i++) {
      const grid = newDeck.splice(0, CELLS);
      const base = existingPlayers[i] || {
        id: i,
        name:
          playMode === 'ai'
            ? i === 0
              ? 'You'
              : `AI ${i}`
            : `Player ${i + 1}`,
        score: 0,
        roundScores: [],
        isAI: playMode === 'ai' && i !== 0,
      };
      newPlayers.push({
        ...base,
        grid,
        revealed: new Array(CELLS).fill(false),
      });
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
    setScreen('initialReveal');
    setMessage('Each player reveals two cards to start.');
  };

  /* ---------- initial reveal phase ---------- */
  const handleInitialReveal = (cellIdx) => {
    const p = players[revealIdx];
    if (p.revealed[cellIdx]) return;

    const newPlayers = players.map((pl, i) =>
      i === revealIdx
        ? { ...pl, revealed: pl.revealed.map((r, c) => (c === cellIdx ? true : r)) }
        : pl
    );
    setPlayers(newPlayers);
    playSound('flip');

    if (revealsLeft - 1 === 0) {
      advanceInitialReveal(newPlayers);
    } else {
      setRevealsLeft(revealsLeft - 1);
    }
  };

  const advanceInitialReveal = (currentPlayers) => {
    let next = revealIdx + 1;
    // Auto-reveal for AI players
    let updated = currentPlayers;
    while (next < updated.length && updated[next].isAI) {
      const aiPlayer = updated[next];
      const indices = [];
      while (indices.length < 2) {
        const r = Math.floor(Math.random() * CELLS);
        if (!indices.includes(r)) indices.push(r);
      }
      updated = updated.map((pl, i) =>
        i === next
          ? { ...pl, revealed: pl.revealed.map((rv, c) => (indices.includes(c) ? true : rv)) }
          : pl
      );
      next++;
    }
    setPlayers(updated);

    if (next >= updated.length) {
      // Determine starting player: highest sum of two revealed cards
      let bestIdx = 0;
      let bestSum = -Infinity;
      updated.forEach((pl, i) => {
        const s = pl.grid.reduce(
          (sum, v, c) => (pl.revealed[c] ? sum + v : sum),
          0
        );
        if (s > bestSum) {
          bestSum = s;
          bestIdx = i;
        }
      });
      setCurrentIdx(bestIdx);
      setScreen('playing');
      setMessage(
        `${updated[bestIdx].name} starts (highest revealed sum: ${bestSum}).`
      );
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

  /* ---------- core turn mechanics ---------- */

  const ensureDeck = (deckArr, discardArr) => {
    // Reshuffle discard (minus top card) into deck if deck runs out
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

  const drawFromDeck = () => {
    if (drawn || mustReveal) return;
    const fixed = ensureDeck([...deck], [...discard]);
    if (fixed.deck.length === 0) return;
    const card = fixed.deck.shift();
    setDeck(fixed.deck);
    setDiscard(fixed.discard);
    setDrawn({ card, source: 'deck' });
    setMessage(`Drew ${card}. Swap it into your grid, or discard it and reveal a hidden card.`);
  };

  const takeFromDiscard = () => {
    if (drawn || mustReveal || discard.length === 0) return;
    const card = discard[discard.length - 1];
    setDiscard(discard.slice(0, -1));
    setDrawn({ card, source: 'discard' });
    setMessage(`Took ${card} from the discard pile. You must swap it into your grid.`);
  };

  const discardDrawn = () => {
    if (!drawn || drawn.source !== 'deck') return;
    setDiscard([...discard, drawn.card]);
    setDrawn(null);
    setMustReveal(true);
    setMessage('Now reveal one of your hidden cards.');
  };

  // Check columns for three identical revealed cards; remove them
  const applyColumnRule = (player, discardArr) => {
    let removed = false;
    const grid = [...player.grid];
    const revealed = [...player.revealed];
    for (let col = 0; col < COLS; col++) {
      const idxs = [col * ROWS, col * ROWS + 1, col * ROWS + 2];
      const vals = idxs.map((i) => grid[i]);
      const revs = idxs.map((i) => revealed[i]);
      if (
        vals.every((v) => v !== null) &&
        revs.every((r) => r) &&
        vals[0] === vals[1] &&
        vals[1] === vals[2]
      ) {
        idxs.forEach((i) => {
          discardArr.push(grid[i]);
          grid[i] = null;
        });
        removed = true;
      }
    }
    return { player: { ...player, grid, revealed }, removed };
  };

  const isFinished = (player) =>
    player.grid.every((v, i) => v === null || player.revealed[i]);

  const handleCellTap = (cellIdx) => {
    const player = players[currentIdx];
    if (player.isAI) return;
    if (player.grid[cellIdx] === null) return;

    if (mustReveal) {
      if (player.revealed[cellIdx]) return;
      completeMove(currentIdx, cellIdx, null, 'reveal');
    } else if (drawn) {
      completeMove(currentIdx, cellIdx, drawn.card, 'swap');
    }
  };

  // Executes a swap or reveal, applies column rule, checks finish, advances turn
  const completeMove = (pIdx, cellIdx, swapCard, kind) => {
    let newPlayers = [...players];
    let newDiscard = [...discard];
    let player = { ...newPlayers[pIdx] };
    player.grid = [...player.grid];
    player.revealed = [...player.revealed];

    if (kind === 'swap') {
      const oldCard = player.grid[cellIdx];
      player.grid[cellIdx] = swapCard;
      player.revealed[cellIdx] = true;
      newDiscard.push(oldCard);
      setDrawn(null);
    } else {
      player.revealed[cellIdx] = true;
      setMustReveal(false);
    }
    playSound('flip');

    const colResult = applyColumnRule(player, newDiscard);
    player = colResult.player;
    if (colResult.removed) playSound('column');

    newPlayers[pIdx] = player;
    setPlayers(newPlayers);
    setDiscard(newDiscard);

    advanceTurn(newPlayers, deck, newDiscard, pIdx);
  };

  const advanceTurn = (curPlayers, curDeck, curDiscard, justPlayedIdx) => {
    let fIdx = finisherIdx;
    let turnsLeft = finalTurnsLeft;

    // Did this player just finish?
    if (fIdx === null && isFinished(curPlayers[justPlayedIdx])) {
      fIdx = justPlayedIdx;
      turnsLeft = curPlayers.length - 1;
      setFinisherIdx(fIdx);
      setFinalTurnsLeft(turnsLeft);
      setMessage(
        `${curPlayers[justPlayedIdx].name} revealed everything! Everyone else gets one last turn.`
      );
    } else if (fIdx !== null) {
      turnsLeft -= 1;
      setFinalTurnsLeft(turnsLeft);
    }

    if (fIdx !== null && turnsLeft <= 0) {
      endRound(curPlayers, curDiscard, fIdx);
      return;
    }

    const nextIdx = (justPlayedIdx + 1) % curPlayers.length;
    setCurrentIdx(nextIdx);
    playSound('turn');
    if (fIdx === null || nextIdx !== fIdx) {
      setMessage(`${curPlayers[nextIdx].name}'s turn.`);
    }

    if (curPlayers[nextIdx].isAI) {
      scheduleAI(curPlayers, [...curDeck], [...curDiscard], nextIdx, fIdx, turnsLeft);
    }
  };

  /* ---------- AI ---------- */

  const scheduleAI = (curPlayers, curDeck, curDiscard, aiIdx, fIdx, turnsLeft) => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      runAITurn(curPlayers, curDeck, curDiscard, aiIdx, fIdx, turnsLeft);
    }, 1100);
  };

  const runAITurn = (curPlayers, curDeck, curDiscard, aiIdx, fIdx, turnsLeft) => {
    let newPlayers = curPlayers.map((p) => ({
      ...p,
      grid: [...p.grid],
      revealed: [...p.revealed],
    }));
    let player = newPlayers[aiIdx];
    let newDeck = [...curDeck];
    let newDiscard = [...curDiscard];

    const activeCells = player.grid
      .map((v, i) => ({ v, i }))
      .filter((c) => c.v !== null);
    const revealedCells = activeCells.filter((c) => player.revealed[c.i]);
    const hiddenCells = activeCells.filter((c) => !player.revealed[c.i]);
    const worstRevealed = revealedCells.reduce(
      (best, c) => (best === null || c.v > best.v ? c : best),
      null
    );

    const discardTop = newDiscard.length ? newDiscard[newDiscard.length - 1] : null;
    let card = null;
    let actionMsg = '';

    // Decide: take discard if it's low and improves the grid
    const takeDiscard =
      discardTop !== null &&
      (discardTop <= 3 ||
        (worstRevealed && discardTop < worstRevealed.v - 2));

    if (takeDiscard) {
      card = newDiscard.pop();
      actionMsg = `${player.name} took ${card} from the discard pile`;
    } else {
      const fixed = ensureDeck(newDeck, newDiscard);
      newDeck = fixed.deck;
      newDiscard = fixed.discard;
      if (newDeck.length === 0) {
        endRound(newPlayers, newDiscard, fIdx ?? aiIdx);
        return;
      }
      card = newDeck.shift();
      actionMsg = `${player.name} drew ${card}`;
    }

    // Choose what to do with the card
    let target = null;
    if (worstRevealed && card < worstRevealed.v) target = worstRevealed.i;
    else if (hiddenCells.length > 0 && card <= 5)
      target = hiddenCells[Math.floor(Math.random() * hiddenCells.length)].i;
    else if (takeDiscard) {
      // Must swap when taken from discard — pick the best available spot
      target = worstRevealed
        ? worstRevealed.i
        : hiddenCells[Math.floor(Math.random() * hiddenCells.length)].i;
    }

    if (target !== null) {
      const oldCard = player.grid[target];
      player.grid[target] = card;
      player.revealed[target] = true;
      newDiscard.push(oldCard);
      actionMsg += ` and swapped it in.`;
    } else {
      // Discard and reveal a hidden card
      newDiscard.push(card);
      const flip = hiddenCells[Math.floor(Math.random() * hiddenCells.length)];
      player.revealed[flip.i] = true;
      actionMsg += ` and discarded it, revealing a hidden card.`;
    }

    const colResult = applyColumnRule(player, newDiscard);
    player = colResult.player;
    if (colResult.removed) {
      playSound('column');
      actionMsg += ' A column of three matched and was cleared!';
    }
    newPlayers[aiIdx] = player;

    setPlayers(newPlayers);
    setDeck(newDeck);
    setDiscard(newDiscard);
    setMessage(actionMsg);
    playSound('flip');

    // Advance turn (mirrors advanceTurn but with local finisher state)
    let localF = fIdx;
    let localTurns = turnsLeft;
    if (localF === null && isFinished(player)) {
      localF = aiIdx;
      localTurns = newPlayers.length - 1;
      setFinisherIdx(localF);
      setFinalTurnsLeft(localTurns);
      setMessage(`${player.name} revealed everything! Everyone else gets one last turn.`);
    } else if (localF !== null) {
      localTurns -= 1;
      setFinalTurnsLeft(localTurns);
    }

    if (localF !== null && localTurns <= 0) {
      endRound(newPlayers, newDiscard, localF);
      return;
    }

    const nextIdx = (aiIdx + 1) % newPlayers.length;
    setCurrentIdx(nextIdx);
    playSound('turn');
    if (newPlayers[nextIdx].isAI) {
      scheduleAI(newPlayers, newDeck, newDiscard, nextIdx, localF, localTurns);
    }
  };

  /* ---------- round & game end ---------- */

  const endRound = (curPlayers, curDiscard, fIdx) => {
    playSound('round');
    let newDiscard = [...curDiscard];

    // Flip all remaining hidden cards, then apply column rule once more
    let finalPlayers = curPlayers.map((p) => {
      let flipped = {
        ...p,
        grid: [...p.grid],
        revealed: p.revealed.map(() => true),
      };
      const colResult = applyColumnRule(flipped, newDiscard);
      return colResult.player;
    });

    // Score the round
    const roundScores = finalPlayers.map((p) => sumGrid(p));

    // Doubling rule: finisher must be strictly lowest, else positive score doubles
    const finisherScore = roundScores[fIdx];
    const othersMin = Math.min(
      ...roundScores.filter((_, i) => i !== fIdx)
    );
    let doubled = false;
    if (finisherScore > 0 && othersMin <= finisherScore) {
      roundScores[fIdx] = finisherScore * 2;
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
        ? `${finalPlayers[fIdx].name} finished but didn't have the lowest score — points doubled!`
        : `${finalPlayers[fIdx].name} finished the round.`
    );

    if (finalPlayers.some((p) => p.score >= 100)) {
      setScreen('gameEnd');
    } else {
      setScreen('roundEnd');
    }
  };

  const nextRound = () => {
    dealRound(players, roundNumber + 1);
  };

  const resetGame = () => {
    if (aiTimer.current) clearTimeout(aiTimer.current);
    setScreen('menu');
    setPlayMode(null);
    setPlayers([]);
    setDeck([]);
    setDiscard([]);
    setDrawn(null);
    setMustReveal(false);
    setRoundNumber(1);
    setFinisherIdx(null);
  };

  useEffect(() => () => aiTimer.current && clearTimeout(aiTimer.current), []);

  /* ============================================================
     RENDERING
     ============================================================ */

  const feltBg = {
    background:
      'radial-gradient(ellipse at 50% 30%, #2E3D24 0%, #212D19 60%, #17200F 100%)',
    minHeight: '100vh',
  };

  const CardFace = ({ value, revealed, removed, onClick, disabled, highlight, size = 'md' }) => {
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
          } ${highlight ? 'ring-2 ring-offset-1' : ''}`}
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
          !disabled ? 'hover:scale-105 active:scale-95 cursor-pointer' : ''
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
      className={`p-2 rounded-xl ${active ? 'ring-2' : ''}`}
      style={{
        backgroundColor: 'rgba(252,251,249,0.07)',
        borderColor: '#C79057',
        ringColor: '#C79057',
      }}
    >
      <p
        className="text-xs font-bold mb-1 text-center truncate max-w-[110px]"
        style={{ color: active ? '#C79057' : '#E5DACB' }}
      >
        {player.name} · {player.score}
      </p>
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

  /* ---------- MENU ---------- */
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
            <BrandButton color="#3E4A38" textColor="#A7B3A0" disabled>
              Online Multiplayer — coming soon
            </BrandButton>
          </div>
          <p className="mt-8 text-sm" style={{ color: '#688666' }}>
            Lowest score wins · Game ends at 100 points
          </p>
        </div>
      </div>
    );
  }

  /* ---------- SETUP ---------- */
  if (screen === 'setup') {
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h2
            className="text-3xl font-bold mb-8"
            style={{ color: '#E5DACB', fontFamily: "'Grandstander', system-ui, sans-serif" }}
          >
            {playMode === 'ai' ? 'You vs AI' : 'Pass & Play'}
          </h2>

          <div className="mb-10">
            <label className="block text-lg font-semibold mb-4" style={{ color: '#E5DACB' }}>
              {playMode === 'ai'
                ? `Players: You + ${playerCount - 1} AI opponent${playerCount > 2 ? 's' : ''}`
                : `Players: ${playerCount}`}
            </label>
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

  /* ---------- INITIAL REVEAL ---------- */
  if (screen === 'initialReveal' && players.length > 0) {
    const p = players[revealIdx];
    return (
      <div style={feltBg} className="p-4 flex flex-col items-center justify-center">
        <h2
          className="text-2xl font-bold mb-1"
          style={{ color: '#C79057', fontFamily: "'Grandstander', system-ui, sans-serif" }}
        >
          {p.name}
        </h2>
        <p className="mb-6 font-semibold" style={{ color: '#E5DACB' }}>
          Tap {revealsLeft} card{revealsLeft > 1 ? 's' : ''} to reveal
        </p>
        <PlayerGrid
          player={p}
          interactive={!p.isAI}
          tapMode="reveal"
          onCellTap={handleInitialReveal}
        />
        <p className="mt-8 text-sm" style={{ color: '#688666' }}>
          The player with the highest revealed total starts the round.
        </p>
      </div>
    );
  }

  /* ---------- PLAYING ---------- */
  if (screen === 'playing' && players.length > 0) {
    const player = players[currentIdx];
    const isAI = player.isAI;
    const canPickPile = !drawn && !mustReveal && !isAI;
    const tapMode = mustReveal ? 'reveal' : drawn ? 'swap' : null;

    return (
      <div style={feltBg} className="p-3 md:p-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <h1
              className="text-2xl md:text-3xl font-black"
              style={{ color: '#E5DACB', fontFamily: "'Grandstander', system-ui, sans-serif" }}
            >
              SKYJO <span style={{ color: '#688666' }} className="text-lg font-bold">· Round {roundNumber}</span>
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'rgba(252,251,249,0.1)', color: '#E5DACB' }}
              >
                {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button
                onClick={resetGame}
                className="p-2 rounded-lg"
                style={{ backgroundColor: 'rgba(252,251,249,0.1)', color: '#E5DACB' }}
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </div>

          {/* Opponents */}
          <div className="flex flex-wrap justify-center gap-2 mb-4">
            {players.map(
              (p, i) =>
                i !== currentIdx && <MiniGrid key={p.id} player={p} active={false} />
            )}
          </div>

          {/* Turn banner */}
          <div
            className="text-center mb-4 py-2.5 px-4 rounded-xl font-bold shadow-lg"
            style={{
              backgroundColor: isAI ? 'rgba(229,218,203,0.15)' : '#C79057',
              color: isAI ? '#E5DACB' : '#212D19',
              fontFamily: "'Grandstander', system-ui, sans-serif",
            }}
          >
            {isAI ? `${player.name} is thinking…` : `${player.name} — your turn`}
            {finisherIdx !== null && (
              <span className="block text-xs font-semibold mt-0.5">
                Final turns! {players[finisherIdx].name} has finished.
              </span>
            )}
          </div>

          {/* Piles */}
          <div className="flex justify-center items-start gap-8 mb-5">
            <div className="text-center">
              <button
                onClick={drawFromDeck}
                disabled={!canPickPile}
                className={`w-16 h-24 rounded-lg font-bold flex flex-col items-center justify-center shadow-xl transition ${
                  canPickPile ? 'hover:scale-105 cursor-pointer' : 'opacity-60'
                }`}
                style={{
                  backgroundColor: '#E5DACB',
                  color: '#9C3F22',
                  backgroundImage:
                    'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(156,63,34,0.12) 6px, rgba(156,63,34,0.12) 12px)',
                }}
              >
                <span className="text-xl">✦</span>
              </button>
              <p className="text-xs mt-1.5 font-semibold" style={{ color: '#688666' }}>
                Draw · {deck.length}
              </p>
            </div>

            {/* Drawn card slot */}
            {drawn && (
              <div className="text-center">
                <div
                  className="w-16 h-24 rounded-lg font-extrabold text-3xl flex items-center justify-center shadow-xl animate-pulse"
                  style={{
                    ...cardStyle(drawn.card),
                    fontFamily: "'Grandstander', system-ui, sans-serif",
                  }}
                >
                  {drawn.card}
                </div>
                <p className="text-xs mt-1.5 font-semibold" style={{ color: '#C79057' }}>
                  In hand
                </p>
                {drawn.source === 'deck' && (
                  <button
                    onClick={discardDrawn}
                    className="mt-1 px-3 py-1 rounded-lg text-xs font-bold"
                    style={{ backgroundColor: '#688666', color: '#FCFBF9' }}
                  >
                    Discard it
                  </button>
                )}
              </div>
            )}

            <div className="text-center">
              <button
                onClick={takeFromDiscard}
                disabled={!canPickPile || discard.length === 0}
                className={`w-16 h-24 rounded-lg font-extrabold text-3xl flex items-center justify-center shadow-xl transition ${
                  canPickPile && discard.length > 0 ? 'hover:scale-105 cursor-pointer' : 'opacity-60'
                }`}
                style={
                  discard.length > 0
                    ? { ...cardStyle(discard[discard.length - 1]), fontFamily: "'Grandstander', system-ui, sans-serif" }
                    : { backgroundColor: 'rgba(252,251,249,0.08)', color: '#688666', border: '2px dashed #688666' }
                }
              >
                {discard.length > 0 ? discard[discard.length - 1] : '–'}
              </button>
              <p className="text-xs mt-1.5 font-semibold" style={{ color: '#688666' }}>
                Discard
              </p>
            </div>
          </div>

          {/* Current player's grid */}
          <PlayerGrid
            player={player}
            interactive={!isAI && (drawn !== null || mustReveal)}
            tapMode={tapMode}
            onCellTap={handleCellTap}
          />

          {/* Instruction / log */}
          <div
            className="mt-5 p-3 rounded-xl text-center text-sm font-semibold"
            style={{ backgroundColor: 'rgba(252,251,249,0.08)', color: '#E5DACB' }}
          >
            {message ||
              (canPickPile
                ? 'Draw from the pile or take the discard.'
                : '')}
          </div>
        </div>
      </div>
    );
  }

  /* ---------- ROUND END / GAME END ---------- */
  if ((screen === 'roundEnd' || screen === 'gameEnd') && players.length > 0) {
    const gameOver = screen === 'gameEnd';
    const sorted = [...players].sort((a, b) => a.score - b.score);
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-lg w-full">
          <h2
            className="text-4xl font-black mb-2"
            style={{ color: '#E5DACB', fontFamily: "'Grandstander', system-ui, sans-serif" }}
          >
            {gameOver ? `${sorted[0].name} Wins!` : `Round ${roundNumber} Complete`}
          </h2>
          <p className="mb-8 font-semibold" style={{ color: '#688666' }}>
            {message}
          </p>

          <div className="space-y-3 mb-8">
            {sorted.map((p, rank) => (
              <div
                key={p.id}
                className="p-4 rounded-xl flex justify-between items-center shadow-lg"
                style={{
                  backgroundColor:
                    gameOver && rank === 0 ? '#C79057' : 'rgba(252,251,249,0.1)',
                }}
              >
                <span
                  className="font-bold"
                  style={{ color: gameOver && rank === 0 ? '#212D19' : '#E5DACB' }}
                >
                  {gameOver && rank === 0 ? '🏆 ' : ''}
                  {p.name}
                </span>
                <span
                  className="font-black text-xl"
                  style={{
                    color: gameOver && rank === 0 ? '#212D19' : '#C79057',
                    fontFamily: "'Grandstander', system-ui, sans-serif",
                  }}
                >
                  {p.roundScores.length > 0 && (
                    <span className="text-sm font-bold mr-2" style={{ color: '#688666' }}>
                      +{p.roundScores[p.roundScores.length - 1]}
                    </span>
                  )}
                  {p.score}
                </span>
              </div>
            ))}
          </div>

          {!gameOver && (
            <BrandButton color="#9C3F22" onClick={nextRound}>
              Next Round
            </BrandButton>
          )}
          <div className="mt-4">
            <BrandButton
              color={gameOver ? '#9C3F22' : '#3E4A38'}
              textColor={gameOver ? '#FCFBF9' : '#E5DACB'}
              onClick={resetGame}
            >
              {gameOver ? 'Play Again' : 'End Game'}
            </BrandButton>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default SkyjoGame;
