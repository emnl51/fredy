/**
 * Travel time filter helpers.
 *
 * Keeps map/list filtering logic in one place.
 */

/**
 * Returns available travel time in minutes for a selected mode.
 *
 * @param {object} entry
 * @param {string} mode
 * @returns {number|null}
 */
export function getTravelMinutes(entry, mode) {
  if (!entry || !mode) {
    return null;
  }

  const candidates = [
    entry[mode],
    entry.times?.[mode],
    entry.travelTime?.[mode],
  ];

  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }

    if (typeof candidate === 'number') {
      return candidate;
    }

    if (typeof candidate.minutes === 'number') {
      return candidate.minutes;
    }
  }

  return null;
}


/**
 * Checks whether a listing matches travel time constraints.
 *
 * @param {object} listing
 * @param {object} filter
 * @returns {boolean}
 */
export function matchesTravelTimeFilter(listing, filter) {
  if (!filter?.enabled) {
    return true;
  }

  const {
    mode,
    maxMinutes,
  } = filter;

  if (!mode || !maxMinutes) {
    return true;
  }

  const travelTimes = Array.isArray(listing?.travelTimes)
    ? listing.travelTimes
    : [];

  return travelTimes.some((entry) => {
    const minutes = getTravelMinutes(entry, mode);

    return minutes !== null && minutes <= maxMinutes;
  });
}


/**
 * Returns marker color based on commute time.
 *
 * @param {object} listing
 * @param {object} filter
 * @returns {string|null}
 */
export function getTravelTimeMarkerColor(listing, filter) {
  if (!filter?.enabled) {
    return null;
  }

  const {
    mode,
    maxMinutes,
  } = filter;

  const travelTimes = Array.isArray(listing?.travelTimes)
    ? listing.travelTimes
    : [];

  let shortest = null;

  for (const entry of travelTimes) {
    const minutes = getTravelMinutes(entry, mode);

    if (minutes === null) {
      continue;
    }

    if (shortest === null || minutes < shortest) {
      shortest = minutes;
    }
  }

  if (shortest === null) {
    return '#9E9E9E';
  }

  if (shortest <= maxMinutes) {
    return '#4CAF50';
  }

  if (shortest <= maxMinutes + 10) {
    return '#FF9800';
  }

  return '#F44336';
}
