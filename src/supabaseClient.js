import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const createGame = async (playerCount, playMode) => {
  // Create game record
  const { data: gameData, error: gameError } = await supabase
    .from('games')
    .insert({
      status: 'initialReveal',
      current_player_idx: 0,
      round_number: 1,
    })
    .select()
    .single();

  if (gameError) throw gameError;
  const gameId = gameData.id;

  // Initialize deck
  const deck = createDeck();
  let deckIdx = 0;
  const players = [];

  for (let i = 0; i < playerCount; i++) {
    const grid = deck.slice(deckIdx, deckIdx + 12);
    deckIdx += 12;

    const { data, error } = await supabase
      .from('game_players')
      .insert({
        game_id: gameId,
        player_idx: i,
        name: playMode === 'ai' ? (i === 0 ? 'You' : `AI ${i}`) : `Player ${i + 1}`,
        is_ai: playMode === 'ai' && i !== 0,
        score: 0,
        round_scores: [],
        grid: grid,
        revealed: new Array(12).fill(false),
      })
      .select()
      .single();

    if (error) throw error;
    players.push(data);
  }

  const firstDiscard = deck[deckIdx];
  const remainingDeck = deck.slice(deckIdx + 1);

  const { error: stateError } = await supabase
    .from('game_state')
    .insert({
      game_id: gameId,
      deck: remainingDeck,
      discard: [firstDiscard],
      drawn_card: null,
      drawn_source: null,
      must_reveal: false,
      message: 'Each player reveals two cards to start.',
    });

  if (stateError) throw stateError;

  return gameId;
};

export const joinGame = async (gameId) => {
  const { data: gameData, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (gameError) throw new Error('Game not found');

  const { data: playersData, error: playersError } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', gameId)
    .order('player_idx');

  if (playersError) throw playersError;

  const { data: stateData, error: stateError } = await supabase
    .from('game_state')
    .select('*')
    .eq('game_id', gameId)
    .single();

  if (stateError) throw stateError;

  return {
    game: gameData,
    players: playersData,
    state: stateData,
  };
};

export const subscribeToGame = (gameId, callback) => {
  const gameSubscription = supabase
    .channel(`games:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        callback({ type: 'game', data: payload.new });
      }
    )
    .subscribe();

  const playersSubscription = supabase
    .channel(`players:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
      (payload) => {
        callback({ type: 'players', data: payload.new });
      }
    )
    .subscribe();

  const stateSubscription = supabase
    .channel(`state:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_state', filter: `game_id=eq.${gameId}` },
      (payload) => {
        callback({ type: 'state', data: payload.new });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(gameSubscription);
    supabase.removeChannel(playersSubscription);
    supabase.removeChannel(stateSubscription);
  };
};

export const updateGameState = async (gameId, updates) => {
  const { error } = await supabase
    .from('game_state')
    .update(updates)
    .eq('game_id', gameId);

  if (error) throw error;
};

export const updateGame = async (gameId, updates) => {
  const { error } = await supabase
    .from('games')
    .update(updates)
    .eq('id', gameId);

  if (error) throw error;
};

export const updatePlayer = async (playerId, updates) => {
  const { error } = await supabase
    .from('game_players')
    .update(updates)
    .eq('id', playerId);

  if (error) throw error;
};

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
