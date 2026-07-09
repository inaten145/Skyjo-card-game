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

// Official Skyjo card colors
const cardStyle = (value) => {
  if (value === null) return {};
  if (value < 0) return { backgroundColor: '#2B3990', color: '#FFFFFF' }; // dark blue
  if (value === 0) return { backgroundColor: '#6BC5E8', color: '#1A1A2E' }; // light blue
  if (value <= 4) return { backgroundColor: '#7AB648', color: '#FFFFFF' }; // green
  if (value <= 8) return { backgroundColor: '#F5D130', color: '#4A3B00' }; // yellow
  return { backgroundColor: '#D9302C', color: '#FFFFFF' }; // red
};

const sumGrid = (grid) => grid.reduce((s, v) => (v === null ? s : s + v), 0);

const isFinished = (grid, revealed) =>
  grid.every((v, i) => v === null || revealed[i]);

// Three identical revealed cards in a column -> clear the column to discard.
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

const SkyjoGame = () => {
  const [screen, setScreen] = useState('menu'); // menu | setup | join | lobby | initialReveal | playing | roundEnd | gameEnd
  const [playMode, setPlayMode] = useState(null); // 'local' | 'ai' | 'online'
  const [playerCount, setPlayerCount] = useState(2);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [nameInputs, setNameInputs] = useState(['', '', '', '']);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Shared game state (local engine, mirrored from DB when online)
  const [players, setPlayers] = useState([]);
  const [deck, setDeck] = useState([]);
  const [discard, setDiscard] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [drawn, setDrawn] = useState(null); // { card, source }
  const [mustReveal, setMustReveal] = useState(false);
  const [finisherIdx, setFinisherIdx] = useState(null);
  const [finalTurnsLeft, setFinalTurnsLeft] = useState(0);
  const [message, setMessage] = useState('');

  // Local initial-reveal tracking
  const [revealIdx, setRevealIdx] = useState(0);
  const [revealsLeft, setRevealsLeft] = useState(2);

  // Online-only
  const [gameId, setGameId] = useState(null);
  const [mySeat, setMySeat] = useState(null); // { idx, id }
  const [joinTargetId, setJoinTargetId] = useState(null);
  const [busy, setBusy] = useState(false);

  const aiTimer = useRef(null);
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
     LOCAL ENGINE (Pass & Play + AI)
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
    if (drawn || mustReveal) return;
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
    if (drawn || mustReveal || discard.length === 0) return;
    const card = discard[discard.length - 1];
    setDiscard(discard.slice(0, -1));
    setDrawn({ card, source: 'discard' });
    setMessage(`Took ${card} from discard. Tap one of your cards to swap it in.`);
    playSound('flip');
  };

  const localDiscardDrawn = () => {
    if (!drawn || drawn.source !== 'deck') return;
    setDiscard([...discard, drawn.card]);
    setDrawn(null);
    setMustReveal(true);
    setMessage('Now tap a hidden card to reveal it.');
    playSound('flip');
  };

  const localCellTap = (cellIdx) => {
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

    if (kind === 'swap') {
      newDiscard.push(player.grid[cellIdx]);
      player.grid[cellIdx] = swapCard;
      player.revealed[cellIdx] = true;
      setDrawn(null);
    } else {
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
    localAdvanceTurn(newPlayers, deck, newDiscard, currentIdx);
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
      actionMsg = `${player.name} took ${card} from discard`;
    } else {
      const fixed = ensureDeck(newDeck, newDiscard);
      newDeck = fixed.deck;
      newDiscard = fixed.discard;
      if (newDeck.length === 0) {
        endLocalRound(newPlayers, newDiscard, fIdx ?? aiIdx);
        return;
      }
      card = newDeck.shift();
      actionMsg = `${player.name} drew ${card}`;
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
      actionMsg += ' and discarded it, flipping a hidden card.';
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
        ? `${finalPlayers[fIdx].name} finished but didn't have the lowest score — points doubled!`
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

  // Turn notification when it becomes my turn online
  useEffect(() => {
    if (!isOnline || !mySeat) return;
    if (screen === 'playing' && currentIdx === mySeat.idx && prevTurnRef.current !== currentIdx) {
      playSound('turn');
      if (navigator.vibrate) navigator.vibrate(200);
      document.title = '🎮 Your turn — Skyjo';
    } else if (screen === 'playing') {
      document.title = 'Skyjo';
    }
    prevTurnRef.current = currentIdx;
  }, [currentIdx, screen, isOnline, mySeat, playSound]);

  // Handle ?join= link on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const join = params.get('join');
    if (join) {
      setPlayMode('online');
      setJoinTargetId(join);
      // Rejoin if we already have a seat saved
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

      // If that was the last open seat, start the initial reveal phase
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

    // If everyone now has 2 revealed, compute starter and begin
    const data = await fetchFullGame(gameId);
    const allReady = data.players.every(
      (p) => p.revealed.filter(Boolean).length >= 2
    );
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
    if (drawn || mustReveal || currentIdx !== mySeat.idx) return;
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
    if (drawn || mustReveal || currentIdx !== mySeat.idx || discard.length === 0) return;
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
    if (!drawn || drawn.source !== 'deck' || currentIdx !== mySeat.idx) return;
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
    if (currentIdx !== mySeat.idx) return;
    const me = players[mySeat.idx];
    if (me.grid[cellIdx] === null) return;

    let grid = [...me.grid];
    let revealed = [...me.revealed];
    let newDiscard = [...discard];
    let stateFields = {};

    if (mustReveal) {
      if (revealed[cellIdx]) return;
      revealed[cellIdx] = true;
      stateFields = { must_reveal: false };
    } else if (drawn) {
      newDiscard.push(grid[cellIdx]);
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

    await updatePlayerRow(me.dbId, { grid, revealed });

    // Advance turn / finisher tracking
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
      await endOnlineRound(grid, revealed, newDiscard, fIdx, stateFields);
      return;
    }

    const nextIdx = (mySeat.idx + 1) % players.length;
    msg = msg || `${players[nextIdx].name}'s turn.`;
    await updateStateRow(gameId, { ...stateFields, discard: newDiscard, message: msg });
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
        await updatePlayerRow(p.id, {
          grid,
          revealed: new Array(CELLS).fill(false),
        });
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
    window.history.replaceState({}, '', window.location.pathname);
    document.title = 'Skyjo Card Game';
    setScreen('menu');
    setPlayMode(null);
    setPlayers([]);
    setDeck([]);
    setDiscard([]);
    setDrawn(null);
    setMustReveal(false);
    setRoundNumber(1);
    setFinisherIdx(null);
    setGameId(null);
    setMySeat(null);
    setJoinTargetId(null);
    setErrorMsg('');
  };

  /* ============================================================
     UI
     ============================================================ */

  const feltBg = {
    background:
      'radial-gradient(ellipse at 50% 30%, #2E3D24 0%, #212D19 60%, #17200F 100%)',
    minHeight: '100vh',
  };
  const displayFont = { fontFamily: "'Grandstander', system-ui, sans-serif" };

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
          } ${highlight ? 'ring-2' : ''}`}
          style={{
            backgroundColor: '#E5DACB',
            color: '#9C3F22',
            backgroundImage:
              'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(156,63,34,0.12) 6px, rgba(156,63,34,0.12) 12px)',
            boxShadow: '0 3px 6px rgba(0,0,0,0.4)',
            ...(highlight ? { boxShadow: '0 0 0 2px #C79057, 0 3px 6px rgba(0,0,0,0.4)' } : {}),
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
          ...displayFont,
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
      className="p-2 rounded-xl"
      style={{
        backgroundColor: 'rgba(252,251,249,0.07)',
        outline: active ? '2px solid #C79057' : 'none',
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
      style={{ backgroundColor: color, color: textColor, ...displayFont }}
    >
      {children}
    </button>
  );

  const NameInput = ({ value, onChange, placeholder }) => (
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={16}
      className="w-full py-3 px-4 rounded-xl font-semibold text-center outline-none"
      style={{ backgroundColor: 'rgba(252,251,249,0.12)', color: '#FCFBF9' }}
    />
  );

  /* ---------- MENU ---------- */
  if (screen === 'menu') {
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h1
            className="text-7xl font-black mb-2 tracking-tight"
            style={{ color: '#E5DACB', ...displayFont, textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
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
              textColor="#212D19"
              onClick={() => {
                setPlayMode('online');
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

  /* ---------- SETUP ---------- */
  if (screen === 'setup') {
    const isAIMode = playMode === 'ai';
    const isOnlineMode = playMode === 'online';
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h2 className="text-3xl font-bold mb-8" style={{ color: '#E5DACB', ...displayFont }}>
            {isAIMode ? 'You vs AI' : isOnlineMode ? 'Host an Online Game' : 'Pass & Play'}
          </h2>

          <div className="mb-8">
            <label className="block text-lg font-semibold mb-3" style={{ color: '#E5DACB' }}>
              {isAIMode
                ? `You + ${playerCount - 1} AI opponent${playerCount > 2 ? 's' : ''}`
                : `${playerCount} players total`}
            </label>
            <div className="flex justify-center gap-3 mb-6">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setPlayerCount(n)}
                  className="w-16 h-16 rounded-xl font-black text-2xl transition shadow-lg"
                  style={{
                    backgroundColor: playerCount === n ? '#C79057' : 'rgba(252,251,249,0.1)',
                    color: playerCount === n ? '#212D19' : '#E5DACB',
                    ...displayFont,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>

            {/* Name entry */}
            <div className="space-y-3">
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
                    placeholder={`Player ${i + 1} name`}
                  />
                ))
              )}
            </div>
          </div>

          {errorMsg && (
            <p className="mb-4 text-sm font-semibold" style={{ color: '#C79057' }}>
              {errorMsg}
            </p>
          )}

          <BrandButton
            color="#9C3F22"
            disabled={busy}
            onClick={() => {
              if (isOnlineMode) hostOnlineGame();
              else dealLocalRound([], 1);
            }}
          >
            {busy ? 'Setting up…' : isOnlineMode ? 'Create Game' : 'Deal Cards'}
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

  /* ---------- JOIN (from a shared link) ---------- */
  if (screen === 'join') {
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h2 className="text-3xl font-bold mb-3" style={{ color: '#E5DACB', ...displayFont }}>
            Join Skyjo Game
          </h2>
          <p className="mb-8 font-semibold" style={{ color: '#688666' }}>
            You've been invited to play!
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
            <p className="mb-4 text-sm font-semibold" style={{ color: '#C79057' }}>
              {errorMsg}
            </p>
          )}
          <BrandButton color="#9C3F22" disabled={busy} onClick={joinOnlineGame}>
            {busy ? 'Joining…' : 'Join Game'}
          </BrandButton>
        </div>
      </div>
    );
  }

  /* ---------- LOBBY (online) ---------- */
  if (screen === 'lobby' && players.length > 0) {
    return (
      <div style={feltBg} className="flex items-center justify-center p-4">
        <div className="text-center max-w-md w-full">
          <h2 className="text-3xl font-bold mb-2" style={{ color: '#E5DACB', ...displayFont }}>
            Game Lobby
          </h2>
          <p className="mb-6 font-semibold" style={{ color: '#688666' }}>
            Waiting for everyone to join…
          </p>

          <div className="space-y-3 mb-8">
            {players.map((p, i) => (
              <div
                key={i}
                className="p-4 rounded-xl flex items-center justify-between"
                style={{ backgroundColor: 'rgba(252,251,249,0.1)' }}
              >
                <span className="font-bold" style={{ color: p.claimed ? '#E5DACB' : '#688666' }}>
                  {p.claimed ? p.name : 'Waiting for player…'}
                  {mySeat && i === mySeat.idx ? ' (you)' : ''}
                </span>
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: p.claimed ? '#688666' : 'rgba(252,251,249,0.2)' }}
                />
              </div>
            ))}
          </div>

          <button
            onClick={copyGameLink}
            className="w-full py-4 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-2 shadow-lg"
            style={{ backgroundColor: '#C79057', color: '#212D19', ...displayFont }}
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </button>
          <p className="mt-3 text-sm" style={{ color: '#688666' }}>
            Send the link to your friends — the game starts when all seats are filled.
          </p>
          <button
            onClick={resetGame}
            className="mt-6 text-sm font-semibold underline"
            style={{ color: '#688666' }}
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
        <div style={feltBg} className="p-4 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-1" style={{ color: '#C79057', ...displayFont }}>
            {me.name}
          </h2>
          <p className="mb-6 font-semibold" style={{ color: '#E5DACB' }}>
            {waiting
              ? 'Waiting for the other players to reveal…'
              : `Tap ${2 - myCount} card${2 - myCount > 1 ? 's' : ''} to reveal`}
          </p>
          <PlayerGrid
            player={me}
            interactive={!waiting}
            tapMode="reveal"
            onCellTap={onlineInitialReveal}
          />
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {players.map(
              (p, i) => i !== mySeat.idx && <MiniGrid key={i} player={p} active={false} />
            )}
          </div>
        </div>
      );
    }

    // Local
    const p = players[revealIdx];
    return (
      <div style={feltBg} className="p-4 flex flex-col items-center justify-center">
        <h2 className="text-2xl font-bold mb-1" style={{ color: '#C79057', ...displayFont }}>
          {p.name}
        </h2>
        <p className="mb-6 font-semibold" style={{ color: '#E5DACB' }}>
          Tap {revealsLeft} card{revealsLeft > 1 ? 's' : ''} to reveal
        </p>
        <PlayerGrid
          player={p}
          interactive={!p.isAI}
          tapMode="reveal"
          onCellTap={handleLocalInitialReveal}
        />
        <p className="mt-8 text-sm" style={{ color: '#688666' }}>
          Highest revealed total starts the round.
        </p>
      </div>
    );
  }

  /* ---------- PLAYING ---------- */
  if (screen === 'playing' && players.length > 0) {
    const activePlayer = players[currentIdx];
    // Which grid do I see full-size?
    const viewIdx = isOnline && mySeat ? mySeat.idx : currentIdx;
    const viewPlayer = players[viewIdx];
    const isMyTurn = isOnline ? mySeat && currentIdx === mySeat.idx : !activePlayer.isAI;
    const canPickPile = isMyTurn && !drawn && !mustReveal;
    const canInteractGrid = isMyTurn && (drawn !== null || mustReveal);
    const tapMode = mustReveal ? 'reveal' : drawn ? 'swap' : null;

    return (
      <div style={feltBg} className="p-3 md:p-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl md:text-3xl font-black" style={{ color: '#E5DACB', ...displayFont }}>
              SKYJO{' '}
              <span style={{ color: '#688666' }} className="text-lg font-bold">
                · Round {roundNumber}
              </span>
            </h1>
            <div className="flex gap-2">
              {isOnline && (
                <button
                  onClick={copyGameLink}
                  className="p-2 rounded-lg"
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
              (p, i) => i !== viewIdx && <MiniGrid key={i} player={p} active={i === currentIdx} />
            )}
          </div>

          {/* Turn banner */}
          <div
            className="text-center mb-4 py-2.5 px-4 rounded-xl font-bold shadow-lg"
            style={{
              backgroundColor: isMyTurn ? '#C79057' : 'rgba(229,218,203,0.15)',
              color: isMyTurn ? '#212D19' : '#E5DACB',
              ...displayFont,
            }}
          >
            {isMyTurn
              ? `${activePlayer.name} — your turn!`
              : `Waiting on ${activePlayer.name}…`}
            {finisherIdx !== null && (
              <span className="block text-xs font-semibold mt-0.5">
                Final turns — {players[finisherIdx].name} has finished!
              </span>
            )}
          </div>

          {/* Piles */}
          <div className="flex justify-center items-start gap-8 mb-5">
            <div className="text-center">
              <button
                onClick={handleDraw}
                disabled={!canPickPile}
                className={`w-16 h-24 rounded-lg font-bold flex items-center justify-center shadow-xl transition ${
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

            {drawn && (
              <div className="text-center">
                <div
                  className="w-16 h-24 rounded-lg font-extrabold text-3xl flex items-center justify-center shadow-xl animate-pulse"
                  style={{ ...cardStyle(drawn.card), ...displayFont }}
                >
                  {drawn.card}
                </div>
                <p className="text-xs mt-1.5 font-semibold" style={{ color: '#C79057' }}>
                  In hand
                </p>
                {drawn.source === 'deck' && isMyTurn && (
                  <button
                    onClick={handleDiscardDrawn}
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
                onClick={handleTakeDiscard}
                disabled={!canPickPile || discard.length === 0}
                className={`w-16 h-24 rounded-lg font-extrabold text-3xl flex items-center justify-center shadow-xl transition ${
                  canPickPile && discard.length > 0 ? 'hover:scale-105 cursor-pointer' : 'opacity-60'
                }`}
                style={
                  discard.length > 0
                    ? { ...cardStyle(discard[discard.length - 1]), ...displayFont }
                    : {
                        backgroundColor: 'rgba(252,251,249,0.08)',
                        color: '#688666',
                        border: '2px dashed #688666',
                      }
                }
              >
                {discard.length > 0 ? discard[discard.length - 1] : '–'}
              </button>
              <p className="text-xs mt-1.5 font-semibold" style={{ color: '#688666' }}>
                Discard
              </p>
            </div>
          </div>

          {/* Main grid */}
          <p className="text-center text-sm font-bold mb-2" style={{ color: '#C79057' }}>
            {viewPlayer.name}
            {isOnline ? ' (you)' : ''} · {viewPlayer.score} pts
          </p>
          <PlayerGrid
            player={viewPlayer}
            interactive={canInteractGrid && viewIdx === currentIdx}
            tapMode={tapMode}
            onCellTap={handleCellTap}
          />

          {/* Message */}
          <div
            className="mt-5 p-3 rounded-xl text-center text-sm font-semibold"
            style={{ backgroundColor: 'rgba(252,251,249,0.08)', color: '#E5DACB' }}
          >
            {message ||
              (canPickPile ? 'Draw from the pile or take the discard.' : '')}
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
          <h2 className="text-4xl font-black mb-2" style={{ color: '#E5DACB', ...displayFont }}>
            {gameOver ? `${sorted[0].name} Wins!` : `Round ${roundNumber} Complete`}
          </h2>
          <p className="mb-8 font-semibold" style={{ color: '#688666' }}>
            {message}
          </p>

          <div className="space-y-3 mb-8">
            {sorted.map((p, rank) => (
              <div
                key={rank}
                className="p-4 rounded-xl flex justify-between items-center shadow-lg"
                style={{
                  backgroundColor: gameOver && rank === 0 ? '#C79057' : 'rgba(252,251,249,0.1)',
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
                  style={{ color: gameOver && rank === 0 ? '#212D19' : '#C79057', ...displayFont }}
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
            <BrandButton
              color="#9C3F22"
              disabled={busy}
              onClick={() => (isOnline ? startNextOnlineRound() : dealLocalRound(players, roundNumber + 1))}
            >
              {busy ? 'Dealing…' : 'Next Round'}
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
