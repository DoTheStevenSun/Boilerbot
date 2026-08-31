const { trello } = require('./config.json');

const BASE = 'https://api.trello.com/1';
const AUTH = `key=${trello.apiKey}&token=${trello.apiToken}`;

async function fetchTrello(path, method = 'GET', body = null) {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}${AUTH}`;
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Trello API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// Get all lists on the board
async function getLists() {
  return fetchTrello(`/boards/${trello.boardId}/lists`);
}

// Get all cards on the board
async function getCards() {
  return fetchTrello(`/boards/${trello.boardId}/cards?members=true`);
}

// Get all members of the board
async function getMembers() {
  return fetchTrello(`/boards/${trello.boardId}/members`);
}

// Create a card
async function createCard(name, desc, listId, due = null) {
  const params = new URLSearchParams({ name, desc, idList: listId });
  if (due) params.append('due', due);
  return fetchTrello(`/cards?${params.toString()}`, 'POST');
}

// Move a card to a different list
async function moveCard(cardId, listId) {
  return fetchTrello(`/cards/${cardId}?idList=${listId}`, 'PUT');
}

// Assign a member to a card
async function assignMember(cardId, memberId) {
  return fetchTrello(`/cards/${cardId}/idMembers?value=${memberId}`, 'POST');
}

// Set due date on a card
async function setDueDate(cardId, due) {
  return fetchTrello(`/cards/${cardId}?due=${due}`, 'PUT');
}

// Get a single card by ID
async function getCard(cardId) {
  return fetchTrello(`/cards/${cardId}?members=true`);
}

// Search cards by name
async function searchCards(query) {
  const cards = await getCards();
  return cards.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
}

module.exports = { getLists, getCards, getMembers, createCard, moveCard, assignMember, setDueDate, getCard, searchCards };