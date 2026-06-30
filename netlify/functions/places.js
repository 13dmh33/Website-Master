'use strict';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const { place_id, query } = event.queryStringParameters || {};
  const key = process.env.GOOGLE_PLACES_API_KEY;

  if (!key) {
    return { statusCode: 200, headers, body: JSON.stringify({ unavailable: true, reason: 'no_key' }) };
  }

  try {
    if (place_id) {
      // Place Details
      const fields = 'name,formatted_phone_number,formatted_address,photos,rating,user_ratings_total,reviews,geometry';
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(place_id)}&fields=${fields}&key=${key}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.status !== 'OK' || !json.result) {
        return { statusCode: 200, headers, body: JSON.stringify({ unavailable: true, reason: json.status }) };
      }

      const r = json.result;
      const photoRef = r.photos && r.photos[0] ? r.photos[0].photo_reference : null;
      const photoUrl = photoRef
        ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=1400&photo_reference=${photoRef}&key=${key}`
        : null;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          name: r.name,
          phone: r.formatted_phone_number || null,
          address: r.formatted_address || null,
          rating: r.rating || null,
          reviewCount: r.user_ratings_total || null,
          reviews: (r.reviews || []).slice(0, 5).map(rv => ({
            author_name: rv.author_name,
            rating: rv.rating,
            text: rv.text,
            relative_time_description: rv.relative_time_description,
          })),
          photoUrl,
          lat: r.geometry?.location?.lat,
          lng: r.geometry?.location?.lng,
        }),
      };
    }

    if (query) {
      // Text Search — find place_id from business name
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.status !== 'OK' || !json.results || !json.results.length) {
        return { statusCode: 200, headers, body: JSON.stringify({ unavailable: true, reason: json.status }) };
      }

      const candidates = json.results.slice(0, 5).map(r => ({
        place_id: r.place_id,
        name: r.name,
        address: r.formatted_address,
        rating: r.rating,
        reviewCount: r.user_ratings_total,
      }));

      return { statusCode: 200, headers, body: JSON.stringify({ candidates }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provide place_id or query' }) };

  } catch (err) {
    console.error('places.js error:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ unavailable: true, reason: 'fetch_error' }) };
  }
};
