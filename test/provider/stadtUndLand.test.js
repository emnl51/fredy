/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSearchPayload,
  createConfig,
  getListings,
  metaInformation,
  normalize,
} from '../../lib/provider/stadtUndLand.js';

const apartment = (number, overrides = {}) => ({
  headline: 'Helle 2-Zimmer-Wohnung',
  address: {
    postal_code: '12349',
    city: 'Berlin',
    street: 'In den Bauerngärten',
    house_number: '12',
  },
  details: {
    immoNumber: number,
    immoType: 'wohnung',
    livingSpace: '59.67',
    rooms: '2.00',
    barrierFree: true,
  },
  costs: { coldRent: '911,16' },
  image: { filename: 'wohnungshelden/example.jpg' },
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('Stadt und Land provider', () => {
  it('translates supported public URL filters into an API payload', () => {
    expect(
      buildSearchPayload(
        'https://stadtundland.de/wohnungssuche?district=all&wbs=true&minRooms=2&maxRate=1200&ignored=x',
      ),
    ).toEqual({ cat: 'wohnung', offset: 0, wbs: true, minRooms: 2, maxRate: 1200 });
  });

  it('normalizes German numbers and builds direct listing URLs', () => {
    expect(normalize(apartment('1001/5248/00260'))).toMatchObject({
      link: 'https://stadtundland.de/wohnungssuche/1001%2F5248%2F00260',
      title: 'Helle 2-Zimmer-Wohnung',
      price: 911.16,
      size: 59.67,
      rooms: 2,
      address: 'In den Bauerngärten 12, 12349 Berlin',
      image: 'https://d2396ha8oiavw0.cloudfront.net/wohnungshelden/example.jpg',
      description: 'Barrierefrei',
    });
  });

  it('loads all pages and excludes parking offers', async () => {
    const firstPage = Array.from({ length: 9 }, (_, index) => apartment(`wohnung-${index}`));
    firstPage.push(apartment('garage', { details: { immoNumber: 'garage', immoType: 'parken' } }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: firstPage, count: 11 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [apartment('wohnung-9')], count: 11 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getListings('https://stadtundland.de/wohnungssuche?district=all');

    expect(result).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ cat: 'wohnung', offset: 10 });
  });

  it('provides a run-scoped blacklist without changing provider metadata', () => {
    const runConfig = createConfig({ url: 'https://stadtundland.de/wohnungssuche?district=all', enabled: true }, [
      'WBS',
    ]);
    expect(metaInformation).toEqual({
      name: 'Stadt und Land',
      baseUrl: 'https://stadtundland.de/wohnungssuche?district=all',
      id: 'stadtUndLand',
    });
    expect(runConfig.filter({ title: 'Wohnung', description: 'WBS erforderlich' })).toBe(false);
    expect(runConfig.filter({ title: 'Wohnung', description: '' })).toBe(true);
  });
});
