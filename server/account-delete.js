/** Delete one account and the personal data that belongs to it.
 * Other people's accounts, messages, listings, and completed deal records stay.
 * Caller persists, then unlinks the returned upload paths. */

import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR, id, uploadPath } from './db.js';
import { addNotice } from './notices.js';

const OPEN_OFFER = new Set(['pending', 'countered']);

function offerStatus(offer) {
  return offer?.status || 'pending';
}

function takeUpload(bucket, value) {
  const stored = uploadPath(value);
  if (stored) bucket.add(stored);
}

function referencedUploads(db) {
  const keep = new Set();
  for (const user of db.users || []) takeUpload(keep, user?.avatar);
  for (const listing of db.listings || []) {
    for (const photo of listing?.photos || []) takeUpload(keep, photo);
  }
  for (const message of db.messages || []) {
    for (const photo of message?.photos || []) takeUpload(keep, photo);
    takeUpload(keep, message?.audio?.url);
  }
  return keep;
}

function previewOf(message) {
  if (!message) return '';
  const text = String(message.text || '').split('\n')[0];
  if (text) return text;
  if (message.audio && message.audio.url) return '語音訊息';
  if (Array.isArray(message.photos) && message.photos.length) return '相片';
  return '';
}

/**
 * Remove the user and their personal content from `db`.
 * Returns upload paths that are safe to unlink after persist.
 */
export function deleteUserAccount(db, userId, now = Date.now()) {
  const user = (db?.users || []).find((row) => row && row.id === userId);
  if (!user) return { ok: false, error: 'NOT_FOUND' };

  const doomed = new Set();
  takeUpload(doomed, user.avatar);

  const removedListingIds = new Set();
  for (const listing of db.listings || []) {
    if (!listing || listing.sellerId !== userId) continue;
    removedListingIds.add(listing.id);
    for (const photo of listing.photos || []) takeUpload(doomed, photo);
    listing.removedAt = listing.removedAt || now;
    listing.title = '已刪除的刊登';
    listing.description = '';
    listing.location = '';
    listing.photos = [];
    listing.photoFrames = [];
  }

  const droppedMessageIds = new Set();
  for (const message of db.messages || []) {
    if (!message || message.fromId !== userId) continue;
    if (message.id) droppedMessageIds.add(message.id);
    for (const photo of message.photos || []) takeUpload(doomed, photo);
    takeUpload(doomed, message?.audio?.url);
  }
  db.messages = (db.messages || []).filter((message) => message && message.fromId !== userId);

  for (const thread of db.threads || []) {
    if (!thread) continue;
    if (thread.buyerId !== userId && thread.sellerId !== userId) continue;
    const rest = (db.messages || [])
      .filter((message) => message && message.threadId === thread.id)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    thread.preview = previewOf(rest[rest.length - 1]);
    if (thread.buyerId === userId) thread.buyerUnread = false;
    if (thread.sellerId === userId) thread.sellerUnread = false;
  }

  for (const offer of db.offers || []) {
    if (!offer) continue;
    const onTheirListing = removedListingIds.has(offer.listingId);
    const theirs = offer.fromId === userId;
    if (theirs) offer.message = '';
    if (onTheirListing) offer.counterMessage = '';
    const open = OPEN_OFFER.has(offerStatus(offer));
    if (!open || (!onTheirListing && !theirs)) continue;
    offer.status = theirs && !onTheirListing ? 'cancelled' : 'rejected';
    offer.agreedAmount = null;
    offer.updatedAt = now;
    delete offer.buyerHiddenAt;
    delete offer.sellerHiddenAt;
  }

  db.reviews = (db.reviews || []).filter((review) => review && review.fromId !== userId);
  db.wants = (db.wants || []).filter(
    (want) => want && want.userId !== userId && !removedListingIds.has(want.listingId)
  );
  db.devices = (db.devices || []).filter((device) => device && device.userId !== userId);
  db.blocks = (db.blocks || []).filter((row) => row && row.blockerId !== userId);

  const peers = new Set();
  for (const thread of db.threads || []) {
    if (!thread) continue;
    if (thread.buyerId === userId) peers.add(thread.sellerId);
    else if (thread.sellerId === userId) peers.add(thread.buyerId);
  }
  for (const offer of db.offers || []) {
    if (!offer) continue;
    if (offer.fromId === userId) {
      const listing = (db.listings || []).find((row) => row && row.id === offer.listingId);
      if (listing?.sellerId) peers.add(listing.sellerId);
    } else if (removedListingIds.has(offer.listingId) && offer.fromId) {
      peers.add(offer.fromId);
    }
  }
  peers.delete(userId);

  const droppedOfferIds = new Set(
    (db.offers || []).filter((offer) => offer && offer.fromId === userId && offer.id).map((offer) => offer.id)
  );
  db.users = (db.users || []).filter((row) => row && row.id !== userId);
  db.notices = (db.notices || []).filter((notice) => {
    if (!notice || notice.userId === userId) return false;
    const ref = String(notice.refId || '');
    if (!ref) return true;
    return !droppedMessageIds.has(ref) && !removedListingIds.has(ref) && !droppedOfferIds.has(ref);
  });
  for (const peerId of peers) {
    if (!peerId || !db.users.some((row) => row && row.id === peerId)) continue;
    addNotice(db, {
      id: id('n-'),
      userId: peerId,
      kind: 'message',
      title: '帳號已刪除',
      body: '有街坊已刪除帳號。你自己的訊息同已發生的議價仍保留。',
      href: 'messages',
      refId: userId,
      createdAt: now,
    });
  }

  const keep = referencedUploads(db);
  const uploads = [...doomed].filter((item) => !keep.has(item));
  return { ok: true, uploads };
}

/** Unlink upload files that no remaining row references. Missing files are ignored. */
export function removeUploadFiles(uploads, dir = UPLOADS_DIR) {
  let removed = 0;
  for (const rel of uploads || []) {
    const stored = uploadPath(rel);
    if (!stored) continue;
    const name = stored.slice('/uploads/'.length);
    try {
      fs.unlinkSync(path.join(dir, name));
      removed += 1;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }
  return removed;
}
