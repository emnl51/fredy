/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { buildHash, isOneOf } from '../utils.js';
import { extractNumber } from '../utils/extract-number.js';
import logger from '../services/logger.js';
import checkIfListingIsActive from '../services/listings/listingActiveTester.js';
/** @import { ParsedListing } from '../types/listing.js' */
/** @import { ProviderConfig } from '../types/providerConfig.js' */

const BASE_URL = 'https://stadtundland.de';
const API_URL = 'https://d2396ha8oiavw0.cloudfront.net/sul-main/immoSearch';
const IMAGE_BASE_URL = 'https://d2396ha8oiavw0.cloudfront.net';
const PAGE_SIZE = 10;
const MAX_RESULTS = 1000;
const BOOLEAN_FILTERS = new Set(['barrierFree', 'new', 'seniors', 'wbs']);
const NUMBER_FILTERS = new Set(['minRate', 'maxRate', 'minRooms', 'maxRooms', 'minSpace', 'maxSpace']);

/**
 * Convert the public search URL into the JSON request accepted by Stadt und Land's search API.
 * Unknown parameters are deliberately ignored instead of forwarding arbitrary data.
 *
 * @param {string} searchUrl
 * @returns {Record<string, string|number|boolean>}
 */
export function buildSearchPayload(searchUrl) {
  const url = new URL(searchUrl);
  const payload = { cat: 'wohnung', offset: 0 };

  const district = url.searchParams.get('district');
  if (district && district !== 'all') payload.district = district;

  for (const [key, value] of url.searchParams) {
    if (BOOLEAN_FILTERS.has(key) && value === 'true') payload[key] = true;
    if (NUMBER_FILTERS.has(key)) {
      const number = Number(value.replace(',', '.'));
      if (Number.isFinite(number)) payload[key] = number;
    }
  }

  return payload;
}

/**
 * @param {any} item
 * @returns {string}
 */
function buildAddress(item) {
  const street = [item.address?.street, item.address?.house_number].filter(Boolean).join(' ');
  const city = [item.address?.postal_code, item.address?.city].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}

/**
 * @param {any} item
 * @returns {string}
 */
function buildDescription(item) {
  const attributes = [];
  if (item.details?.wbs) attributes.push('WBS erforderlich');
  if (item.details?.barrierFree) attributes.push('Barrierefrei');
  if (item.details?.wheelchairFriendly) attributes.push('Rollstuhlgerecht');
  if (item.details?.seniorsFriendly) attributes.push('Seniorengerecht');
  return attributes.join(' · ');
}

/**
 * @param {any} item
 * @returns {string|null}
 */
function buildImageUrl(item) {
  const filename = item.image?.filename;
  if (typeof filename !== 'string' || !filename.trim()) return null;
  return `${IMAGE_BASE_URL}/${filename.replace(/^\/+/, '')}`;
}

/**
 * The API uses JSON-style decimal points for measurements, while rents are German-formatted.
 * `extractNumber` intentionally treats a lone dot as a thousands separator, so measurements need
 * their own conversion.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parseMeasurement(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {any} item
 * @returns {ParsedListing}
 */
export function normalize(item) {
  const reference = String(item.details?.immoNumber || '').trim();
  const price = extractNumber(item.costs?.coldRent);
  return {
    id: buildHash(reference, price),
    link: `${BASE_URL}/wohnungssuche/${encodeURIComponent(reference)}`,
    title: String(item.headline || '').trim(),
    price,
    size: parseMeasurement(item.details?.livingSpace),
    rooms: parseMeasurement(item.details?.rooms),
    address: buildAddress(item),
    image: buildImageUrl(item),
    description: buildDescription(item),
  };
}

/**
 * Retrieve every result page for the filters stored in the public search URL.
 *
 * @param {string} searchUrl
 * @returns {Promise<any[]>}
 */
export async function getListings(searchUrl) {
  const basePayload = buildSearchPayload(searchUrl);
  const listings = [];
  let expectedCount = null;

  for (let offset = 0; offset < MAX_RESULTS; offset += PAGE_SIZE) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...basePayload, offset }),
    });
    if (!response.ok) {
      throw new Error(`Stadt und Land API returned ${response.status} ${response.statusText}`.trim());
    }

    const result = await response.json();
    const page = Array.isArray(result?.data) ? result.data : [];
    expectedCount = Number.isFinite(Number(result?.count)) ? Number(result.count) : expectedCount;
    listings.push(...page.filter((item) => item?.details?.immoType === 'wohnung'));

    if (page.length < PAGE_SIZE || (expectedCount != null && offset + page.length >= expectedCount)) break;
  }

  if (expectedCount != null && expectedCount > MAX_RESULTS) {
    logger.warn(`Stadt und Land returned ${expectedCount} results; only the first ${MAX_RESULTS} were requested.`);
  }
  return listings;
}

/**
 * @param {ParsedListing} listing
 * @param {string[]} blacklist
 * @returns {boolean}
 */
function applyBlacklist(listing, blacklist) {
  return !isOneOf(listing.title, blacklist) && !isOneOf(listing.description, blacklist);
}

/** @type {ProviderConfig} */
const config = {
  requiredFieldNames: ['id', 'link', 'title', 'price', 'size', 'rooms', 'address', 'image', 'description'],
  url: null,
  crawlFields: {},
  normalize,
  getListings,
  activityProbe: checkIfListingIsActive,
};

/**
 * @param {{url: string, enabled?: boolean}} sourceConfig
 * @param {string[]} [blacklist]
 * @returns {ProviderConfig}
 */
export const createConfig = (sourceConfig, blacklist = []) => ({
  ...config,
  enabled: sourceConfig.enabled,
  url: sourceConfig.url,
  filter: (listing) => applyBlacklist(listing, blacklist ?? []),
});

export const metaInformation = {
  name: 'Stadt und Land',
  baseUrl: `${BASE_URL}/wohnungssuche?district=all`,
  id: 'stadtUndLand',
};

export { config };
