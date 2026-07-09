import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import './index.css';

const SkyjoGame = () => {
  const [gameMode, setGameMode] = useState(null); // 'setup', 'playing', 'roundEnd', 'gameEnd'
  const [playMode, setPlayMode] = useState(null); // 'local', 'ai', 'link'
  const [playerCount, setPlayerCount] = useState(2);
  const [gameId, setGameId] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Game state
  const [players, setPlayers] = useState([]);
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);
  const [deck, setDeck] = useState([]);
  const [discardPile, setDiscardPile] = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);
  const [roundNumber, setRoundNumber] = useState(1);
  const [lastAction, setLastAction] = useState('');

  // Initialize game
  const initializeGame = () => {
    const newGameId = Math.random().toString(36).substring(7);
    setGameId(newGameId);

    const newDeck = createDeck();
    const newPlayers = [];

    for (let i = 0; i < playerCount; i++) {
      const hand = newDeck.splice(0, 12);
      newPlayers.push({
        id: i,
        name: playMode === 'ai' && i === 1 ? 'AI Opponent' : `Player ${i + 1}`,
        hand: hand,
        revealed: new Array(12).fill(false),
        score: 0,
        roundScores: [],
        isAI: playMode === 'ai' && i === 1,
      });
    }

    setPlayers(newPlayers);
    setDeck(newDeck);
    setDiscardPile([]);
    setCurrentPlayerIdx(0);
    setSelectedCard(null);
    setGameMode('playing');
    setLastAction('Game started. Draw a card or take from discard.');
    playSound('start');
  };

  const createDeck = () => {
    const deck = [];
    for (let i = 0; i < 2; i++) {
      for (let val = -2; val <= 12; val++) {
        deck.push(val);
      }
    }
    return deck.sort(() => Math.random() - 0.5);
  };

  const playSound = (type) => {
    if (!soundEnabled) return;
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      const now = audioContext.currentTime;
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

      if (type === 'start') {
        oscillator.frequency.setValueAtTime(400, now);
        oscillator.frequency.linearRampToValueAtTime(600, now + 0.1);
      } else if (type === 'turn') {
        oscillator.frequency.setValueAtTime(600, now);
        oscillator.frequency.linearRampToValueAtTime(800, now + 0.15);
      } else if (type === 'roundEnd') {
        oscillator.frequency.setValueAtTime(800, now);
        oscillator.frequency.linearRampToValueAtTime(400, now + 0.3);
      }

      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch (e) {
      // Audio context not supported
    }
  };

  const drawCard = () => {
    if (deck.length === 0) {
      setLastAction('Deck empty. Round ends.');
      endRound();
      return;
    }

    const newCard = deck[0];
    const newDeck = deck.slice(1);
    setDeck(newDeck);
    setSelectedCard(newCard);
    setLastAction(`Drew card: ${newCard}`);
  };

  const takeFromDiscard = () => {
    if (discardPile.length === 0) {
      setLastAction('Discard pile empty.');
      return;
    }

    const newCard = discardPile[discardPile.length - 1];
    setSelectedCard(newCard);
    setDiscardPile(discardPile.slice(0, -1));
    setLastAction(`Took from discard: ${newCard}`);
  };

  const swapCard = (cardIdx) => {
    if (selectedCard === null) return;

    const newPlayers = [...players];
    const currentPlayer = newPlayers[currentPlayerIdx];
    const oldCard = currentPlayer.hand[cardIdx];

    currentPlayer.hand[cardIdx] = selectedCard;
    currentPlayer.revealed[cardIdx] = true;

    setDiscardPile([...discardPile, oldCard]);
    setPlayers(newPlayers);
    setSelectedCard(null);
    setLastAction(`Swapped card at position ${cardIdx + 1}`);

    // Check for round end (all cards revealed)
    if (currentPlayer.revealed.every((r) => r)) {
      setTimeout(() => endRound(), 500);
    } else {
      nextPlayer();
    }
  };

  const discardCard = () => {
    if (selectedCard === null) return;

    setDiscardPile([...discardPile, selectedCard]);
    setSelectedCard(null);
    setLastAction(`Discarded: ${selectedCard}`);
    nextPlayer();
  };

  const nextPlayer = () => {
    let nextIdx = (currentPlayerIdx + 1) % playerCount;
    setCurrentPlayerIdx(nextIdx);
    playSound('turn');

    if (players[nextIdx]?.isAI) {
      setTimeout(() => aiTurn(), 1000);
    }
  };

  const aiTurn = () => {
    const aiPlayer = players[currentPlayerIdx];
    const unrevealed = aiPlayer.hand
      .map((card, idx) => ({ card, idx, revealed: aiPlayer.revealed[idx] }))
      .filter((c) => !c.revealed);

    // Simple AI: draw, evaluate, swap or discard
    const newDeck = [...deck];
    let drawnCard;

    if (Math.random() > 0.3 && discardPile.length > 0) {
      drawnCard = discardPile[discardPile.length - 1];
      setDiscardPile(discardPile.slice(0, -1));
      setLastAction(`AI took from discard: ${drawnCard}`);
    } else {
      if (newDeck.length === 0) {
        endRound();
        return;
      }
      drawnCard = newDeck[0];
      setDeck(newDeck.slice(1));
      setLastAction(`AI drew card: ${drawnCard}`);
    }

    setTimeout(() => {
      if (unrevealed.length > 0) {
        const targetIdx = unrevealed[Math.floor(Math.random() * unrevealed.length)].idx;
        const newPlayers = [...players];
        const oldCard = newPlayers[currentPlayerIdx].hand[targetIdx];

        newPlayers[currentPlayerIdx].hand[targetIdx] = drawnCard;
        newPlayers[currentPlayerIdx].revealed[targetIdx] = true;

        setPlayers(newPlayers);
        setDiscardPile([...discardPile, oldCard]);

        if (newPlayers[currentPlayerIdx].revealed.every((r) => r)) {
          setTimeout(() => endRound(), 500);
        } else {
          nextPlayer();
        }
      }
    }, 800);
  };

  const endRound = () => {
    playSound('roundEnd');
    const newPlayers = players.map((p) => {
      const score = p.hand.reduce((sum, card) => sum + card, 0);
      return {
        ...p,
        roundScores: [...p.roundScores, score],
        score: p.score + score,
      };
    });

    setPlayers(newPlayers);
    setGameMode('roundEnd');
    setLastAction('Round over. Scores calculated.');
  };

  const startNextRound = () => {
    const newDeck = createDeck();
    const newPlayers = players.map((p) => {
      const hand = newDeck.splice(0, 12);
      return {
        ...p,
        hand: hand,
        revealed: new Array(12).fill(false),
      };
    });

    setPlayers(newPlayers);
    setDeck(newDeck);
    setDiscardPile([]);
    setCurrentPlayerIdx(0);
    setSelectedCard(null);
    setRoundNumber(roundNumber + 1);
    setGameMode('playing');
    setLastAction('Round ' + (roundNumber + 1) + ' started.');
  };

  const resetGame = () => {
    setGameMode(null);
    setPlayMode(null);
    setGameId(null);
    setPlayers([]);
    setDeck([]);
    setDiscardPile([]);
    setCurrentPlayerIdx(0);
    setSelectedCard(null);
    setRoundNumber(1);
  };

  // Setup screen
  if (gameMode === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FCFBF9' }}>
        <div className="text-center max-w-md">
          <h1 className="text-5xl font-bold mb-8" style={{ color: '#212D19' }}>
            Skyjo
          </h1>
          <p className="text-lg mb-12" style={{ color: '#688666' }}>
            Select game mode
          </p>

          <div className="space-y-4">
            <button
              onClick={() => {
                setPlayMode('local');
                setGameMode('setup');
              }}
              className="w-full py-4 px-6 rounded-lg font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: '#9C3F22' }}
            >
              Pass & Play (Local)
            </button>

            <button
              onClick={() => {
                setPlayMode('ai');
                setPlayerCount(2);
                setGameMode('setup');
              }}
              className="w-full py-4 px-6 rounded-lg font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: '#688666' }}
            >
              Play vs AI
            </button>

            <button
              onClick={() => {
                setPlayMode('link');
                setGameMode('setup');
              }}
              className="w-full py-4 px-6 rounded-lg font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: '#C79057' }}
            >
              Share Link (Multiplayer)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Setup player count
  if (gameMode === 'setup') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FCFBF9' }}>
        <div className="text-center max-w-md">
          <h2 className="text-3xl font-bold mb-6" style={{ color: '#212D19' }}>
            {playMode === 'ai' ? 'Play vs AI' : playMode === 'link' ? 'Multiplayer Setup' : 'Local Setup'}
          </h2>

          {playMode !== 'ai' && (
            <div className="mb-8">
              <label className="block text-lg font-semibold mb-4" style={{ color: '#212D19' }}>
                Number of Players: {playerCount}
              </label>
              <input
                type="range"
                min="2"
                max="4"
                value={playerCount}
                onChange={(e) => setPlayerCount(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          )}

          <button
            onClick={initializeGame}
            className="w-full py-4 px-6 rounded-lg font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: '#9C3F22' }}
          >
            Start Game
          </button>

          <button
            onClick={resetGame}
            className="w-full mt-4 py-3 px-6 rounded-lg font-semibold transition hover:opacity-90"
            style={{ backgroundColor: '#E5DACB', color: '#212D19' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  // Playing screen
  if (gameMode === 'playing' && players.length > 0) {
    const currentPlayer = players[currentPlayerIdx];
    const isCurrentPlayerAI = currentPlayer.isAI;

    return (
      <div className="min-h-screen p-4" style={{ backgroundColor: '#FCFBF9' }}>
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold" style={{ color: '#212D19' }}>
              Skyjo - Round {roundNumber}
            </h1>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 rounded-lg transition hover:opacity-80"
              style={{ backgroundColor: '#E5DACB', color: '#212D19' }}
            >
              {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          </div>

          {/* Game info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {players.map((p) => (
              <div
                key={p.id}
                className={`p-4 rounded-lg text-center transition ${
                  currentPlayerIdx === p.id ? 'ring-4' : ''
                }`}
                style={{
                  backgroundColor: currentPlayerIdx === p.id ? '#9C3F22' : '#E5DACB',
                  color: currentPlayerIdx === p.id ? 'white' : '#212D19',
                  borderColor: '#9C3F22',
                }}
              >
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm mt-1">Score: {p.score}</p>
              </div>
            ))}
          </div>

          {/* Current player notification */}
          {!isCurrentPlayerAI && (
            <div className="text-center mb-6 p-3 rounded-lg text-white font-semibold" style={{ backgroundColor: '#9C3F22' }}>
              🎮 Your Turn!
            </div>
          )}

          {isCurrentPlayerAI && (
            <div className="text-center mb-6 p-3 rounded-lg font-semibold" style={{ backgroundColor: '#E5DACB', color: '#212D19' }}>
              AI is playing...
            </div>
          )}

          {/* Deck & discard */}
          <div className="flex justify-center gap-12 mb-8">
            <div className="text-center">
              <button
                onClick={drawCard}
                disabled={isCurrentPlayerAI || selectedCard !== null}
                className="w-24 h-32 rounded-lg border-2 border-dashed flex items-center justify-center font-semibold transition disabled:opacity-50 hover:opacity-80"
                style={{
                  borderColor: '#9C3F22',
                  backgroundColor: '#FCFBF9',
                  color: '#212D19',
                }}
              >
                Draw
                <br />
                ({deck.length})
              </button>
              <p className="text-sm mt-2" style={{ color: '#688666' }}>
                Deck
              </p>
            </div>

            <div className="text-center">
              <button
                onClick={takeFromDiscard}
                disabled={isCurrentPlayerAI || selectedCard !== null || discardPile.length === 0}
                className="w-24 h-32 rounded-lg border-2 flex items-center justify-center font-semibold text-lg transition disabled:opacity-50 hover:opacity-80"
                style={{
                  borderColor: '#C79057',
                  backgroundColor: discardPile.length > 0 ? '#C79057' : '#E5DACB',
                  color: discardPile.length > 0 ? 'white' : '#212D19',
                }}
              >
                {discardPile.length > 0 ? discardPile[discardPile.length - 1] : '-'}
              </button>
              <p className="text-sm mt-2" style={{ color: '#688666' }}>
                Discard
              </p>
            </div>
          </div>

          {/* Selected card */}
          {selectedCard !== null && (
            <div className="text-center mb-8">
              <div
                className="inline-block w-20 h-28 rounded-lg flex items-center justify-center text-white font-bold text-2xl"
                style={{ backgroundColor: '#9C3F22' }}
              >
                {selectedCard}
              </div>
              <p className="mt-3 text-sm font-semibold" style={{ color: '#212D19' }}>
                Selected Card
              </p>
              <div className="flex gap-4 justify-center mt-4">
                <button
                  onClick={discardCard}
                  className="px-6 py-2 rounded-lg font-semibold text-white transition hover:opacity-90"
                  style={{ backgroundColor: '#688666' }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Hand */}
          <div className="text-center mb-6">
            <h3 className="text-lg font-semibold mb-4" style={{ color: '#212D19' }}>
              {isCurrentPlayerAI ? "AI's Hand" : "Your Hand"}
            </h3>
            <div className="grid grid-cols-6 md:grid-cols-12 gap-2 mb-6">
              {currentPlayer.hand.map((card, idx) => (
                <button
                  key={idx}
                  onClick={() => selectedCard !== null && swapCard(idx)}
                  disabled={selectedCard === null || isCurrentPlayerAI}
                  className="aspect-square rounded-lg border-2 flex items-center justify-center font-bold text-lg transition disabled:opacity-50 hover:opacity-80"
                  style={{
                    borderColor: currentPlayer.revealed[idx] ? '#9C3F22' : '#C79057',
                    backgroundColor: currentPlayer.revealed[idx] ? '#9C3F22' : '#E5DACB',
                    color: currentPlayer.revealed[idx] ? 'white' : '#212D19',
                  }}
                >
                  {currentPlayer.revealed[idx] ? card : '?'}
                </button>
              ))}
            </div>
          </div>

          {/* Last action / notification */}
          {lastAction && (
            <div
              className="p-4 rounded-lg text-center font-semibold"
              style={{ backgroundColor: '#E5DACB', color: '#212D19' }}
            >
              {lastAction}
            </div>
          )}

          {/* Back button */}
          <button
            onClick={resetGame}
            className="mt-8 w-full py-3 px-6 rounded-lg font-semibold transition hover:opacity-90"
            style={{ backgroundColor: '#E5DACB', color: '#212D19' }}
          >
            Quit Game
          </button>
        </div>
      </div>
    );
  }

  // Round end screen
  if (gameMode === 'roundEnd' && players.length > 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#FCFBF9' }}>
        <div className="text-center max-w-2xl">
          <h2 className="text-4xl font-bold mb-8" style={{ color: '#212D19' }}>
            Round {roundNumber} Complete
          </h2>

          <div className="space-y-4 mb-8">
            {players.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-lg flex justify-between items-center"
                style={{ backgroundColor: '#E5DACB' }}
              >
                <span className="font-semibold" style={{ color: '#212D19' }}>
                  {p.name}
                </span>
                <span style={{ color: '#9C3F22' }} className="font-bold text-xl">
                  Round: {p.roundScores[p.roundScores.length - 1]} | Total: {p.score}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={startNextRound}
            className="w-full py-4 px-6 rounded-lg font-semibold text-white transition hover:opacity-90 mb-4"
            style={{ backgroundColor: '#9C3F22' }}
          >
            Next Round
          </button>

          <button
            onClick={resetGame}
            className="w-full py-4 px-6 rounded-lg font-semibold transition hover:opacity-90"
            style={{ backgroundColor: '#E5DACB', color: '#212D19' }}
          >
            End Game
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default SkyjoGame;
