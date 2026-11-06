import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProposal,
  confirmProposal,
  formatWhenLabel,
  parseWhen,
  presentHandoff,
} from './handoff.js';

const NOW = Date.UTC(2026, 10, 6, 4, 0, 0);

function accepted() {
  return {
    offer: { id: 'o1', fromId: 'buyer', status: 'accepted', listingId: 'l1' },
    listing: { id: 'l1', sellerId: 'seller' },
  };
}

test('when label uses the calendar date and Macau weekday', () => {
  assert.equal(formatWhenLabel('2026-11-08T15:00'), '11月8日（日）15:00');
  assert.equal(formatWhenLabel('nope'), '');
});

test('parseWhen rejects past times, far times, and impossible dates', () => {
  assert.equal(parseWhen('2026-11-08T15:00', NOW).when, '2026-11-08T15:00');
  assert.match(parseWhen('2026-11-06T10:00', NOW).error, /已過/);
  assert.match(parseWhen('2027-03-01T10:00', NOW).error, /90 日/);
  assert.match(parseWhen('2026-02-31T10:00', NOW).error, /不正確/);
  assert.match(parseWhen('', NOW).error, /見面時間/);
});

test('only the two people on an accepted bid can propose, and a new proposal resets the other side', () => {
  const { offer, listing } = accepted();
  const pending = buildProposal({
    offer: { ...offer, status: 'pending' },
    listing,
    userId: 'buyer',
    placeId: 'ruinas',
    when: '2026-11-08T15:00',
    now: NOW,
    id: 'h1',
  });
  assert.match(pending.error, /還沒有接受/);

  const stranger = buildProposal({
    offer,
    listing,
    userId: 'other',
    placeId: 'ruinas',
    when: '2026-11-08T15:00',
    now: NOW,
    id: 'h1',
  });
  assert.match(stranger.error, /買賣雙方/);

  const custom = buildProposal({
    offer,
    listing,
    userId: 'buyer',
    placeId: 'custom',
    customPlace: '',
    when: '2026-11-08T15:00',
    now: NOW,
    id: 'h1',
  });
  assert.match(custom.error, /自訂地點/);

  const first = buildProposal({
    offer,
    listing,
    userId: 'buyer',
    placeId: 'taipa',
    when: '2026-11-08T15:00',
    note: '週末',
    now: NOW,
    id: 'h1',
  });
  assert.equal(first.handoff.place, '官也街');
  assert.equal(first.handoff.buyerOk, true);
  assert.equal(first.handoff.sellerOk, false);
  assert.equal(first.summary, '11月8日（日）15:00 · 官也街');

  const revised = buildProposal({
    existing: { ...first.handoff, sellerOk: true },
    offer,
    listing,
    userId: 'seller',
    placeId: 'custom',
    customPlace: '黑沙環公園門口',
    when: '2026-11-09T18:30',
    now: NOW + 1000,
    id: 'h-new',
  });
  assert.equal(revised.handoff.id, 'h1');
  assert.equal(revised.handoff.place, '黑沙環公園門口');
  assert.equal(revised.handoff.buyerOk, false);
  assert.equal(revised.handoff.sellerOk, true);
  assert.equal(revised.handoff.proposedBy, 'seller');
});

test('confirm flips only the caller until both sides agree', () => {
  const { offer, listing } = accepted();
  const proposed = buildProposal({
    offer,
    listing,
    userId: 'buyer',
    placeId: 'senado',
    when: '2026-11-08T15:00',
    now: NOW,
    id: 'h1',
  }).handoff;
  assert.equal(presentHandoff(proposed).status, 'proposed');
  const missing = confirmProposal(null, offer, listing, 'seller', NOW);
  assert.match(missing.error, /尚未/);
  const seller = confirmProposal(proposed, offer, listing, 'seller', NOW + 5);
  assert.equal(seller.became, true);
  assert.equal(seller.handoff.sellerOk, true);
  assert.equal(seller.handoff.buyerOk, true);
  assert.equal(presentHandoff(seller.handoff).status, 'confirmed');
  const again = confirmProposal(seller.handoff, offer, listing, 'seller', NOW + 9);
  assert.equal(again.became, false);
  assert.equal(again.already, true);
  const closed = confirmProposal(proposed, { ...offer, status: 'pending' }, listing, 'seller', NOW);
  assert.match(closed.error, /不能確認/);
});
