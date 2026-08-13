/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import fetch from 'node-fetch';
import { getPackageVersion } from '../../utils.js';
import semver from 'semver';
import logger from '../../services/logger.js';

/**
 * How long a GitHub answer is reused.
 *
 * The unauthenticated GitHub API allows 60 requests per hour per address. This endpoint is hit on
 * every app boot, so without a cache a handful of users reloading exhausts the quota - and the
 * rate-limited response has no `tag_name`, which used to make `semver.gte` throw and turn the
 * endpoint into a 500.
 * @type {number}
 */
const VERSION_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const RELEASES_URL = 'https://api.github.com/repos/emnl51/fredy/releases?per_page=20';

/** @type {{at: number, payload: Object|null}} */
let versionCache = { at: 0, payload: null };

/**
 * Ask GitHub for the latest release, at most once every {@link VERSION_CACHE_TTL_MS}.
 *
 * Failures and "no new version" are cached just like successes: when GitHub is rate-limiting us,
 * retrying on every request is precisely the wrong response.
 *
 * @returns {Promise<{newVersion: boolean, version: string, url: string, body: string, localFredyVersion: string}|null>}
 */
async function getCurrentVersionFromGithub() {
  if (Date.now() - versionCache.at < VERSION_CACHE_TTL_MS) {
    return versionCache.payload;
  }

  const localFredyVersion = await getPackageVersion();
  let payload = null;
  try {
    const raw = await fetch(RELEASES_URL);
    const releases = await raw.json();
    // GitHub's /releases/latest endpoint excludes prereleases. This fork intentionally uses
    // prerelease tags such as 26.1.0-ai.1, so inspect the release list and select the greatest
    // valid semantic version instead. Error and rate-limit responses degrade to "no new version".
    const data = Array.isArray(releases)
      ? releases
          .filter((release) => !release?.draft && semver.valid(release?.tag_name))
          .sort((left, right) => semver.rcompare(left.tag_name, right.tag_name))[0]
      : null;
    if (data && semver.gt(data.tag_name, localFredyVersion)) {
      payload = {
        newVersion: true,
        version: data.tag_name,
        url: data.html_url,
        body: data.body,
        localFredyVersion,
      };
    }
  } catch (error) {
    logger.warn('Could not check for a new Fredy version.', error?.message || error);
  }

  versionCache = { at: Date.now(), payload };
  return payload;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function versionPlugin(fastify) {
  fastify.get('/', async () => {
    const versionPayload = await getCurrentVersionFromGithub();
    const localFredyVersion = await getPackageVersion();
    return versionPayload ?? { newVersion: false, localFredyVersion };
  });
}
