import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OPEN_SEAT = 'OPEN';

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

// Host creates an online game with N seats; seat 0 is theirs.
export const createOnlineGame = async (hostName, playerCount) => {
  const { data: gameData, error: gameError } = await supabase
    .from('games')
    .insert({
      status: 'lobby',
      current_player_idx: 0,
      round_number: 1,
      finisher_idx: null,
      final_turns_left: 0,
    })
    .select()
    .single();
  if (gameError) throw gameError;
  const gameId = gameData.id;

  const deck = createDeck();
  let deckIdx = 0;
  const playerRows = [];
  for (let i = 0; i < playerCount; i++) {
    const grid = deck.slice(deckIdx, deckIdx + 12);
    deckIdx += 12;
    playerRows.push({
      game_id: gameId,
      player_idx: i,
      name: i === 0 ? hostName : OPEN_SEAT,
      is_ai: false,
      score: 0,
      round_scores: [],
      grid,
      revealed: new Array(12).fill(false),
    });
  }
  const { data: playersData, error: playersError } = await supabase
    .from('game_players')
    .insert(playerRows)
    .select();
  if (playersError) throw playersError;

  const firstDiscard = deck[deckIdx];
  const remainingDeck = deck.slice(deckIdx + 1);

  const { error: stateError } = await supabase.from('game_state').insert({
    game_id: gameId,
    deck: remainingDeck,
    discard: [firstDiscard],
    drawn_card: null,
    drawn_source: null,
    must_reveal: false,
    message: 'Waiting for players to join…',
  });
  if (stateError) throw stateError;

  const myRow = playersData.find((p) => p.player_idx === 0);
  return { gameId, mySeat: { idx: 0, id: myRow.id } };
};

// Joiner claims the lowest open seat.
export const claimSeat = async (gameId, name) => {
  const { data: openSeats, error } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', gameId)
    .eq('name', OPEN_SEAT)
    .order('player_idx');
  if (error) throw error;
  if (!openSeats || openSeats.length === 0) throw new Error('Game is full.');

  const seat = openSeats[0];
  const { data: updated, error: updateError } = await supabase
    .from('game_players')
    .update({ name })
    .eq('id', seat.id)
    .eq('name', OPEN_SEAT) // guard against races
    .select()
    .single();
  if (updateError || !updated) throw new Error('Seat was just taken — try again.');
  return { idx: updated.player_idx, id: updated.id };
};

export const fetchFullGame = async (gameId) => {
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  if (gameError) throw new Error('Game not found');

  const { data: players, error: playersError } = await supabase
    .from('game_players')
    .select('*')
    .eq('game_id', gameId)
    .order('player_idx');
  if (playersError) throw playersError;

  const { data: state, error: stateError } = await supabase
    .from('game_state')
    .select('*')
    .eq('game_id', gameId)
    .single();
  if (stateError) throw stateError;

  return { game, players, state };
};

export const updateGameRow = async (gameId, fields) => {
  const { error } = await supabase.from('games').update(fields).eq('id', gameId);
  if (error) throw error;
};

export const updateStateRow = async (gameId, fields) => {
  const { error } = await supabase.from('game_state').update(fields).eq('game_id', gameId);
  if (error) throw error;
};

export const updatePlayerRow = async (playerId, fields) => {
  const { error } = await supabase.from('game_players').update(fields).eq('id', playerId);
  if (error) throw error;
};

// Realtime subscription (requires realtime enabled on tables).
// The app also polls as a fallback so sync works either way.
export const subscribeToGame = (gameId, onChange) => {
  const channel = supabase
    .channel(`skyjo:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_state', filter: `game_id=eq.${gameId}` },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

export { OPEN_SEAT };
